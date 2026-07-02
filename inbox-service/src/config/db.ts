import mongoose from 'mongoose';
export const connectDatabase = async () => { if (!process.env.MONGO_URI) throw new Error('MONGO_URI_INBOX chưa được cấu hình.'); await mongoose.connect(process.env.MONGO_URI); console.log('Inbox MongoDB connected'); };
