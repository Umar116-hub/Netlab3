import crypto from 'crypto';
import { getDb } from '../config/db';
// Global in-memory map of active sessions
export const activeClients = new Map();
export default async function wsRoutes(fastify) {
    fastify.get('/ws', { websocket: true }, (connection, req) => {
        const socket = connection.socket;
        // Extract token from query param (e.g. ?token=abc)
        const token = req.query.token;
        if (!token) {
            socket.send(JSON.stringify({ type: 'error', message: 'Missing token' }));
            return socket.close(1008, 'Token required');
        }
        const token_hash = crypto.createHash('sha256').update(token).digest('hex');
        const db = getDb();
        // Validate token
        const session = db.prepare('SELECT account_id, device_id FROM sessions WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL')
            .get(token_hash, new Date().toISOString());
        if (!session || !session.device_id) {
            socket.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
            return socket.close(1008, 'Unauthorized');
        }
        const connectionId = `${session.account_id}:${session.device_id}`;
        activeClients.set(connectionId, {
            socket,
            accountId: session.account_id,
            deviceId: session.device_id
        });
        fastify.log.info(`Device connected via WS: ${connectionId}`);
        socket.send(JSON.stringify({ type: 'authenticated', accountId: session.account_id }));
        socket.on('message', (message) => {
            try {
                const payload = JSON.parse(message.toString());
                switch (payload.type) {
                    case 'ping':
                        socket.send(JSON.stringify({ type: 'pong' }));
                        break;
                    // Future cases: message sending, delivery receipts, webrtc signaling
                    case 'chat_message':
                        // Route message to recipient
                        break;
                    default:
                        fastify.log.warn(`Unknown message type: ${payload.type}`);
                }
            }
            catch (e) {
                socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
            }
        });
        socket.on('close', () => {
            fastify.log.info(`Device disconnected: ${connectionId}`);
            activeClients.delete(connectionId);
        });
    });
}
//# sourceMappingURL=ws.js.map