import argon2 from 'argon2';
import crypto from 'crypto';
import { getDb } from '../config/db';
export default async function authRoutes(fastify) {
    fastify.post('/api/auth/register', async (request, reply) => {
        const { username, password, device_id, identity_key_public, identity_key_fingerprint } = request.body;
        if (!username || !password || !device_id || !identity_key_public || !identity_key_fingerprint) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }
        const db = getDb();
        // Hash password
        const password_hash = await argon2.hash(password);
        const accountId = crypto.randomUUID();
        try {
            db.transaction(() => {
                // Create account
                db.prepare('INSERT INTO accounts (id, username, password_hash) VALUES (?, ?, ?)').run(accountId, username, password_hash);
                // Register initial device
                db.prepare('INSERT INTO devices (id, account_id, device_id, identity_key_public, identity_key_fingerprint) VALUES (?, ?, ?, ?, ?)')
                    .run(crypto.randomUUID(), accountId, device_id, Buffer.from(identity_key_public, 'base64'), identity_key_fingerprint);
            })();
            return reply.status(201).send({ message: 'User registered successfully', accountId });
        }
        catch (e) {
            if (e.message.includes('UNIQUE constraint failed: accounts.username')) {
                return reply.status(409).send({ error: 'Username already taken' });
            }
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/api/auth/login', async (request, reply) => {
        const { username, password, device_id } = request.body;
        if (!username || !password) {
            return reply.status(400).send({ error: 'Missing username or password' });
        }
        const db = getDb();
        const account = db.prepare('SELECT id, password_hash FROM accounts WHERE username = ? AND deleted_at IS NULL').get(username);
        if (!account) {
            return reply.status(401).send({ error: 'Invalid credentials' });
        }
        const isValid = await argon2.verify(account.password_hash, password);
        if (!isValid) {
            return reply.status(401).send({ error: 'Invalid credentials' });
        }
        // Verify device exists (in a real app, prompts for adding a new device if missing)
        let internalDeviceId = null;
        if (device_id) {
            const device = db.prepare('SELECT id FROM devices WHERE account_id = ? AND device_id = ?').get(account.id, device_id);
            if (device)
                internalDeviceId = device.id;
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
            account_id: account.id
        });
    });
}
//# sourceMappingURL=auth.js.map