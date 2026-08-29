import { Router } from 'express';
import bannerController from '../controllers/banner.controller';

const router = Router();
// [GET] /api/banners — Lấy danh sách banner công khai đang hoạt động theo thứ tự hiển thị.
router.get('/', bannerController.listPublic);
export default router;
