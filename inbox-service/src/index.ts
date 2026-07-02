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
import { TicketMessage } from "./models/ticketMessage.model";
import { TicketReadState } from "./models/ticketReadState.model";
import {
  initializeRealtime,
  shutdownRealtime,
} from "./services/realtime.service";
const port = Number(process.env.PORT || 5007);
let server: http.Server;
async function migrateReadState() {
  const rows: any[] = await Ticket.find({
    $or: [
      { lastMessageAt: { $exists: false } },
      { lastPublicMessageAt: { $exists: false } },
      { userUnread: { $exists: true } },
      { adminUnread: { $exists: true } },
    ],
  })
    .select("_id sender createdAt userUnread adminUnread")
    .lean();
  let admins: any[] = [];
  let page = 1;
  do {
    const result = await identityGrpcClient.listNotificationRecipients({
      audience: "",
      email: "",
      userId: "",
      page,
      limit: 200,
      recipientType: "ADMIN",
      permission: "inbox:manage",
    });
    admins.push(...result.recipients);
    if (!result.hasMore) break;
    page++;
  } while (page < 100);
  for (const row of rows) {
    const [last, lastPublic]: any[] = await Promise.all([
      TicketMessage.findOne({ ticketId: row._id })
        .sort({ createdAt: -1 })
        .select("_id createdAt")
        .lean(),
      TicketMessage.findOne({ ticketId: row._id, internal: false })
        .sort({ createdAt: -1 })
        .select("_id createdAt")
        .lean(),
    ]);
    const lastAt = last?.createdAt || row.createdAt,
      publicAt = lastPublic?.createdAt || row.createdAt;
    await Ticket.updateOne(
      { _id: row._id },
      { $set: { lastMessageAt: lastAt, lastPublicMessageAt: publicAt } },
    );
    if (row.userUnread === false)
      await TicketReadState.updateOne(
        { ticketId: row._id, identityType: "USER", identityId: row.sender.id },
        {
          $set: {
            lastReadMessageId: lastPublic?._id || null,
            lastReadAt: publicAt,
          },
        },
        { upsert: true },
      );
    if (row.adminUnread === false)
      await Promise.all(
        admins.map((admin) =>
          TicketReadState.updateOne(
            {
              ticketId: row._id,
              identityType: "ADMIN",
              identityId: admin.userId,
            },
            {
              $set: {
                lastReadMessageId: last?._id || null,
                lastReadAt: lastAt,
              },
            },
            { upsert: true },
          ),
        ),
      );
  }
  await Ticket.collection.updateMany(
    {},
    {
      $unset: {
        assignedAdmin: true,
        priority: true,
        dueAt: true,
        userUnread: true,
        adminUnread: true,
      },
    },
  );
}
const start = async () => {
  await connectDatabase();
  await migrateReadState();
  await Ticket.syncIndexes();
  if (redisClient.status === "wait")
    await redisClient
      .connect()
      .catch((error) =>
        console.error(
          JSON.stringify({
            event: "inbox_redis_degraded",
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
  await RabbitMQConnection.getInstance().connect(
    process.env.RABBITMQ_URL || "",
  );
  startOutboxWorker();
  server = http.createServer(app);
  await initializeRealtime(server);
  server.listen(port, () =>
    console.log(`Inbox Service đang chạy tại http://localhost:${port}`),
  );
};
const shutdown = async () => {
  stopOutboxWorker();
  await shutdownRealtime();
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
