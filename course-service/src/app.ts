// ========================
// Express App Configuration — Course Service
// ========================
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import mongoose from 'mongoose';
import { RabbitMQConnection } from '@securelearn/common';
import redisClient from './config/redis';
import { discussionRealtimeReady } from './services/discussionRealtime.service';

import routes from './routes/index.routes';

const app: Application = express();

// ===== Middlewares =====
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' })); // Tăng limit vì sections có thể lớn
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Khởi tạo các routes
routes(app);

// ===== Health Check =====
app.get('/health/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', service: 'src' });
});
app.get('/health/ready', (_req: Request, res: Response) => {
  const dependencies = {
    mongo: mongoose.connection.readyState === 1,
    rabbitmq: RabbitMQConnection.getInstance().isConnected(),
    redis: redisClient.status === 'ready',
    realtime: discussionRealtimeReady(),
  };
  const healthy = dependencies.mongo && dependencies.rabbitmq && dependencies.redis;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'OK' : 'DEGRADED',
    service: 'course-service',
    dependencies,
  });
});
// ===== Error Handler =====
app.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server Error:', {
    message: err.message,
    code: err.code,
    stack: err.stack,
  });

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Ảnh khóa học tối đa 5MB.'
      : 'Không thể tải ảnh khóa học. Vui lòng kiểm tra file và thử lại.';
    res.status(400).json({ success: false, message });
    return;
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.status ? err.message : 'Lỗi hệ thống máy chủ.',
  });
});

export default app;

