import { Router } from 'express';
import bannerController from '../controllers/banner.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';
import { bannerUpload } from '../middlewares/bannerUpload.middleware';

const router = Router();
router.use(extractUser, requireAdmin, requirePermission('system:config'));
router.get('/', bannerController.listAdmin);
router.post('/', bannerUpload.single('image'), bannerController.create);
router.patch('/reorder', bannerController.reorder);
router.put('/:id', bannerUpload.single('image'), bannerController.update);
router.patch('/:id/status', bannerController.setStatus);
router.delete('/:id', bannerController.delete);
export default router;
