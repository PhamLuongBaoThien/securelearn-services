import express, { Application, NextFunction, Request, Response } from 'express';
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

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', service: 'media-service' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ status: 'ERR', message: 'Lỗi hệ thống máy chủ.' });
});

export default app;
