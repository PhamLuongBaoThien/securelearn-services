// ========================
// Routes: API endpoint cho Admin Authentication
// Hoàn toàn tách biệt với User — đường dẫn khác, cookie khác.
// ========================
import { Router } from 'express';
import adminController from '../controllers/admin.controller';
import { extractUser } from '../middlewares/auth.middleware';
import upload from '../middlewares/upload.middleware';

const router = Router();

// [POST] /api/admin/auth/setup — Setup Admin (Test)
router.post('/setup', adminController.setupAdmin);

// [POST] /api/admin/auth/login — Đăng nhập Admin
router.post('/login', adminController.login);

// [POST] /api/admin/auth/logout — Đăng xuất Admin
router.post('/logout', adminController.logout);

// [GET] /api/admin/auth/me — Lấy thông tin Admin đang đăng nhập
router.get('/me', extractUser, adminController.getMe);

// [POST] /api/admin/auth/refresh-token — Cấp lại token Admin
router.post('/refresh-token', adminController.refreshToken);

// [PUT] /api/admin/auth/profile — Cập nhật thông tin và avatar Admin
router.put('/profile', extractUser, upload.single('avatar'), adminController.updateProfile);

// [PUT] /api/admin/auth/password — Thay đổi mật khẩu Admin
router.put('/password', extractUser, adminController.changePassword);

export default router;
