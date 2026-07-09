import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { registerRoutes } from './routes/index.routes';

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
registerRoutes(app);

app.get('/health/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', service: 'content-service' });
});

const readiness = (_req: Request, res: Response) => {
  const mongo = mongoose.connection.readyState === 1;
  res.status(mongo ? 200 : 503).json({
    status: mongo ? 'OK' : 'DEGRADED',
    service: 'content-service',
    dependencies: { mongo },
  });
};
app.get('/health/ready', readiness);
app.get('/health', readiness);

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ContentService]', err);
  if (err instanceof multer.MulterError) {
    res.status(400).json({
      status: 'ERR',
      message: err.code === 'LIMIT_FILE_SIZE' ? 'Ảnh tải lên tối đa 5MB.' : 'Không thể tải ảnh.',
    });
    return;
  }
  res.status(err.status || 500).json({
    status: 'ERR',
    message: err.status ? err.message : 'Lỗi hệ thống máy chủ.',
  });
});

export default app;
