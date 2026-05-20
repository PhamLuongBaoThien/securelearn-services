// ========================
// Express App Configuration
// ========================
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import multer from 'multer';

// Load cấu hình Passport (Google OAuth2 strategy)
import './config/passport';

import routes from './routes/index.routes';

const app: Application = express();

// ===== Middlewares =====
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(passport.initialize());

// Khởi tạo các routes
routes(app);

// ===== Health Check =====
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', service: 'identity-service' });
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
      ? 'Ảnh đại diện tối đa 5MB.'
      : 'Không thể tải ảnh đại diện. Vui lòng kiểm tra file và thử lại.';
    res.status(400).json({ success: false, message });
    return;
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.status ? err.message : 'Lỗi hệ thống máy chủ.',
  });
});

export default app;
