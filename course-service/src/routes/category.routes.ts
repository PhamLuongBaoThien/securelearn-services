import { Router } from 'express';
import categoryController from '../controllers/category.controller';
import { extractUser, requireAdmin } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', categoryController.getCategories);
router.get('/admin/all', extractUser, requireAdmin, categoryController.getAdminCategories);
router.post('/', extractUser, requireAdmin, categoryController.createCategory);
router.put('/:id', extractUser, requireAdmin, categoryController.updateCategory);
router.patch('/:id/status', extractUser, requireAdmin, categoryController.setCategoryStatus);

export default router;
