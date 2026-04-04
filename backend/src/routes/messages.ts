import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { getDb } from '../config/db';
import { activeClients } from './ws';

export default async function messageRoutes(fastify: FastifyInstance) {
  
  // POST /api/messages - Store a new encrypted message
  fastify.post('/api/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    // In a real app we would extract accountId from an auth middleware
    const { sender_account_id, sender_device_id, conversation_id, ciphertext_blob, ciphertext_type, metadata_json } = request.body as any;

    if (!sender_account_id || !conversation_id || !ciphertext_blob) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    const db = getDb();
    const messageId = crypto.randomUUID();

    try {
      // Create conversation if it doesn't exist
      const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(conversation_id);
      if (!conv) {
         db.prepare('INSERT INTO conversations (id, type) VALUES (?, ?)').run(conversation_id, 'dm');
      }

      // Generate a simple monotonic sequence for this conversation
      const seqRow = db.prepare('SELECT COALESCE(MAX(server_seq), 0) + 1 as nextSeq FROM messages WHERE conversation_id = ?').get(conversation_id) as { nextSeq: number };
      const server_seq = seqRow.nextSeq;

      db.prepare(`
        INSERT INTO messages 
        (id, conversation_id, sender_account_id, sender_device_id, server_seq, ciphertext_blob, ciphertext_type, metadata_json) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId, 
        conversation_id, 
        sender_account_id, 
        sender_device_id, 
        server_seq, 
        Buffer.from(ciphertext_blob, 'base64'), 
        ciphertext_type || 'text', 
        metadata_json ? JSON.stringify(metadata_json) : null
      );

      return reply.status(201).send({ messageId, server_seq });
    } catch (e: any) {
      fastify.log.error(e);
      return reply.status(500).send({ error: 'Failed to store message' });
    }
  });

  // GET /api/messages/:conversation_id - Fetch history
  fastify.get('/api/messages/:conversation_id', async (request: FastifyRequest<{ Params: { conversation_id: string }, Querystring: { since_seq?: string } }>, reply: FastifyReply) => {
    const { conversation_id } = request.params;
    const since_seq = parseInt(request.query.since_seq || '0', 10);

    const db = getDb();
    const messages = db.prepare(`
      SELECT id, sender_account_id, sender_device_id, server_seq, 
             ciphertext_blob as text_raw, 
             ciphertext_type, metadata_json, created_at
      FROM messages 
      WHERE conversation_id = ? AND server_seq > ? 
      ORDER BY server_seq ASC
      LIMIT 100
    `).all(conversation_id, since_seq).map((m: any) => {
      let file_info = null;
      if (m.metadata_json) {
        try {
          const parsed = JSON.parse(m.metadata_json);
          file_info = parsed.file_info !== undefined ? parsed.file_info : parsed;
        } catch (e) {
          console.error('[Messages] Failed to parse metadata_json', e);
        }
      }

      return {
        id: m.id,
        sender_account_id: m.sender_account_id,
        text: m.ciphertext_type === 'plain' ? m.text_raw.toString() : '[Encrypted]',
        timestamp: m.created_at,
        file_info
      };
    });

    return reply.status(200).send({ messages });
  });

  // POST /api/messages/file-offer - Persist a file offer and notify recipient via WS
  fastify.post('/api/messages/file-offer', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.headers.authorization || '').replace('Bearer ', '');
    const db = getDb();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = db.prepare(
      'SELECT s.account_id, s.device_id FROM sessions s WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL'
    ).get(tokenHash, new Date().toISOString()) as any;
    
    if (!session) return reply.status(401).send({ error: 'Unauthorized' });

    const { to, file_info } = request.body as any;
    if (!to || !file_info?.transfer_id || !file_info?.name) {
      return reply.status(400).send({ error: 'Missing required fields: to, file_info' });
    }

    const senderId = session.account_id;
    const conversationId = [senderId, to].sort().join(':');
    const msgId = crypto.randomUUID();

    try {
      db.prepare('INSERT OR IGNORE INTO conversations (id, type) VALUES (?, ?)').run(conversationId, 'dm');
      db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, account_id, role) VALUES (?, ?, ?)').run(conversationId, senderId, 'member');
      db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, account_id, role) VALUES (?, ?, ?)').run(conversationId, to, 'member');

      db.prepare(`
        INSERT INTO messages (id, conversation_id, sender_account_id, sender_device_id, server_seq, ciphertext_blob, ciphertext_type, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        msgId,
        conversationId,
        senderId,
        session.device_id,
        Date.now(),
        Buffer.from(''),
        'plain',
        JSON.stringify({ file_info: { ...file_info, status: 'pending' } })
      );

      // Notify recipient via WebSocket if online
      const recipientSockets = activeClients.get(to);
      if (recipientSockets && recipientSockets.size > 0) {
        const wsPayload = JSON.stringify({ type: 'file_offer', from: senderId, file_info });
        recipientSockets.forEach(s => {
          if (s.socket.readyState === 1) s.socket.send(wsPayload);
        });
      }

      return reply.status(201).send({ message_id: msgId, conversation_id: conversationId });
    } catch (e: any) {
      fastify.log.error(e);
      return reply.status(500).send({ error: 'Failed to save file offer' });
    }
  });

  // POST /api/messages/update-file-status - Update file transfer status in DB
  fastify.post('/api/messages/update-file-status', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.headers.authorization || '').replace('Bearer ', '');
    const db = getDb();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = db.prepare(
      'SELECT s.account_id FROM sessions s WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL'
    ).get(tokenHash, new Date().toISOString()) as any;

    if (!session) return reply.status(401).send({ error: 'Unauthorized' });

    const { transfer_id, status, to } = request.body as any;
    if (!transfer_id || !status) return reply.status(400).send({ error: 'Missing transfer_id or status' });

    try {
      db.prepare(`
        UPDATE messages 
        SET metadata_json = json_set(metadata_json, '$.file_info.status', ?)
        WHERE json_extract(metadata_json, '$.file_info.transfer_id') = ?
      `).run(status, transfer_id);

      // Notify the other party via WS if online
      if (to) {
        const recipientSockets = activeClients.get(to);
        if (recipientSockets && recipientSockets.size > 0) {
          const wsPayload = JSON.stringify({ type: 'update_file_status', from: session.account_id, transfer_id, status });
          recipientSockets.forEach(s => {
            if (s.socket.readyState === 1) s.socket.send(wsPayload);
          });
        }
      }

      return reply.status(200).send({ ok: true });
    } catch (e: any) {
      fastify.log.error(e);
      return reply.status(500).send({ error: 'Failed to update file status' });
    }
  });

}
