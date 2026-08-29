// File này khai báo route cho Category.
// Course editor dùng GET /api/categories để lấy cây danh mục public.
import { Router } from 'express';
import categoryController from '../controllers/category.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

// [GET] /api/categories — Công khai cây danh mục đang hoạt động cho catalog và course editor.
router.get('/', categoryController.getCategories);
// [GET] /api/categories/admin/all — Admin lấy cả danh mục ẩn để quản trị.
router.get('/admin/all', extractUser, requireAdmin, requirePermission('system:config'), categoryController.getAdminCategories);
// [POST] /api/categories — Admin tạo danh mục khóa học mới.
router.post('/', extractUser, requireAdmin, requirePermission('system:config'), categoryController.createCategory);
// [PATCH] /api/categories/admin/multi-status — Admin bật/tắt trạng thái nhiều danh mục.
router.patch('/admin/multi-status', extractUser, requireAdmin, requirePermission('system:config'), categoryController.multiSetCategoryStatus);
// [DELETE] /api/categories/admin/multi — Admin xóa đồng loạt các danh mục đủ điều kiện.
router.delete('/admin/multi', extractUser, requireAdmin, requirePermission('system:config'), categoryController.multiDeleteCategories);
// [PUT] /api/categories/:id — Admin cập nhật tên, mô tả hoặc quan hệ cha-con của danh mục.
router.put('/:id', extractUser, requireAdmin, requirePermission('system:config'), categoryController.updateCategory);
// [PATCH] /api/categories/:id/status — Admin thay đổi trạng thái hoạt động của một danh mục.
router.patch('/:id/status', extractUser, requireAdmin, requirePermission('system:config'), categoryController.setCategoryStatus);
// [DELETE] /api/categories/:id — Admin xóa một danh mục đủ điều kiện.
router.delete('/:id', extractUser, requireAdmin, requirePermission('system:config'), categoryController.deleteCategory);

export default router;
