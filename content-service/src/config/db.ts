import mongoose from 'mongoose';

export const connectDB = async (): Promise<void> => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not defined');
  const connection = await mongoose.connect(uri);
  console.log(`MongoDB Connected (Content Service): ${connection.connection.host}`);
};
