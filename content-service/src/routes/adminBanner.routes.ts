import { Router } from 'express';
import bannerController from '../controllers/banner.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';
import { bannerUpload } from '../middlewares/bannerUpload.middleware';

const router = Router();
// Bảo vệ toàn bộ route bằng JWT admin và quyền system:config.
router.use(extractUser, requireAdmin, requirePermission('system:config'));
// [GET] /api/admin/system/banners — Lấy đầy đủ banner, gồm cả banner chưa công khai.
router.get('/', bannerController.listAdmin);
// [POST] /api/admin/system/banners — Tạo banner mới và upload ảnh đại diện.
router.post('/', bannerUpload.single('image'), bannerController.create);
// [PATCH] /api/admin/system/banners/reorder — Cập nhật thứ tự hiển thị của nhiều banner.
router.patch('/reorder', bannerController.reorder);
// [PUT] /api/admin/system/banners/:id — Cập nhật nội dung và tùy chọn thay ảnh banner.
router.put('/:id', bannerUpload.single('image'), bannerController.update);
// [PATCH] /api/admin/system/banners/:id/status — Bật hoặc tắt trạng thái công khai của banner.
router.patch('/:id/status', bannerController.setStatus);
// [DELETE] /api/admin/system/banners/:id — Xóa banner và tài nguyên liên quan.
router.delete('/:id', bannerController.delete);
export default router;
