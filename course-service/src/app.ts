// ========================
// Express App Configuration — Course Service
// ========================
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

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
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', service: 'course-service' });
});

// ===== Error Handler =====
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ success: false, message: 'Lỗi hệ thống máy chủ.' });
});

export default app;
