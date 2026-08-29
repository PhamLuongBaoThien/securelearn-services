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
  // Nhận diện JWT nếu có; khách vẫn dùng chatbot bằng guest token của hội thoại.
  chatbot.use(extractOptionalUser);
  // [GET] /api/chatbot/conversations — Liệt kê hội thoại chatbot thuộc user hoặc guest được ủy quyền.
  chatbot.get("/conversations", chatbotController.conversations);
  // [GET] /api/chatbot/conversations/:id/messages — Lấy lịch sử tin nhắn của một hội thoại hợp lệ.
  chatbot.get("/conversations/:id/messages", chatbotController.messages);
  // [DELETE] /api/chatbot/conversations/:id — Xóa một hội thoại chatbot và toàn bộ tin nhắn của nó.
  chatbot.delete("/conversations/:id", chatbotController.remove);
  // [DELETE] /api/chatbot/conversations — Xóa lịch sử chatbot thuộc người dùng hoặc hội thoại guest hiện tại.
  chatbot.delete("/conversations", chatbotController.clear);
  // [POST] /api/chatbot/message — Phân loại câu hỏi, tư vấn khóa học khi cần và lưu lượt hội thoại.
  chatbot.post("/message", chatbotController.message);
  // Mount nhóm API chatbot công khai/tùy chọn đăng nhập.
  app.use("/api/chatbot", chatbot);

  const user = Router();
  // Các API hộp thư người dùng yêu cầu JWT và tài khoản STUDENT/INSTRUCTOR hợp lệ.
  user.use(extractUser, requireUser);
  // [GET] /api/inbox/unread-count — Đếm ticket/tin nhắn hỗ trợ chưa đọc của người dùng.
  user.get("/unread-count", controller.unreadCount);
  // [POST] /api/inbox/tickets — Tạo ticket hỗ trợ mới từ phía người dùng.
  user.post("/tickets", controller.create);
  // [GET] /api/inbox/tickets — Liệt kê ticket hỗ trợ của người dùng hiện tại.
  user.get("/tickets", controller.list);
  // [GET] /api/inbox/tickets/:id — Xem chi tiết ticket và chuỗi trao đổi được phép truy cập.
  user.get("/tickets/:id", controller.detail);
  // [POST] /api/inbox/tickets/:id/read — Đánh dấu các tin nhắn trong ticket là đã đọc.
  user.post("/tickets/:id/read", controller.read);
  // [POST] /api/inbox/tickets/:id/messages — Gửi một tin nhắn mới vào ticket.
  user.post("/tickets/:id/messages", controller.message);
  // [POST] /api/inbox/tickets/:id/attachments — Upload tệp đính kèm vào ticket.
  user.post("/tickets/:id/attachments", uploadAttachments, controller.upload);
  // [GET] /api/inbox/attachments/:id — Tải/xem tệp đính kèm nếu người dùng thuộc ticket.
  user.get("/attachments/:id", controller.attachment);
  // Mount nhóm API ticket dành cho học viên/giảng viên.
  app.use("/api/inbox", user);
  const admin = Router();
  // Các API quản trị inbox yêu cầu JWT và quyền xử lý hỗ trợ.
  admin.use(extractUser, requireInboxAdmin);
  // [GET] /api/admin/inbox/unread-count — Đếm ticket/tin nhắn hỗ trợ admin chưa đọc.
  admin.get("/unread-count", controller.unreadCount);
  // [GET] /api/admin/inbox/tickets — Liệt kê và lọc toàn bộ ticket hỗ trợ cho admin.
  admin.get("/tickets", controller.list);
  // [GET] /api/admin/inbox/tickets/:id — Xem chi tiết ticket để xử lý hỗ trợ.
  admin.get("/tickets/:id", controller.detail);
  // [POST] /api/admin/inbox/tickets/:id/read — Đánh dấu ticket đã được admin đọc.
  admin.post("/tickets/:id/read", controller.read);
  // [PATCH] /api/admin/inbox/tickets/:id/status — Chuyển trạng thái xử lý của ticket.
  admin.patch("/tickets/:id/status", controller.status);
  // [POST] /api/admin/inbox/tickets/:id/messages — Admin phản hồi người dùng trong ticket.
  admin.post("/tickets/:id/messages", controller.message);
  // [POST] /api/admin/inbox/tickets/:id/attachments — Admin tải tệp đính kèm vào phản hồi.
  admin.post("/tickets/:id/attachments", uploadAttachments, controller.upload);
  // [GET] /api/admin/inbox/attachments/:id — Admin tải/xem tệp đính kèm của ticket.
  admin.get("/attachments/:id", controller.attachment);
  // [GET] /api/admin/inbox/canned-replies — Liệt kê các mẫu trả lời nhanh.
  admin.get("/canned-replies", cannedReplyController.list);
  // [POST] /api/admin/inbox/canned-replies — Tạo mẫu trả lời nhanh mới.
  admin.post("/canned-replies", cannedReplyController.create);
  // [PATCH] /api/admin/inbox/canned-replies/:id — Cập nhật một mẫu trả lời nhanh.
  admin.patch("/canned-replies/:id", cannedReplyController.update);
  // [DELETE] /api/admin/inbox/canned-replies/:id — Xóa mẫu trả lời nhanh.
  admin.delete("/canned-replies/:id", cannedReplyController.remove);
  // Mount nhóm API quản trị hộp thư hỗ trợ.
  app.use("/api/admin/inbox", admin);
};

