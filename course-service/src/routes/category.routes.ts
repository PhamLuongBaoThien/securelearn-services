// File này khai báo route cho Category.
// Course editor dùng GET /api/categories để lấy cây danh mục public.
import { Router } from 'express';
import categoryController from '../controllers/category.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', categoryController.getCategories); // API này không cần đăng nhập, dùng khi người dùng cần xem danh mục
router.get('/admin/all', extractUser, requireAdmin, requirePermission('system:config'), categoryController.getAdminCategories); // API này dùng khi admin cần lấy danh sách danh mục để chỉnh sửa
router.post('/', extractUser, requireAdmin, requirePermission('system:config'), categoryController.createCategory); // API này dùng khi admin cần thêm danh mục mới
router.put('/:id', extractUser, requireAdmin, requirePermission('system:config'), categoryController.updateCategory); // API này dùng khi admin cần chỉnh sửa danh mục
router.patch('/:id/status', extractUser, requireAdmin, requirePermission('system:config'), categoryController.setCategoryStatus); // API này dùng khi admin cần thay đổi trạng thái danh mục
router.delete('/:id', extractUser, requireAdmin, requirePermission('system:config'), categoryController.deleteCategory); // API này dùng khi admin cần xóa danh mục

export default router;
