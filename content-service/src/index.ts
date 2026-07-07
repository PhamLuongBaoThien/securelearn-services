import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import app from './app';
import { connectDB } from './config/db';

const PORT = Number(process.env.PORT || 5008);
let server: ReturnType<typeof app.listen> | undefined;

const boot = async () => {
  await connectDB();
  server = app.listen(PORT, () => console.log(`Content Service running at http://localhost:${PORT}`));
};

const shutdown = async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  await mongoose.disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
void boot().catch((error) => {
  console.error('Content Service failed to start:', error);
  process.exit(1);
});
