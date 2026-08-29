import { Router } from 'express';
import websiteConfigController from '../controllers/websiteConfig.controller';
import { extractUser, requireAdmin, requirePermission } from '../middlewares/auth.middleware';
import { websiteAssetUpload } from '../middlewares/websiteAssetUpload.middleware';

const router = Router();
// Bảo vệ toàn bộ route bằng JWT admin và quyền system:config.
router.use(extractUser, requireAdmin, requirePermission('system:config'));
// [GET] /api/admin/system/config — Admin đọc cấu hình website hiện tại để chỉnh sửa.
router.get('/', websiteConfigController.get);
// [PUT] /api/admin/system/config — Cập nhật cấu hình và tùy chọn upload logo/favicon mới.
router.put('/', websiteAssetUpload.fields([{ name: 'logo', maxCount: 1 }, { name: 'favicon', maxCount: 1 }]), websiteConfigController.update);
export default router;
