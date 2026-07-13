import type { Express } from "express";
import { Router } from "express";
import {
  extractUser,
  requireUser,
  requireInboxAdmin,
  extractOptionalUser,
} from "../middlewares/auth.middleware";
import { uploadAttachments } from "../middlewares/upload.middleware";
import { controller } from "../controllers/ticket.controller";
import { cannedReplyController } from "../controllers/cannedReply.controller";
import { chatbotController } from "../controllers/chatbot.controller";
export default (app: Express) => {
  const chatbot = Router();
  chatbot.use(extractOptionalUser);
  chatbot.get("/conversations", chatbotController.conversations);
  chatbot.get("/conversations/:id/messages", chatbotController.messages);
  chatbot.delete("/conversations/:id", chatbotController.remove);
  chatbot.delete("/conversations", chatbotController.clear);
  chatbot.post("/message", chatbotController.message);
  app.use("/api/chatbot", chatbot);

  const user = Router();
  user.use(extractUser, requireUser);
  user.get("/unread-count", controller.unreadCount);
  user.post("/tickets", controller.create);
  user.get("/tickets", controller.list);
  user.get("/tickets/:id", controller.detail);
  user.post("/tickets/:id/read", controller.read);
  user.post("/tickets/:id/messages", controller.message);
  user.post("/tickets/:id/attachments", uploadAttachments, controller.upload);
  user.get("/attachments/:id", controller.attachment);
  app.use("/api/inbox", user);
  const admin = Router();
  admin.use(extractUser, requireInboxAdmin);
  admin.get("/unread-count", controller.unreadCount);
  admin.get("/tickets", controller.list);
  admin.get("/tickets/:id", controller.detail);
  admin.post("/tickets/:id/read", controller.read);
  admin.patch("/tickets/:id/status", controller.status);
  admin.post("/tickets/:id/messages", controller.message);
  admin.post("/tickets/:id/attachments", uploadAttachments, controller.upload);
  admin.get("/attachments/:id", controller.attachment);
  admin.get("/canned-replies", cannedReplyController.list);
  admin.post("/canned-replies", cannedReplyController.create);
  admin.patch("/canned-replies/:id", cannedReplyController.update);
  admin.delete("/canned-replies/:id", cannedReplyController.remove);
  app.use("/api/admin/inbox", admin);
};

