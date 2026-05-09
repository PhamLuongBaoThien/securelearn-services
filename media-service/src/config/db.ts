import mongoose from 'mongoose';

export const connectDB = async (): Promise<void> => {
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  const conn = await mongoose.connect(mongoURI);
  console.log(`MongoDB Connected (Media Service): ${conn.connection.host}`);
};
