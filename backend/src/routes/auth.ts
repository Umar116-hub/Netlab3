import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import crypto from 'crypto';
import { getDb } from '../config/db';
import { Account, Device, Session } from '../../../shared/types/auth';

export default async function authRoutes(fastify: FastifyInstance) {
  
  fastify.post('/api/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username, password, device_id, identity_key_public, identity_key_fingerprint } = request.body as any;
    
    if (!username || !password || !device_id || !identity_key_public || !identity_key_fingerprint) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    const db = getDb();
    
    // Hash password
    const password_hash = await argon2.hash(password);
    const accountId = crypto.randomUUID();

    try {
      db.transaction(() => {
        // Check if this is the first account
        const countRow = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
        const is_admin = countRow.count === 0 ? 1 : 0;

        // Create account
        db.prepare('INSERT INTO accounts (id, username, password_hash, is_admin) VALUES (?, ?, ?, ?)').run(accountId, username, password_hash, is_admin);
        
        // Register initial device
        db.prepare('INSERT INTO devices (id, account_id, device_id, identity_key_public, identity_key_fingerprint) VALUES (?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), accountId, device_id, Buffer.from(identity_key_public, 'base64'), identity_key_fingerprint);
      })();
      
      return reply.status(201).send({ message: 'User registered successfully', accountId });
    } catch (e: any) {
      console.error('Registration error:', e);
      if (e.message.includes('UNIQUE constraint failed: accounts.username')) {
        return reply.status(409).send({ error: 'Username already taken' });
      }
      if (e.message.includes('UNIQUE constraint failed: devices.device_id')) {
        return reply.status(409).send({ error: 'Device ID conflict. Clear site data or restart.' });
      }
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Admin Route: Delete an account (Soft Delete)
  fastify.delete('/api/auth/account/:targetId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { targetId } = request.params as { targetId: string };
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
       return reply.status(401).send({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');

    const db = getDb();
    
    // Validate session and check if requester is admin
    const session = db.prepare(`
        SELECT a.is_admin 
        FROM sessions s 
        JOIN accounts a ON s.account_id = a.id 
        WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND s.revoked_at IS NULL
    `).get(token_hash) as { is_admin: number } | undefined;

    if (!session) return reply.status(401).send({ error: 'Invalid session' });
    if (session.is_admin !== 1) return reply.status(403).send({ error: 'Only admins can delete accounts' });

    try {
        db.prepare('UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(targetId);
        // Also fire off a WS signal to broadcast the deletion to online peers? Not strictly required, they'll refresh.
        return reply.status(200).send({ message: 'Account deleted successfully' });
    } catch (e) {
        console.error('[AUTH] Delete user error', e);
        return reply.status(500).send({ error: 'Failed to delete account' });
    }
  });

  fastify.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { username, password, device_id } = request.body as any;

      if (!username || !password) {
        return reply.status(400).send({ error: 'Missing username or password' });
      }

      const db = getDb();
      const account = db.prepare('SELECT id, password_hash, is_admin FROM accounts WHERE username = ? AND deleted_at IS NULL').get(username) as Account & { is_admin: number } | undefined;

      if (!account) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const isValid = await argon2.verify(account.password_hash, password);
      if (!isValid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // ... internal device id check
      let internalDeviceId: string | null = null;
      if (device_id) {
          const device = db.prepare('SELECT id FROM devices WHERE account_id = ? AND device_id = ?').get(account.id, device_id) as Device | undefined;
          if (device) internalDeviceId = device.id;
      }

      // Create session
      const sessionId = crypto.randomUUID();
      const token = crypto.randomBytes(32).toString('hex');
      const token_hash = crypto.createHash('sha256').update(token).digest('hex');
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 day expiration

      db.prepare('INSERT INTO sessions (id, account_id, device_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, account.id, internalDeviceId, token_hash, expiresAt.toISOString());

      return reply.status(200).send({ 
        message: 'Login successful', 
        token,
        account_id: account.id,
        is_admin: account.is_admin === 1
      });
    } catch (err) {
      console.error('[AUTH] Login Error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Simple global discovery for web testing
  fastify.get('/api/contacts/discovery', async (_request, reply) => {
    const db = getDb();
    const users = db.prepare('SELECT id, username FROM accounts WHERE deleted_at IS NULL').all() as any[];
    console.log(`[Discovery] Returning ${users.length} registered users`);
    return reply.send(users.map(u => ({
      id: u.id,
      name: u.username,
      status: 'online' // Simplification for test
    })));
  });
}
