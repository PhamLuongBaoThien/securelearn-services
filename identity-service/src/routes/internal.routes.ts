// ========================
// Internal Routes: Chỉ dùng cho giao tiếp giữa các Microservice
// KHÔNG expose qua Kong API Gateway
// ========================
import { Router } from 'express';
import internalController from '../controllers/internal.controller';

const router = Router();

// [GET] /internal/users/:userId/name — Lấy tên user theo ID (dùng cho course-service)
router.get('/users/:userId/name', internalController.getUserName);

export default router;
