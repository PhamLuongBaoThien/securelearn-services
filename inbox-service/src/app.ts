import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import mongoose from "mongoose";
import { RabbitMQConnection } from "@securelearn/common";
import routes from "./routes/index.routes";
import { storageReady } from "./services/storage.service";
import redisClient from "./config/redis";
import { realtimeReady } from "./services/realtime.service";
const app = express();
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
routes(app);
app.get("/health", async (_req, res) => {
  const dependencies = {
    mongo: mongoose.connection.readyState === 1,
    rabbitmq: RabbitMQConnection.getInstance().isConnected(),
    storage: await storageReady(),
    redis: redisClient.status === "ready",
    realtime: realtimeReady(),
  };
  const core =
    dependencies.mongo && dependencies.rabbitmq && dependencies.storage;
  res
    .status(core ? 200 : 503)
    .json({
      status: Object.values(dependencies).every(Boolean)
        ? "OK"
        : core
          ? "DEGRADED"
          : "ERR",
      service: "inbox-service",
      dependencies,
    });
});
app.use(
  (
    e: Error & { code?: string },
    _q: Request,
    res: Response,
    _n: NextFunction,
  ) =>
    res
      .status(e.code?.startsWith("LIMIT_") ? 400 : 500)
      .json({ status: "ERR", message: e.message || "Lỗi hệ thống." }),
);
export default app;
