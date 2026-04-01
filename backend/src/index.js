import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import authRoutes from './routes/auth';
import wsRoutes from './routes/ws';
const fastify = Fastify({ logger: true });
// Register WebSocket Support
fastify.register(fastifyWebsocket);
// Register Routes
fastify.register(authRoutes);
fastify.register(wsRoutes);
// Health check
fastify.get('/ping', async (request, reply) => {
    return { status: 'ok', time: new Date().toISOString() };
});
const start = async () => {
    try {
        const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
        await fastify.listen({ port, host: '0.0.0.0' });
        fastify.log.info(`Server listening on port ${port}`);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=index.js.map