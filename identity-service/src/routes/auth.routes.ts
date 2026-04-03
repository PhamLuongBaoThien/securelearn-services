// ========================
// Routes: API endpoint cho User Authentication
// ========================
import { Router } from 'express';
import passport from 'passport';
import authController from '../controllers/auth.controller';
import { verifyJWT } from '../middlewares/auth.middleware';

const router = Router();

// ========== ĐĂNG KÝ / ĐĂNG NHẬP CƠ BẢN (Email + Password) ==========

// [POST] /api/v1/auth/register — Đăng ký tài khoản mới
router.post('/register', authController.register);

// [POST] /api/v1/auth/login — Đăng nhập
router.post('/login', authController.login);

// [POST] /api/v1/auth/logout — Đăng xuất (xóa cookie)
router.post('/logout', authController.logout);

// [GET] /api/v1/auth/me — Lấy thông tin user đang đăng nhập (cần Access Token)
router.get('/me', verifyJWT, authController.getMe);

// ========== REFRESH TOKEN ==========

// [POST] /api/v1/auth/refresh-token — Dùng refresh token để lấy access token mới
router.post('/refresh-token', authController.refreshToken);

// ========== OAUTH2 / OPENID CONNECT (Google) ==========

// [GET] /api/v1/auth/google — Redirect tới trang đăng nhập Google
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// [GET] /api/v1/auth/google/callback — Google gọi lại sau khi user đồng ý
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login?error=true' }),
  authController.googleCallback
);

export default router;
