import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/db';
import { RabbitMQConnection } from '@securelearn/common';
import { registerEventHandlers } from './events/handlers';
import videoAssetService from './services/videoAsset.service';
import documentAssetService from './services/documentAsset.service';

const PORT = process.env.PORT || 5003;

const bootServer = async () => {
  try {
    console.log('Đang khởi động Media Service...');
    await connectDB();

    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    await RabbitMQConnection.getInstance().connect(rabbitmqUrl);
    await registerEventHandlers();
    videoAssetService.startOrphanCleanupJob();
    videoAssetService.startProcessingTimeoutJob();
    documentAssetService.startOrphanCleanupJob();

    app.listen(PORT, () => {
      console.log(`Media Service đang chạy tại http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Khởi động Media Service thất bại:', error);
    process.exit(1);
  }
};

const gracefulShutdown = async () => {
  console.log('\nĐang tắt Media Service...');
  await RabbitMQConnection.getInstance().close();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

bootServer();
