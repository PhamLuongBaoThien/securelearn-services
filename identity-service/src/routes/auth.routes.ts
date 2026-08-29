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
// [POST] /api/auth/register/verify-otp — Xác minh OTP để hoàn tất tạo tài khoản đã đăng ký.
router.post('/register/verify-otp', authController.verifyRegistration);

// [POST] /api/auth/login — Đăng nhập
router.post('/login', authController.login);

// [GET] /api/auth/me — Lấy thông tin user đang đăng nhập (cần Access Token)
router.get('/me', extractUser, authController.getMe);
// [POST] /api/auth/logout — Thu hồi phiên đăng nhập hiện tại và xóa refresh-token cookie.
router.post('/logout', extractUser, authController.logout);

// Quản lý các phiên đăng nhập đang hoạt động
// [GET] /api/auth/sessions — Liệt kê thiết bị/phiên đăng nhập còn hiệu lực của người dùng.
router.get('/sessions', extractUser, authController.getSessions);
// [POST] /api/auth/sessions/revoke-others — Đăng xuất tất cả thiết bị khác, giữ phiên hiện tại.
router.post('/sessions/revoke-others', extractUser, authController.revokeOtherSessions);
// [DELETE] /api/auth/sessions/:sessionId — Thu hồi một phiên đăng nhập cụ thể từ xa.
router.delete('/sessions/:sessionId', extractUser, authController.revokeSession);

// Public profile và tìm kiếm giảng viên
// [GET] /api/auth/users/:slug/public-profile — Lấy hồ sơ công khai của người dùng theo slug.
router.get('/users/:slug/public-profile', authController.getPublicProfileBySlug);
// [GET] /api/auth/instructors — Tìm kiếm/danh sách hồ sơ giảng viên công khai.
router.get('/instructors', authController.searchPublicInstructors);
// [GET] /api/auth/instructors/:id/public-profile — Lấy hồ sơ công khai chi tiết của một giảng viên.
router.get('/instructors/:id/public-profile', authController.getPublicInstructorProfile);

// [PUT] /api/auth/profile — Cập nhật thông tin và avatar
router.put('/profile', extractUser, upload.single('avatar'), authController.updateProfile);

// [PUT] /api/auth/profile/role — Chuyển đổi vai trò sang giảng viên
router.put('/profile/role', extractUser, authController.switchToInstructor);

// [DELETE] /api/auth/account — Xóa tài khoản
router.delete('/account', extractUser, authController.deleteAccount);

// [PUT] /api/auth/password — Thay đổi mật khẩu
// [POST] /api/auth/password/otp — Gửi OTP xác nhận trước khi đổi mật khẩu của tài khoản đang đăng nhập.
router.post('/password/otp', extractUser, authController.requestPasswordChangeOTP);
// [PUT] /api/auth/password — Xác minh OTP/mật khẩu hiện tại rồi cập nhật mật khẩu tài khoản.
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
