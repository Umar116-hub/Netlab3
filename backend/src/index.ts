import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import authRoutes from './routes/auth';
import wsRoutes, { getClientStatus } from './routes/ws';
import messageRoutes from './routes/messages';
import fileRoutes from './routes/files';

import * as fs from 'fs';
import * as path from 'path';

const fastify = Fastify({ 
  logger: true,
  disableRequestLogging: false,
  https: {
    key: fs.readFileSync(path.join(__dirname, '../certs/key.pem')),
    cert: fs.readFileSync(path.join(__dirname, '../certs/cert.pem'))
  }
});

// CORS — allow all LAN origins in development
fastify.register(fastifyCors, {
  origin: true,         // echo back the request origin
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

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

// Debug active clients
fastify.get('/api/debug/clients', async (request, reply) => {
  return getClientStatus();
});

const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3004;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${port}`);
  } catch (err) {
    console.error('SERVER BOOT ERROR:', err);
    process.exit(1);
  }
};

start();
