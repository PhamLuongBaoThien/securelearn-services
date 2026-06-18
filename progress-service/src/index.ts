import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from './config/db';
import app from './app';
import redisClient from './config/redis';

const PORT = process.env.PORT || 5005;

const bootServer = async () => {
  try {
    console.log('Đang khởi động Progress Service...');

    await connectDB();

    app.listen(PORT, () => {
      console.log(`Progress Service đang chạy tại http://localhost:${PORT}`);
      console.log(`API Progress: http://localhost:${PORT}/api/progress`);
    });
  } catch (error) {
    console.error('Khởi động progress service thất bại:', error);
    process.exit(1);
  }
};

const gracefulShutdown = async () => {
  console.log('\nĐang tắt Progress Service...');
  redisClient.disconnect();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

bootServer();
