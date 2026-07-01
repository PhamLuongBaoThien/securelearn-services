import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { verifyAccessToken } from './auth.service';
import type { RecipientType } from './preference.service';

type SocketIdentity = { userId: string; recipientType: RecipientType };
let io: Server | null = null;
let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let adapterReady = false;

const roomFor = (recipientType: RecipientType, userId: string) => `${recipientType}:${userId}`;

export const initializeRealtime = async (server: HttpServer) => {
  io = new Server(server, {
    path: '/socket.io',
    cors: {
      origin: process.env.SOCKET_CORS_ORIGIN || process.env.CLIENT_URL || 'http://localhost:5173',
      credentials: true,
    },
  });

  const redisUri = process.env.REDIS_URI || 'redis://localhost:6379';
  publisher = new Redis(redisUri, { maxRetriesPerRequest: 1 });
  subscriber = publisher.duplicate();
  await Promise.all([publisher.ping(), subscriber.ping()]);
  io.adapter(createAdapter(publisher, subscriber));
  adapterReady = true;

  io.use(async (socket, next) => {
    try {
      const authorization = String(socket.handshake.auth?.token || socket.handshake.headers.authorization || '');
      const token = authorization.replace(/^Bearer\s+/i, '');
      const identity = await verifyAccessToken(token);
      const recipientType: RecipientType = identity.role === 'ADMIN' ? 'ADMIN' : 'USER';
      socket.data.identity = { userId: identity.id, recipientType } satisfies SocketIdentity;
      next();
    } catch (error) {
      next(new Error(error instanceof Error ? error.message : 'Không thể xác thực socket.'));
    }
  });

  io.on('connection', socket => {
    const identity = socket.data.identity as SocketIdentity;
    void socket.join(roomFor(identity.recipientType, identity.userId));
    console.log(JSON.stringify({ level: 'info', event: 'socket.connected', recipientType: identity.recipientType, userId: identity.userId }));
  });
};

export const realtimeReady = () => Boolean(io && adapterReady);

export const emitToRecipient = (recipientType: RecipientType, userId: string, event: string, payload: unknown) => {
  io?.to(roomFor(recipientType, userId)).emit(event, payload);
};

export const shutdownRealtime = async () => {
  adapterReady = false;
  if (io) await new Promise<void>(resolve => io!.close(() => resolve()));
  io = null;
  await Promise.allSettled([publisher?.quit(), subscriber?.quit()]);
  publisher = null;
  subscriber = null;
};