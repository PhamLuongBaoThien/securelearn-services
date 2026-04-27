import { Router } from 'express';
import categoryController from '../controllers/category.controller';
import { extractUser, requireAdmin } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', categoryController.getCategories); // API này không cần đăng nhập, dùng khi người dùng cần xem danh mục
router.get('/admin/all', extractUser, requireAdmin, categoryController.getAdminCategories); // API này dùng khi admin cần lấy danh sách danh mục để chỉnh sửa
router.post('/', extractUser, requireAdmin, categoryController.createCategory); // API này dùng khi admin cần thêm danh mục mới
router.put('/:id', extractUser, requireAdmin, categoryController.updateCategory); // API này dùng khi admin cần chỉnh sửa danh mục
router.patch('/:id/status', extractUser, requireAdmin, categoryController.setCategoryStatus); // API này dùng khi admin cần thay đổi trạng thái danh mục

export default router;
