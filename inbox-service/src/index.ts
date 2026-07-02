import "dotenv/config";
import http from "http";
import mongoose from "mongoose";
import app from "./app";
import { connectDatabase } from "./config/db";
import redisClient from "./config/redis";
import { RabbitMQConnection } from "@securelearn/common";
import { identityGrpcClient, courseGrpcClient } from "./config/grpc";
import { startOutboxWorker, stopOutboxWorker } from "./services/outbox.service";
import { Ticket } from "./models/ticket.model";
const port = Number(process.env.PORT || 5007);
let server: http.Server;
const start = async () => {
  await connectDatabase();
  await Ticket.collection.updateMany(
    {},
    { $unset: { assignedAdmin: true, priority: true, dueAt: true } },
  );
  await Ticket.syncIndexes();
  if (redisClient.status === "wait") await redisClient.connect();
  await RabbitMQConnection.getInstance().connect(
    process.env.RABBITMQ_URL || "",
  );
  startOutboxWorker();
  server = http
    .createServer(app)
    .listen(port, () =>
      console.log(`Inbox Service đang chạy tại http://localhost:${port}`),
    );
};
const shutdown = async () => {
  stopOutboxWorker();
  await new Promise<void>((r) => server?.close(() => r()));
  identityGrpcClient.close();
  courseGrpcClient.close();
  await RabbitMQConnection.getInstance().close();
  redisClient.disconnect();
  await mongoose.disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
void start().catch((e) => {
  console.error(e);
  process.exit(1);
});
