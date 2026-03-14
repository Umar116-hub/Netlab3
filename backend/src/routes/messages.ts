import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { getDb } from '../config/db';

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
             HEX(ciphertext_blob) as ciphertext_blob_hex, 
             ciphertext_type, metadata_json, created_at, deleted_at 
      FROM messages 
      WHERE conversation_id = ? AND server_seq > ? 
      ORDER BY server_seq ASC
      LIMIT 100
    `).all(conversation_id, since_seq);

    return reply.status(200).send({ messages });
  });

}
