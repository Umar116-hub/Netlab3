import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import crypto from 'crypto';
import { getDb } from '../config/db';

type ConnectedClient = {
  socket: WebSocket;
  accountId: string;
  deviceId: string;
  isAlive: boolean;
};

// Global in-memory map of active sessions (keyed by "accountId")
// Each accountId maps to a Set of active connections
export const activeClients = new Map<string, Set<ConnectedClient>>();

export function getClientStatus() {
  const onlineIds: string[] = [];
  activeClients.forEach((clientSet, accountId) => {
    // Only count as online if there's at least one socket that is truly OPEN
    const hasOpenSocket = Array.from(clientSet).some(c => c.socket.readyState === WebSocket.OPEN);
    if (hasOpenSocket) {
      onlineIds.push(accountId);
    }
  });
  return onlineIds.map(id => ({ id, online: true }));
}

function broadcastPresence(type: 'online' | 'offline', accountId: string) {
  const message = JSON.stringify({ type: 'presence_update', accountId, status: type });
  console.log(`[WS] Broadcasting ${type} for ${accountId}`);
  
  activeClients.forEach(clientSet => {
    clientSet.forEach(client => {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(message);
      }
    });
  });
}

export default async function wsRoutes(fastify: FastifyInstance) {
  // Heartbeat: Check every 10s, terminate if no pong since last check
  const interval = setInterval(() => {
    activeClients.forEach((clientSet, accountId) => {
      clientSet.forEach((client) => {
        if (client.isAlive === false) {
          console.log(`[WS] Terminating dead connection for ${accountId}`);
          return client.socket.terminate();
        }
        
        client.isAlive = false;
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.ping();
        }
      });
    });
  }, 10000);

  fastify.addHook('onClose', (instance, done) => {
    clearInterval(interval);
    done();
  });

  fastify.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const token = (req.query as any).token;

    if (!token) {
      socket.send(JSON.stringify({ type: 'error', message: 'Missing token' }));
      socket.close(1008, 'Token required');
      return;
    }

    const token_hash = crypto.createHash('sha256').update(token).digest('hex');
    const db = getDb();

    const session = db.prepare(`
      SELECT s.account_id, s.device_id, a.username 
      FROM sessions s
      JOIN accounts a ON s.account_id = a.id
      WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL
    `).get(token_hash, new Date().toISOString()) as any;

    if (!session || !session.account_id) {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
      socket.close(1008, 'Unauthorized');
      return;
    }

    const connectionId = session.account_id;
    const clientInfo: ConnectedClient = {
      socket,
      accountId: session.account_id,
      deviceId: session.device_id,
      isAlive: true,
    };
    
    socket.on('pong', () => {
      clientInfo.isAlive = true;
    });

    // Add to active clients (supporting multiple connections per account)
    let clientSet = activeClients.get(connectionId);
    const wasOffline = !clientSet || clientSet.size === 0;
    
    if (!clientSet) {
      clientSet = new Set();
      activeClients.set(connectionId, clientSet);
    }
    clientSet.add(clientInfo);

    console.log(`[WS] Client authenticated: ${connectionId} (User: ${session.username || 'unknown'}). Total sockets for user: ${clientSet.size}`);
    socket.send(JSON.stringify({ type: 'authenticated', accountId: session.account_id }));
    
    // Only broadcast ONLINE if this is the first connection for this user
    if (wasOffline) {
      broadcastPresence('online', connectionId);
    }

    socket.on('message', (raw: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(raw.toString());

        switch (payload.type) {
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }));
            break;

          case 'chat_message':
            // Persist message to DB before routing
            const msgId = payload.id || crypto.randomUUID();
            const conversationId = payload.conversation_id || [connectionId, payload.to].sort().join(':');
            
            try {
                // Ensure conversation exists
                db.prepare('INSERT OR IGNORE INTO conversations (id, type) VALUES (?, ?)').run(conversationId, 'dm');
                // Ensure sender is a member
                db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, account_id, role) VALUES (?, ?, ?)').run(conversationId, connectionId, 'member');
                // Ensure recipient is a member
                db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, account_id, role) VALUES (?, ?, ?)').run(conversationId, payload.to, 'member');
                
                let metadataJson = null;
                if (payload.file_info) {
                    try { metadataJson = JSON.stringify({ file_info: payload.file_info }); } catch (e) {}
                }

                // Save message
                db.prepare(`
                    INSERT INTO messages (id, conversation_id, sender_account_id, sender_device_id, server_seq, ciphertext_blob, ciphertext_type, metadata_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    msgId, 
                    conversationId, 
                    connectionId, 
                    session.device_id, 
                    Date.now(), 
                    Buffer.from(payload.text || ''), 
                    'plain',
                    metadataJson
                );
            } catch (err: any) {
                console.error('[WS] DB Save Failed:', err.message);
            }

            // Fallthrough to routing logic
          case 'update_file_status':
            if (payload.type === 'update_file_status' && payload.transfer_id && payload.status) {
                try {
                    db.prepare(`
                        UPDATE messages 
                        SET metadata_json = json_set(metadata_json, '$.file_info.status', ?)
                        WHERE json_extract(metadata_json, '$.file_info.transfer_id') = ?
                    `).run(payload.status, payload.transfer_id);
                } catch (err: any) {
                    console.error('[WS] Failed to update file status in DB:', err.message);
                }
            }
            // Fallthrough to route the update to the recipient
          case 'webrtc_signaling':
          case 'file_offer':
          case 'file_pause':
          case 'file_resume':
            // Route to all active devices of the recipient
            let recipientId = payload.to || payload.recipient_id;
            if (typeof recipientId !== 'string' && recipientId) {
              recipientId = String(recipientId);
            }

            console.log(`[WS] INCOMING: type=${payload.type} from=${connectionId} to=${recipientId}`);
            
            if (recipientId) {
              const targetSet = activeClients.get(recipientId);
              if (targetSet && targetSet.size > 0) {
                console.log(`[WS] ROUTING: Delivering ${payload.type} to ${targetSet.size} sockets for ${recipientId}`);
                targetSet.forEach(target => {
                    if (target.socket.readyState === WebSocket.OPEN) {
                        target.socket.send(JSON.stringify({ 
                          ...payload, 
                          from: connectionId,
                          sender_id: connectionId
                        }));
                    }
                });
                
                // Ack success to sender
                socket.send(JSON.stringify({ 
                  type: 'signaling_status', 
                  status: 'delivered', 
                  msg_type: payload.type, 
                  to: recipientId 
                }));
              } else {
                console.warn(`[WS] ROUTING FAILED: type=${payload.type} to=${recipientId} is offline`);
                socket.send(JSON.stringify({ 
                  type: 'signaling_status', 
                  status: 'failed', 
                  reason: 'OFFLINE',
                  msg_type: payload.type, 
                  to: recipientId 
                }));
              }
            }
            break;

          default:
            console.warn(`[WS] Unknown message type: ${payload.type}`);
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
      }
    });

    socket.on('close', () => {
      const currentSet = activeClients.get(connectionId);
      if (currentSet) {
        currentSet.delete(clientInfo);
        console.log(`[WS] socket closed for ${connectionId}. Remaining: ${currentSet.size}`);
        
        if (currentSet.size === 0) {
          activeClients.delete(connectionId);
          console.log(`[WS] User ${connectionId} is now globally OFFLINE`);
          broadcastPresence('offline', connectionId);
        }
      }
    });

    socket.on('error', (err) => {
      console.error(`[WS] Socket error for ${connectionId}:`, err.message);
    });
  });
}
