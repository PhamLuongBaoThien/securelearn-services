import express, { Application, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import cookieParser from 'cookie-parser';
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
  res.status(200).json({ status: 'OK', service: 'progress-service' });
});
app.get('/health/ready', (_req: Request, res: Response) => {
  const mongo = mongoose.connection.readyState === 1;
  res.status(mongo ? 200 : 503).json({ status: mongo ? 'OK' : 'DEGRADED', service: 'progress-service', dependencies: { mongo } });
});

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server Error:', {
    message: err.message,
    stack: err.stack,
  });

  res.status(err.status || 500).json({
    status: 'ERR',
    message: err.status ? err.message : 'Lỗi hệ thống máy chủ.',
  });
});

export default app;
