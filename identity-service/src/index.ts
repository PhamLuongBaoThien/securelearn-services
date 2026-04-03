// ========================
// Entry Point: Khởi động Identity Service
// ========================
import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from './config/db';
import app from './app';

const PORT = process.env.PORT || 5001;

const bootServer = async () => {
  try {
    console.log('⏳ Đang khởi động Identity Service...');

    // Kết nối MongoDB Atlas
    await connectDB();

    // Bật server Express
    app.listen(PORT, () => {
      console.log(`✅ Identity Service đang chạy tại http://localhost:${PORT}`);
      console.log(`📌 API Auth: http://localhost:${PORT}/api/v1/auth`);
    });
  } catch (error) {
    console.error('❌ Khởi động server thất bại:', error);
    process.exit(1);
  }
};

bootServer();
