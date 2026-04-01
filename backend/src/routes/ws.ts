import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import crypto from 'crypto';
import { getDb } from '../config/db';

type ConnectedClient = {
  socket: WebSocket;
  accountId: string;
  deviceId: string;
};

// Global in-memory map of active sessions (keyed by "accountId:deviceId")
export const activeClients = new Map<string, ConnectedClient>();

export function getClientStatus() {
  return Array.from(activeClients.keys()).map(id => {
    const c = activeClients.get(id);
    return { id, deviceId: c?.deviceId, readyState: c?.socket.readyState };
  });
}

export default async function wsRoutes(fastify: FastifyInstance) {
  // In @fastify/websocket v11, the handler receives (socket, request) directly
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

    activeClients.set(connectionId, {
      socket,
      accountId: session.account_id,
      deviceId: session.device_id,
    });

    console.log(`[WS] Client authenticated: ${connectionId} (User: ${session.username || 'unknown'})`);
    socket.send(JSON.stringify({ type: 'authenticated', accountId: session.account_id }));

    socket.on('message', (raw: WebSocket.RawData) => {
      // Ensure we only handle messages for the currently registered socket for this ID
      if (activeClients.get(connectionId)?.socket !== socket) {
        console.warn(`[WS] Ignoring message from ghost socket for ${connectionId}`);
        return;
      }

      try {
        const payload = JSON.parse(raw.toString());

        switch (payload.type) {
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }));
            break;

          case 'chat_message':
          case 'webrtc_signaling':
          case 'file_offer':
            // Route to recipient if online
            let recipientId = payload.to || payload.recipient_id;
            // Normalize ID: ensure it's a string
            if (typeof recipientId !== 'string' && recipientId) {
              recipientId = String(recipientId);
            }

            console.log(`[WS] INCOMING: type=${payload.type} from=${connectionId} to=${recipientId}`);
            
            if (recipientId) {
              const target = activeClients.get(recipientId);
              if (target && target.socket.readyState === WebSocket.OPEN) {
                console.log(`[WS] ROUTING SUCCESS: Delivering ${payload.type} to ${recipientId}`);
                target.socket.send(JSON.stringify({ 
                  ...payload, 
                  from: connectionId,
                  sender_id: connectionId,
                  trace_id: Math.random().toString(36).substring(7)
                }));
                
                // Ack success to sender
                socket.send(JSON.stringify({ 
                  type: 'signaling_status', 
                  status: 'delivered', 
                  msg_type: payload.type, 
                  to: recipientId 
                }));
              } else {
                const status = target ? `READYSTATE ${target.socket.readyState}` : 'ID_NOT_FOUND';
                console.warn(`[WS] ROUTING FAILED: type=${payload.type} to=${recipientId} status=${status}`);
                
                // Ack failure to sender
                socket.send(JSON.stringify({ 
                  type: 'signaling_status', 
                  status: 'failed', 
                  reason: status,
                  msg_type: payload.type, 
                  to: recipientId 
                }));
              }
            } else {
              console.warn(`[WS] ROUTING ERROR: No destination ID found in payload type=${payload.type}`);
              console.log(`[WS] Payload dump:`, JSON.stringify(payload));
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
      // Only remove if THIS socket is the one currently in the map
      if (activeClients.get(connectionId)?.socket === socket) {
        console.log(`[WS] Client disconnected (Cleaning up): ${connectionId}`);
        activeClients.delete(connectionId);
      } else {
        console.log(`[WS] Ghost connection closed for ${connectionId} (Ignoring cleanup as new session is active)`);
      }
    });

    socket.on('error', (err) => {
      if (activeClients.get(connectionId)?.socket === socket) {
        console.error(`[WS] Socket error for ${connectionId}:`, err.message);
      }
    });
  });
}
