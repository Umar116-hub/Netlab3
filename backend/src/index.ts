import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import authRoutes from './routes/auth';
import wsRoutes from './routes/ws';
import messageRoutes from './routes/messages';
import fileRoutes from './routes/files';

const fastify = Fastify({ logger: true });

// Register WebSocket Support
fastify.register(fastifyWebsocket);

// Register Routes
fastify.register(authRoutes);
fastify.register(wsRoutes);
fastify.register(messageRoutes);
fastify.register(fileRoutes);

// Health check
fastify.get('/ping', async (request, reply) => {
  return { status: 'ok', time: new Date().toISOString() };
});

const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
