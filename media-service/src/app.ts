import express, { Application, NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import routes from './routes/index.routes';

const app: Application = express();

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

routes(app);

app.get('/health/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', service: 'media-service' });
});
app.get('/health/ready', (_req: Request, res: Response) => {
  const mongo = mongoose.connection.readyState === 1;
  res.status(mongo ? 200 : 503).json({ status: mongo ? 'OK' : 'DEGRADED', service: 'media-service', dependencies: { mongo } });
});

app.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server Error:', {
    message: err.message,
    code: err.code,
    stack: err.stack,
  });

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Tài liệu đính kèm tối đa 50MB.'
      : 'Không thể tải tài liệu. Vui lòng kiểm tra file và thử lại.';
    res.status(400).json({ status: 'ERR', message });
    return;
  }

  res.status(err.status || 500).json({
    status: 'ERR',
    message: err.status ? err.message : 'Lỗi hệ thống máy chủ.',
  });
});

export default app;
