// ========================
// Routes: API endpoint cho Admin Authentication
// Hoàn toàn tách biệt với User — đường dẫn khác, cookie khác.
// ========================
import { Router } from 'express';
import adminController from '../controllers/admin.controller';
import { verifyJWT } from '../middlewares/auth.middleware';

const router = Router();

// [POST] /api/v1/admin/auth/login — Đăng nhập Admin
router.post('/login', adminController.login);

// [POST] /api/v1/admin/auth/logout — Đăng xuất Admin
router.post('/logout', adminController.logout);

// [GET] /api/v1/admin/auth/me — Lấy thông tin Admin đang đăng nhập
router.get('/me', verifyJWT, adminController.getMe);

// [POST] /api/v1/admin/auth/refresh-token — Cấp lại token Admin
router.post('/refresh-token', adminController.refreshToken);

export default router;
