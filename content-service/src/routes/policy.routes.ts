import { Router } from 'express';
import policyController from '../controllers/policy.controller';

const router = Router();
// [GET] /api/policies — Lấy danh sách chính sách đang được công khai.
router.get('/', policyController.listPublic);
// [GET] /api/policies/:slug — Lấy nội dung một chính sách công khai theo slug.
router.get('/:slug', policyController.getPublicBySlug);

export default router;
