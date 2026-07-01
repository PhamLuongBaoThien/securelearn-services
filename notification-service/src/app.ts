import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { RabbitMQConnection } from '@securelearn/common';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from './routes/index.routes';
import redisClient from './config/redis';
import { realtimeReady } from './services/realtime.service';

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
routes(app);
app.get('/health', (_req, res) => {
  const dependencies = {
    mongo: mongoose.connection.readyState === 1,
    rabbitmq: RabbitMQConnection.getInstance().isConnected(),
    redis: redisClient.status === 'ready',
    realtime: realtimeReady(),
  };
  const healthy = Object.values(dependencies).every(Boolean);
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'OK' : 'DEGRADED', service: 'notification-service', dependencies });
});
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ status: 'ERR', message: err.message || 'Lỗi hệ thống máy chủ.' }));
export default app;