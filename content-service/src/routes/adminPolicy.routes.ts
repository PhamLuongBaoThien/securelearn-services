import { Router } from 'express';
import policyController from '../controllers/policy.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';

const router = Router();
// Bảo vệ toàn bộ route bằng JWT admin và quyền system:config.
router.use(extractUser, requireAdmin, requirePermission('system:config'));
// [GET] /api/admin/system/policies — Lấy tất cả chính sách để quản trị, gồm bản chưa công khai.
router.get('/', policyController.listAdmin);
// [POST] /api/admin/system/policies — Tạo một chính sách mới.
router.post('/', policyController.create);
// [PUT] /api/admin/system/policies/:id — Cập nhật tiêu đề, slug và nội dung chính sách.
router.put('/:id', policyController.update);
// [PATCH] /api/admin/system/policies/:id/status — Thay đổi trạng thái công khai của chính sách.
router.patch('/:id/status', policyController.setStatus);
// [DELETE] /api/admin/system/policies/:id — Xóa một chính sách khỏi hệ thống.
router.delete('/:id', policyController.delete);

export default router;
