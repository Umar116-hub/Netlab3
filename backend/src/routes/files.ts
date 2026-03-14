import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { getDb } from '../config/db';

export default async function fileRoutes(fastify: FastifyInstance) {
  
  // POST /api/files/relay - Upload chunked encrypted blobs
  fastify.post('/api/files/relay', async (request: FastifyRequest, reply: FastifyReply) => {
    // Requires multipart/form-data or binary buffers in reality, simplified here
    const { transfer_id, chunk_index, ciphertext_chunk } = request.body as any;

    if (!transfer_id || chunk_index === undefined || !ciphertext_chunk) {
      return reply.status(400).send({ error: 'Missing required chunk fields' });
    }

    const db = getDb();
    
    // Validate transfer authorization
    const transferDef = db.prepare('SELECT status FROM file_transfers WHERE id = ?').get(transfer_id) as any;
    if (!transferDef) {
       return reply.status(404).send({ error: 'Transfer session not found.' });
    }

    const chunk_hash = crypto.createHash('sha256').update(ciphertext_chunk).digest('hex');

    try {
      db.prepare(`
        INSERT INTO file_chunks_relay (transfer_id, chunk_index, ciphertext_chunk, chunk_hash_sha256) 
        VALUES (?, ?, ?, ?)
      `).run(transfer_id, chunk_index, Buffer.from(ciphertext_chunk, 'base64'), chunk_hash);

      return reply.status(201).send({ message: 'Chunk accepted', chunk_index });
    } catch (e: any) {
       fastify.log.error(e);
       return reply.status(500).send({ error: 'Failed to save chunk' });
    }
  });

  // GET /api/files/relay/:transfer_id/:chunk_index
  fastify.get('/api/files/relay/:transfer_id/:chunk_index', async (request: FastifyRequest<{ Params: { transfer_id: string, chunk_index: string } }>, reply: FastifyReply) => {
    const { transfer_id, chunk_index } = request.params;

    const db = getDb();
    const chunkRecord = db.prepare(`
      SELECT HEX(ciphertext_chunk) as ciphertext_chunk_hex 
      FROM file_chunks_relay 
      WHERE transfer_id = ? AND chunk_index = ?
    `).get(transfer_id, parseInt(chunk_index, 10)) as any;

    if (!chunkRecord) {
      return reply.status(404).send({ error: 'Chunk not found' });
    }

    return reply.status(200).send({
      chunk_index: parseInt(chunk_index, 10),
      ciphertext_chunk: chunkRecord.ciphertext_chunk_hex
    });
  });

  // DELETE /api/files/relay/:transfer_id - Cleanup relay files as specified in PRD (delete immediately when successful sync)
  fastify.delete('/api/files/relay/:transfer_id', async (request: FastifyRequest<{ Params: { transfer_id: string } }>, reply: FastifyReply) => {
    const { transfer_id } = request.params;
    const db = getDb();

    db.prepare('DELETE FROM file_chunks_relay WHERE transfer_id = ?').run(transfer_id);
    db.prepare('UPDATE file_transfers SET status = ? WHERE id = ?').run('completed', transfer_id);

    return reply.status(200).send({ message: 'Relay files purged' });
  });

}
