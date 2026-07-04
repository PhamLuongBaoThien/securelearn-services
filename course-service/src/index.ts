// ========================
// Entry Point: Khởi động Course Service
// ========================
import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from './config/db';
import { RabbitMQConnection, startGrpcServer } from '@securelearn/common';
import { registerEventHandlers } from './events/handlers';
import app from './app';
import { createInternalGrpcServer } from './grpc/server';
import { createServer } from 'http';
import { LessonDiscussion } from './models/lessonDiscussion.model';
import { initializeDiscussionRealtime, shutdownDiscussionRealtime } from './services/discussionRealtime.service';
import { startCourseOutboxWorker, stopCourseOutboxWorker } from './services/courseOutbox.service';
import { CourseAnnouncement } from './models/courseAnnouncement.model';
import { CourseAnnouncementReadState } from './models/courseAnnouncementReadState.model';
import { CourseOutboxEvent } from './models/courseOutboxEvent.model';

const PORT = process.env.PORT || 5002;
const GRPC_BIND = process.env.COURSE_GRPC_BIND || '0.0.0.0:6002';
let grpcServer: { forceShutdown: () => void } | null = null;
const httpServer = createServer(app);

const bootServer = async () => {
  try {
    console.log('Đang khởi động Course Service...');

    // Kết nối MongoDB
    await connectDB();


    await LessonDiscussion.syncIndexes();
    await CourseAnnouncement.syncIndexes();
    await CourseAnnouncementReadState.syncIndexes();
    await CourseOutboxEvent.syncIndexes();
    // Kết nối RabbitMQ
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    await RabbitMQConnection.getInstance().connect(rabbitmqUrl);

    // Đăng ký lắng nghe events từ các service khác
    await registerEventHandlers();
    startCourseOutboxWorker();

    grpcServer = await startGrpcServer(createInternalGrpcServer(), GRPC_BIND);

    try {
      await initializeDiscussionRealtime(httpServer);
    } catch (error) {
      console.error('[CourseDiscussionRealtime] chạy fallback polling:', error);
    }

    httpServer.listen(PORT, () => {
      console.log('Course Service đang chạy tại http://localhost:' + PORT);
      console.log('API Courses: http://localhost:' + PORT + '/api/courses');
      console.log('Course gRPC đang chạy tại ' + GRPC_BIND);
    });
  } catch (error) {
    console.error('Khởi động server thất bại:', error);
    process.exit(1);
  }
};

// ===== Graceful Shutdown =====
const gracefulShutdown = async () => {
  console.log('\nĐang tắt Course Service...');
  grpcServer?.forceShutdown();
  stopCourseOutboxWorker();
  await shutdownDiscussionRealtime();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await RabbitMQConnection.getInstance().close();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

bootServer();


