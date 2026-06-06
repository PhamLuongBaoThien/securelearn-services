// ========================
// MongoDB Connection Helper — Payment Service
// Mục đích:
// - kết nối MongoDB bằng biến môi trường MONGO_URI
// - dùng chung cho payment-service trước khi mount routes
// Hàm chính:
// - connectDB(): mở kết nối MongoDB và fail-fast nếu thiếu cấu hình
// ========================
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

export const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    const conn = await mongoose.connect(mongoURI);
    console.log(`MongoDB Connected (Payment Service): ${conn.connection.host}`);
  } catch (error: any) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};
