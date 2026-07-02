import http from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import redisClient from "../config/redis";
import { Ticket } from "../models/ticket.model";
import { verifyInboxToken, type InboxIdentity } from "./auth.service";

let io: Server | null = null;
let pubClient: ReturnType<typeof redisClient.duplicate> | null = null;
let subClient: ReturnType<typeof redisClient.duplicate> | null = null;
let ready = false;
const roomFor = (identity: InboxIdentity) =>
  identity.identityType === "ADMIN"
    ? "INBOX:ADMINS"
    : `INBOX:USER:${identity.id}`;

async function canAccess(identity: InboxIdentity, ticketId: string) {
  return Boolean(
    await Ticket.exists({
      _id: ticketId,
      ...(identity.identityType === "USER" ? { "sender.id": identity.id } : {}),
    }),
  );
}

export async function initializeRealtime(server: http.Server) {
  io = new Server(server, {
    path: "/inbox.socket.io",
    cors: {
      origin: (
        process.env.SOCKET_CORS_ORIGIN ||
        process.env.CLIENT_URL ||
        "http://localhost:5173"
      ).split(","),
      credentials: true,
    },
  });
  io.use(async (socket, next) => {
    try {
      const raw =
        socket.handshake.auth?.token || socket.handshake.headers.authorization;
      const token = String(raw || "").replace(/^Bearer\s+/i, "");
      socket.data.identity = await verifyInboxToken(token);
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("Unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    const identity = socket.data.identity as InboxIdentity;
    void socket.join(roomFor(identity));
    console.info(
      JSON.stringify({
        event: "inbox_socket_connected",
        socketId: socket.id,
        identityType: identity.identityType,
        identityId: identity.id,
      }),
    );
    socket.on(
      "inbox:subscribe",
      async ({ ticketId } = {}, ack?: (result: unknown) => void) => {
        try {
          if (!ticketId || !(await canAccess(identity, String(ticketId))))
            throw new Error("Bạn không có quyền truy cập ticket.");
          await socket.join(`INBOX:TICKET:${ticketId}`);
          ack?.({ status: "OK" });
        } catch (error) {
          ack?.({
            status: "ERR",
            message:
              error instanceof Error
                ? error.message
                : "Không thể đăng ký ticket.",
          });
        }
      },
    );
    socket.on("inbox:unsubscribe", ({ ticketId } = {}) => {
      if (ticketId) void socket.leave(`INBOX:TICKET:${ticketId}`);
    });
    socket.on("inbox:typing", ({ ticketId, typing } = {}) => {
      if (!ticketId || !socket.rooms.has(`INBOX:TICKET:${ticketId}`)) return;
      socket
        .to(`INBOX:TICKET:${ticketId}`)
        .emit("inbox:typing", {
          ticketId,
          identityType: identity.identityType,
          typing: Boolean(typing),
          expiresAt: Date.now() + 5000,
        });
    });
  });
  try {
    pubClient = redisClient.duplicate();
    subClient = redisClient.duplicate();
    await Promise.race([
      Promise.all([pubClient.connect(), subClient.connect()]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Redis adapter timeout")), 3000),
      ),
    ]);
    io.adapter(createAdapter(pubClient, subClient));
    ready = true;
  } catch (error) {
    ready = false;
    pubClient?.disconnect();
    subClient?.disconnect();
    console.error(
      JSON.stringify({
        event: "inbox_realtime_degraded",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
export const realtimeReady = () => ready;
export const emitTicketNew = (ticket: unknown) =>
  io?.to("INBOX:ADMINS").emit("inbox:ticket:new", ticket);
export const emitTicketUpdated = (
  ticketId: string,
  ticket: unknown,
  userId?: string,
) => {
  let target = io?.to(`INBOX:TICKET:${ticketId}`).to("INBOX:ADMINS");
  if (userId) target = target?.to(`INBOX:USER:${userId}`);
  target?.emit("inbox:ticket:updated", ticket);
};
export const emitMessageNew = (
  ticketId: string,
  payload: unknown,
  userId: string,
  isPublic = true,
) => {
  const target = isPublic
    ? io
        ?.to(`INBOX:TICKET:${ticketId}`)
        .to("INBOX:ADMINS")
        .to(`INBOX:USER:${userId}`)
    : io?.to("INBOX:ADMINS");
  target?.emit("inbox:message:new", payload);
};
export const emitUnreadInvalidated = (
  identityType: "USER" | "ADMIN",
  identityId?: string,
  count?: number,
) =>
  io
    ?.to(identityType === "ADMIN" ? "INBOX:ADMINS" : `INBOX:USER:${identityId}`)
    .emit("inbox:unread-count", {
      count: identityType === "ADMIN" ? null : (count ?? null),
    });
export const emitRead = (
  ticketId: string,
  identityType: "USER" | "ADMIN",
  identityId: string,
  count: number,
) => {
  if (identityType === "ADMIN")
    io?.to("INBOX:ADMINS").emit("inbox:read", {
      ticketId,
      identityType,
      identityId,
    });
  else
    io?.to(`INBOX:TICKET:${ticketId}`)
      .to(`INBOX:USER:${identityId}`)
      .emit("inbox:read", { ticketId, identityType, identityId });
  emitUnreadInvalidated(identityType, identityId, count);
};
export async function shutdownRealtime() {
  ready = false;
  await new Promise<void>((resolve) =>
    io ? io.close(() => resolve()) : resolve(),
  );
  await Promise.allSettled([pubClient?.quit(), subClient?.quit()]);
  io = null;
}
