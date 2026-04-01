import { FastifyInstance } from 'fastify';
type ConnectedClient = {
    socket: WebSocket;
    accountId: string;
    deviceId: string;
};
export declare const activeClients: Map<string, ConnectedClient>;
export default function wsRoutes(fastify: FastifyInstance): Promise<void>;
export {};
//# sourceMappingURL=ws.d.ts.map