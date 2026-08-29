import { Router } from 'express';
import websiteConfigController from '../controllers/websiteConfig.controller';

const router = Router();
// [GET] /api/website-config — Trả cấu hình website công khai như logo, favicon và thông tin thương hiệu.
router.get('/', websiteConfigController.get);
export default router;
