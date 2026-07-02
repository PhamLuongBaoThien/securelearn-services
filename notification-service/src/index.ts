import dotenv from "dotenv";
dotenv.config();
import { createServer } from "http";
import app from "./app";
import { connectDB } from "./config/db";
import redisClient from "./config/redis";
import { RabbitMQConnection } from "@securelearn/common";
import { registerEventHandlers } from "./events/handlers";
import { identityGrpcClient } from "./config/identityGrpc";
import { courseGrpcClient } from "./config/courseGrpc";
import { Notification } from "./models/notification.model";
import { Campaign } from "./models/campaign.model";
import { seedTemplates } from "./services/seed.service";
import emailService from "./services/email.service";
import {
  initializeRealtime,
  shutdownRealtime,
} from "./services/realtime.service";

const PORT = process.env.PORT || 5006;
const server = createServer(app);
const rabbit = RabbitMQConnection.getInstance();
let shuttingDown = false;
let rabbitRetryTimer: NodeJS.Timeout | null = null;
let removeRabbitConnectedListener: (() => void) | null = null;

const connectRabbit = async () => {
  try {
    await rabbit.connect(
      process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672",
    );
  } catch (error) {
    console.error(
      "[NotificationEvent] RabbitMQ chưa sẵn sàng, sẽ thử lại:",
      error,
    );
    if (!shuttingDown && !rabbitRetryTimer) {
      rabbitRetryTimer = setTimeout(() => {
        rabbitRetryTimer = null;
        void connectRabbit();
      }, 5000);
    }
  }
};

const boot = async () => {
  await connectDB();
  await Notification.updateMany(
    { recipientType: { $exists: false } },
    {
      $set: {
        recipientType: "USER",
        category: "SYSTEM",
        priority: "NORMAL",
        actionUrl: "",
        actionLabel: "",
      },
    },
  );
  await Notification.updateMany(
    {
      type: {
        $in: [
          "REPORT_CREATED",
          "SUPPORT_REQUEST_CREATED",
          "FEEDBACK_CREATED",
          "INBOX_USER_REPLIED",
          "INBOX_ADMIN_REPLIED",
          "INBOX_STATUS_CHANGED",
        ],
      },
    },
    { $set: { category: "INBOX" } },
  );
  try {
    await Notification.collection.dropIndex("userId_1_sourceKey_1");
  } catch (error: any) {
    if (error?.codeName !== "IndexNotFound")
      console.warn("[NotificationMigration] drop legacy index:", error.message);
  }
  await Notification.syncIndexes();
  await Campaign.updateMany(
    { audience: "ALL_STUDENTS" },
    { $set: { audience: "ALL_LEARNERS" } },
  );
  await seedTemplates();
  await (
    await import("./models/notificationTemplate.model")
  ).NotificationTemplate.deleteMany({ event: "INBOX_ASSIGNED" });

  if (redisClient.status === "wait") await redisClient.connect();
  removeRabbitConnectedListener = rabbit.onConnected(async () => {
    await registerEventHandlers();
    console.log("[NotificationEvent] Đã đăng ký lại các consumer.");
  });
  await connectRabbit();

  try {
    await initializeRealtime(server);
  } catch (error) {
    console.error(
      "[NotificationRealtime] Socket.IO chạy fallback polling:",
      error,
    );
  }

  emailService.startWorker();
  server.listen(PORT, () =>
    console.log(`Notification Service đang chạy tại http://localhost:${PORT}`),
  );
};

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (rabbitRetryTimer) clearTimeout(rabbitRetryTimer);
  rabbitRetryTimer = null;
  removeRabbitConnectedListener?.();
  removeRabbitConnectedListener = null;
  emailService.stopWorker();
  await shutdownRealtime();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (redisClient.status === "ready") await redisClient.quit();
  identityGrpcClient.close();
  courseGrpcClient.close();
  await rabbit.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
boot().catch((error) => {
  console.error("Khởi động notification service thất bại:", error);
  process.exit(1);
});

