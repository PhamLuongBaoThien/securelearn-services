// ========================
// Routes: API endpoint cho User Authentication
// ========================
import { Router } from 'express';
import passport from 'passport';
import authController from '../controllers/auth.controller';
import { verifyJWT } from '../middlewares/auth.middleware';

const router = Router();

// ========== ĐĂNG KÝ / ĐĂNG NHẬP (Email + Password) ==========

// [POST] /api/auth/register — Đăng ký tài khoản mới
router.post('/register', authController.register);

// [POST] /api/auth/login — Đăng nhập
router.post('/login', authController.login);

// [POST] /api/auth/logout — Đăng xuất (xóa cookie)
router.post('/logout', authController.logout);

// [GET] /api/auth/me — Lấy thông tin user đang đăng nhập (cần Access Token)
router.get('/me', verifyJWT, authController.getMe);

// ========== REFRESH TOKEN ==========

// [POST] /api/auth/refresh-token — Dùng refresh token để lấy access token mới
router.post('/refresh-token', authController.refreshToken);

// ========== OAUTH2 / OPENID CONNECT (Google) ==========

// [GET] /api/auth/google — Redirect tới trang đăng nhập Google
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// [GET] /api/auth/google/callback — Google gọi lại sau khi user đồng ý
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login?error=true' }),
  authController.googleCallback
);

export default router;
