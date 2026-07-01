import dotenv from 'dotenv';
dotenv.config();
import app from './app';
import { connectDB } from './config/db';
import redisClient from './config/redis';
import { RabbitMQConnection } from '@securelearn/common';
import { registerEventHandlers } from './events/handlers';
import { identityGrpcClient } from './config/identityGrpc';
import { courseGrpcClient } from './config/courseGrpc';
import { Notification } from './models/notification.model';
import { Campaign } from './models/campaign.model';
import { seedTemplates } from './services/seed.service';
const PORT = process.env.PORT || 5006;
const boot = async () => { await connectDB(); await Notification.updateMany({ recipientType: { $exists: false } }, { $set: { recipientType: 'USER', category: 'SYSTEM', priority: 'NORMAL', actionUrl: '', actionLabel: '' } }); try { await Notification.collection.dropIndex('userId_1_sourceKey_1'); } catch (error: any) { if (error?.codeName !== 'IndexNotFound') console.warn('[NotificationMigration] drop legacy index:', error.message); } await Notification.syncIndexes(); await Campaign.updateMany({ audience: 'ALL_STUDENTS' }, { $set: { audience: 'ALL_LEARNERS' } }); await seedTemplates(); try {
    await RabbitMQConnection.getInstance().connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672');
    await registerEventHandlers();
}
catch (e) {
    console.error('[NotificationEvent] RabbitMQ chưa sẵn sàng:', e);
} app.listen(PORT, () => console.log(`Notification Service đang chạy tại http://localhost:${PORT}`)); };
const shutdown = async () => { redisClient.disconnect(); identityGrpcClient.close(); courseGrpcClient.close(); await RabbitMQConnection.getInstance().close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
boot().catch(e => { console.error('Khởi động notification service thất bại:', e); process.exit(1); });

