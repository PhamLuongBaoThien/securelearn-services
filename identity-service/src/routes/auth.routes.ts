// ========================
// Routes: API endpoint cho User Authentication
// ========================
import { Router } from 'express';
import passport from 'passport';
import authController from '../controllers/auth.controller';
import { extractUser } from '../middlewares/auth.middleware';
import upload from '../middlewares/upload.middleware';

const router = Router();

// ========== ĐĂNG KÝ / ĐĂNG NHẬP (Email + Password) ==========

// [POST] /api/auth/register — Đăng ký tài khoản mới
router.post('/register', authController.register);
router.post('/register/verify-otp', authController.verifyRegistration);

// [POST] /api/auth/login — Đăng nhập
router.post('/login', authController.login);

// [POST] /api/auth/logout — Đăng xuất (xóa cookie)
router.post('/logout', authController.logout);

// [GET] /api/auth/me — Lấy thông tin user đang đăng nhập (cần Access Token)
router.get('/me', extractUser, authController.getMe);

// Public profile và tìm kiếm giảng viên
router.get('/users/:slug/public-profile', authController.getPublicProfileBySlug);
router.get('/instructors', authController.searchPublicInstructors);
router.get('/instructors/:id/public-profile', authController.getPublicInstructorProfile);

// [PUT] /api/auth/profile — Cập nhật thông tin và avatar
router.put('/profile', extractUser, upload.single('avatar'), authController.updateProfile);

// [PUT] /api/auth/profile/role — Chuyển đổi vai trò sang giảng viên
router.put('/profile/role', extractUser, authController.switchToInstructor);

// [DELETE] /api/auth/account — Xóa tài khoản
router.delete('/account', extractUser, authController.deleteAccount);

// [PUT] /api/auth/password — Thay đổi mật khẩu
router.put('/password', extractUser, authController.changePassword);

// ========== REFRESH TOKEN ==========

// [POST] /api/auth/refresh-token — Dùng refresh token để lấy access token mới
router.post('/refresh-token', authController.refreshToken);

// ========== KHÔI PHỤC MẬT KHẨU ==========

// [POST] /api/auth/forgot-password — Yêu cầu gửi OTP về mail
router.post('/forgot-password', authController.forgotPassword);

// [POST] /api/auth/verify-reset-otp — Xác thực OTP (bước trung gian)
router.post('/verify-reset-otp', authController.verifyResetOTP);

// [POST] /api/auth/reset-password — Đổi mật khẩu bằng OTP
router.post('/reset-password', authController.resetPassword);

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
