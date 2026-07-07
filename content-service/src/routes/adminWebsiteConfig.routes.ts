import { Router } from 'express';
import websiteConfigController from '../controllers/websiteConfig.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';
import { websiteAssetUpload } from '../middlewares/websiteAssetUpload.middleware';

const router = Router();
router.use(extractUser, requireAdmin, requirePermission('system:config'));
router.get('/', websiteConfigController.get);
router.put('/', websiteAssetUpload.fields([{ name: 'logo', maxCount: 1 }, { name: 'favicon', maxCount: 1 }]), websiteConfigController.update);
export default router;
