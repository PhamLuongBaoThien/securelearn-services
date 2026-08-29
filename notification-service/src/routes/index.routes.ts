import { Application, Router } from 'express';
import notificationController from '../controllers/notification.controller';
import adminController from '../controllers/admin.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';

export default (app: Application) => {
  const user = Router();
  // Mọi API thông báo người dùng đều yêu cầu JWT hợp lệ.
  user.use(extractUser);
  // [GET] /api/notifications — Liệt kê thông báo của người dùng, hỗ trợ phân trang/lọc.
  user.get('/', notificationController.list);
  // [GET] /api/notifications/recent — Lấy nhanh các thông báo gần nhất cho menu header.
  user.get('/recent', notificationController.recent);
  // [GET] /api/notifications/unread-count — Đếm số thông báo chưa đọc.
  user.get('/unread-count', notificationController.unreadCount);
  // [GET] /api/notifications/preferences — Lấy tùy chọn nhận thông báo theo kênh/sự kiện.
  user.get('/preferences', notificationController.getPreferences);
  // [GET] /api/notifications/channel-capabilities — Trả các kênh thông báo hệ thống hiện hỗ trợ.
  user.get('/channel-capabilities', notificationController.getCapabilities);
  // [PUT] /api/notifications/preferences — Cập nhật tùy chọn nhận thông báo của người dùng.
  user.put('/preferences', notificationController.updatePreferences);
  // [PATCH] /api/notifications/read-all — Đánh dấu toàn bộ thông báo là đã đọc.
  user.patch('/read-all', notificationController.markAllRead);
  // [PATCH] /api/notifications/read-by-url — Đánh dấu các thông báo liên quan một URL là đã đọc.
  user.patch('/read-by-url', notificationController.markReadByUrl);
  // [PATCH] /api/notifications/:id/read — Đánh dấu một thông báo cụ thể là đã đọc.
  user.patch('/:id/read', notificationController.markRead);
  // Mount nhóm API thông báo cá nhân.
  app.use('/api/notifications', user);

  const admin = Router();
  // Các API quản trị yêu cầu JWT admin; từng route kiểm tra thêm quyền notif:read/notif:manage.
  admin.use(extractUser, requireAdmin);
  // [GET] /api/admin/notifications/templates — Liệt kê mẫu thông báo để quản trị.
  admin.get('/templates', requirePermission('notif:read'), adminController.listTemplates);
  // [POST] /api/admin/notifications/templates — Tạo mẫu thông báo mới.
  admin.post('/templates', requirePermission('notif:manage'), adminController.createTemplate);
  // [PUT] /api/admin/notifications/templates/:id — Cập nhật nội dung/cấu hình một mẫu thông báo.
  admin.put('/templates/:id', requirePermission('notif:manage'), adminController.updateTemplate);
  // [DELETE] /api/admin/notifications/templates/:id — Xóa mẫu thông báo.
  admin.delete('/templates/:id', requirePermission('notif:manage'), adminController.deleteTemplate);
  // [POST] /api/admin/notifications/campaigns — Tạo và gửi chiến dịch thông báo đến nhóm người nhận.
  admin.post('/campaigns', requirePermission('notif:manage'), adminController.createCampaign);
  // [GET] /api/admin/notifications/campaigns — Liệt kê các chiến dịch và trạng thái gửi.
  admin.get('/campaigns', requirePermission('notif:read'), adminController.listCampaigns);
  // [GET] /api/admin/notifications/campaigns/:id — Xem chi tiết kết quả của một chiến dịch.
  admin.get('/campaigns/:id', requirePermission('notif:read'), adminController.getCampaign);
  // [POST] /api/admin/notifications/campaigns/:id/retry — Gửi lại các thông báo thất bại của chiến dịch.
  admin.post('/campaigns/:id/retry', requirePermission('notif:manage'), adminController.retryCampaign);
  // Mount nhóm API quản trị mẫu và chiến dịch thông báo.
  app.use('/api/admin/notifications', admin);
};
