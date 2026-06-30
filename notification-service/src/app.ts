import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { RabbitMQConnection } from '@securelearn/common';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from './routes/index.routes';
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
routes(app);
app.get('/health', (_req, res) => { const mongo = mongoose.connection.readyState === 1, rabbitmq = RabbitMQConnection.getInstance().isConnected(); res.status(mongo && rabbitmq ? 200 : 503).json({ status: mongo && rabbitmq ? 'OK' : 'DEGRADED', service: 'notification-service', dependencies: { mongo, rabbitmq } }); });
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ status: 'ERR', message: err.message || 'Lỗi hệ thống máy chủ.' }));
export default app;

