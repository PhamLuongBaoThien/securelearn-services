// ========================
// Controller Layer: Xử lý Request/Response cho Authentication (User)
// ========================
import { Request, Response } from 'express';
import authService from '../services/auth.service';
import { generalAccessToken, refreshTokenJwtService } from '../services/jwt.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import redisClient from '../config/redis';
import authSessionService from '../services/authSession.service';
import { getSessionMetadata } from '../utils/session.utils';

const REFRESH_TOKEN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 ngày

class AuthController {
  /**
   * [POST] /api/auth/register
   * Đăng ký tài khoản bằng email + mật khẩu.
   */
  public async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, confirmPassword, fullName } = req.body;
      if (!email || !password || !confirmPassword || !fullName) { res.status(400).json({ status: 'ERR', message: 'Vui lòng cung cấp đầy đủ họ tên, email, mật khẩu và nhập lại mật khẩu.' }); return; }
      await authService.register(email, password, confirmPassword, fullName);
      res.status(200).json({ status: 'OK', message: 'Mã OTP đã được gửi đến email của bạn.', data: { email: email.trim().toLowerCase(), expiresIn: 300 } });
    } catch (error: any) { res.status(400).json({ status: 'ERR', message: error.message }); }
  }

  public async verifyRegistration(req: Request, res: Response): Promise<void> {
    try {
      const { email, otp } = req.body;
      if (!email || !otp) { res.status(400).json({ status: 'ERR', message: 'Vui lòng nhập email và OTP.' }); return; }
      const user = await authService.verifyRegistration(email, otp);
      res.status(201).json({ status: 'OK', message: 'Đăng ký tài khoản thành công!', data: { _id: user._id, email: user.email, fullName: user.fullName, role: user.role } });
    } catch (error: any) { res.status(400).json({ status: 'ERR', message: error.message }); }
  }
  /**
   * [POST] /api/auth/login
   * Đăng nhập bằng email + mật khẩu.
   * Trả về access_token trong body + refresh_token trong HttpOnly Cookie.
   */
  public async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng cung cấp email và mật khẩu.' });
        return;
      }
      const user = await authService.login(email, password);
      const { sessionId, refreshToken } = await authSessionService.createSession(
        user._id.toString(), user.role, getSessionMetadata(req),
      );
      const access_token = generalAccessToken({
        id: user._id.toString(), role: user.role, fullName: user.fullName, email: user.email, sid: sessionId,
      });
      res.cookie('refresh_token', refreshToken, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
      });
      res.status(200).json({
        status: 'OK', message: 'Đăng nhập thành công!',
        data: {
          user: { _id: user._id, email: user.email, fullName: user.fullName, role: user.role, subscriptionStatus: user.subscriptionStatus },
          access_token,
        },
      });
    } catch (error: any) {
      res.status(401).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/auth/refresh-token
   * Rotate refresh token của phiên hiện tại và cấp access token mới.
   */
  public async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const token = req.cookies?.refresh_token;
      if (!token) {
        res.status(401).json({ status: 'ERR', message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
        return;
      }
      const result = await refreshTokenJwtService(token);
      if (result.status === 'ERR' || !result.decoded?.id || !result.decoded.sid) {
        res.clearCookie('refresh_token');
        res.status(401).json({ status: 'ERR', message: 'Phiên đăng nhập cũ không còn hợp lệ. Vui lòng đăng nhập lại.' });
        return;
      }
      const user = await authService.getProfile(result.decoded.id);
      if (!user || user.isLocked) {
        if (user?.isLocked) await redisClient.set(`locked_user:${result.decoded.id}`, '1');
        await authSessionService.revokeAll(result.decoded.id, 'ACCOUNT_LOCKED');
        res.clearCookie('refresh_token');
        res.status(403).json({ status: 'ERR', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' });
        return;
      }
      const rotated = await authSessionService.rotateSession(
        token,
        { id: result.decoded.id, role: user.role, sid: result.decoded.sid },
        getSessionMetadata(req),
      );
      const access_token = generalAccessToken({
        id: result.decoded.id, role: user.role, fullName: user.fullName ?? '', email: user.email ?? '', sid: rotated.sessionId,
      });
      res.cookie('refresh_token', rotated.refreshToken, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
      });
      res.status(200).json({ status: 'OK', message: 'Cấp lại access token thành công.', access_token });
    } catch (error: any) {
      res.clearCookie('refresh_token');
      res.status(401).json({ status: 'ERR', message: error.message || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
    }
  }

  /**
   * [GET] /api/auth/me
   * Lấy thông tin profile (yêu cầu có Access Token hợp lệ).
   */
  public async getMe(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = await authService.getProfile(req.userId!);
      if (!user) {
        res.status(404).json({ status: 'ERR', message: 'Không tìm thấy người dùng.' });
        return;
      }

      res.status(200).json({ status: 'OK', data: user });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/auth/instructors/:id/public-profile
   * Public profile tối giản để trang chi tiết khóa học hiển thị avatar/bio giảng viên.
   */
  public async getPublicInstructorProfile(req: Request, res: Response): Promise<void> {
    try {
      const instructor = await authService.getPublicInstructorProfile(req.params.id as string);
      if (!instructor) {
        res.status(404).json({ status: 'ERR', message: 'Không tìm thấy giảng viên.' });
        return;
      }

      res.status(200).json({ status: 'OK', data: instructor });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  public async getPublicProfileBySlug(req: Request, res: Response): Promise<void> {
    try {
      const profile = await authService.getPublicProfileBySlug(String(req.params.slug));
      if (!profile) {
        res.status(404).json({ status: 'ERR', message: 'Không tìm thấy hồ sơ công khai.' });
        return;
      }
      res.status(200).json({ status: 'OK', data: profile });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  public async searchPublicInstructors(req: Request, res: Response): Promise<void> {
    try {
      const data = await authService.searchPublicInstructors(String(req.query.search || ''), Number(req.query.limit || 3));
      res.status(200).json({ status: 'OK', data });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * Callback sau khi Google OAuth2 xác thực thành công.
   */
  public async googleCallback(req: Request, res: Response): Promise<void> {
    try {
      const user: any = req.user;
      const { sessionId, refreshToken } = await authSessionService.createSession(
        user._id.toString(), user.role, getSessionMetadata(req),
      );
      const access_token = generalAccessToken({
        id: user._id.toString(), role: user.role, fullName: user.fullName, email: user.email, sid: sessionId,
      });
      res.cookie('refresh_token', refreshToken, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
      });
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
      res.redirect(`${clientUrl}/oauth-callback?token=${access_token}`);
    } catch (_error: any) {
      res.status(500).json({ status: 'ERR', message: 'Lỗi xử lý đăng nhập Google.' });
    }
  }

  /** [POST] /api/auth/logout */
  public async logout(req: AuthRequest, res: Response): Promise<void> {
    try {
      await authSessionService.revokeCurrent(req.userId!, req.sessionId!);
    } finally {
      res.clearCookie('refresh_token');
    }
    res.status(200).json({ status: 'OK', message: 'Đăng xuất thành công.' });
  }

  /** [GET] /api/auth/sessions */
  public async getSessions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await authSessionService.listActiveSessions(req.userId!, req.sessionId!);
      res.status(200).json({ status: 'OK', message: 'Lấy danh sách phiên đăng nhập thành công.', data });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  public async revokeSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const sessionId = String(req.params.sessionId || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
        res.status(400).json({ status: 'ERR', message: 'Mã phiên đăng nhập không hợp lệ.' });
        return;
      }
      await authSessionService.revokeSession(req.userId!, sessionId, req.sessionId!);
      res.status(200).json({ status: 'OK', message: 'Đã đăng xuất thiết bị.' });
    } catch (error: any) {
      const status = String(error.message).includes('Không tìm thấy') ? 404 : 400;
      res.status(status).json({ status: 'ERR', message: error.message });
    }
  }

  public async revokeOtherSessions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const revokedCount = await authSessionService.revokeOthers(req.userId!, req.sessionId!);
      res.status(200).json({ status: 'OK', message: 'Đã đăng xuất khỏi tất cả thiết bị khác.', data: { revokedCount } });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }
  public async updateProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { fullName, phone, bio, headline, website, github, facebook, youtube, linkedin } = req.body;
      const avatarUrl = req.file?.path; // Lấy URL từ Cloudinary nếu có up file

      const updatedUser = await authService.updateProfile(req.userId!, {
        fullName,
        phone,
        bio,
        headline,
        website,
        github,
        facebook,
        youtube,
        linkedin,
        avatarUrl,
      });

      // Nếu fullName thay đổi → chỉ cấp lại access token mới (không cấp lại refresh token — tránh reset thời gian session)
      let new_access_token: string | undefined;
      if (fullName !== undefined && updatedUser) {
        new_access_token = generalAccessToken({
          id: req.userId!,
          role: req.userRole!,
          fullName: updatedUser.fullName,
          email: updatedUser.email ?? '',
          sid: req.sessionId,
        });
      }

      res.status(200).json({
        status: 'OK',
        message: 'Cập nhật thành công',
        data: updatedUser,
        // access_token mới chỉ được trả về khi fullName thay đổi
        ...(new_access_token && { access_token: new_access_token }),
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [DELETE] /api/auth/account
   * Xóa tài khoản người dùng
   */
  public async deleteAccount(req: AuthRequest, res: Response): Promise<void> {
    try {
      await authSessionService.revokeAll(req.userId!, 'ACCOUNT_DELETED');
      await authService.deleteAccount(req.userId!);
      res.clearCookie('refresh_token');
      res.status(200).json({ status: 'OK', message: 'Đã xóa tài khoản thành công.' });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }
  /**
   * [PUT] /api/auth/password
   * Thay đổi mật khẩu
   */
  public async changePassword(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { oldPassword, newPassword } = req.body;
      const updatedUser = await authService.changePassword(req.userId!, oldPassword, newPassword);
      await authSessionService.revokeAll(req.userId!, 'PASSWORD_CHANGED');
      res.clearCookie('refresh_token');
      res.status(200).json({
        status: 'OK',
        message: 'Mật khẩu đã được cập nhật thành công.',
        data: updatedUser,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/auth/forgot-password
   * Yêu cầu gửi OTP về email
   */
  public async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng cung cấp email.' });
        return;
      }

      await authService.forgotPassword(email);
      res.status(200).json({ status: 'OK', message: 'Mã OTP đã được gửi đến email của bạn.' });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/auth/verify-reset-otp
   * Kiểm tra OTP hợp lệ trước khi cho phép nhập mật khẩu mới
   */
  public async verifyResetOTP(req: Request, res: Response): Promise<void> {
    try {
      const { email, otp } = req.body;
      if (!email || !otp) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng cung cấp email và otp.' });
        return;
      }
      
      await authService.verifyResetOTP(email, otp);
      res.status(200).json({ status: 'OK', message: 'Mã OTP hợp lệ.' });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/auth/reset-password
   * Nhập OTP và mật khẩu mới
   */
  public async resetPassword(req: Request, res: Response): Promise<void> {
    try {
       const { email, otp, newPassword } = req.body;
       if (!email || !otp || !newPassword) {
         res.status(400).json({ status: 'ERR', message: 'Vui lòng cung cấp đầy đủ email, otp và newPassword.' });
         return;
       }

       const userId = await authService.resetPasswordByOTP(email, otp, newPassword);
       await authSessionService.revokeAll(userId, 'PASSWORD_RESET');
       res.status(200).json({ status: 'OK', message: 'Khôi phục mật khẩu thành công. Vui lòng đăng nhập lại.' });
    } catch (error: any) {
       res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [PUT] /api/auth/profile/role
   * Chuyển đổi vai trò sang giảng viên.
   * Cấp lại cả access_token + refresh_token mới chứa role INSTRUCTOR
   * để frontend không cần đợi refresh/login lại.
   */
  public async switchToInstructor(req: AuthRequest, res: Response): Promise<void> {
    try {
      const updatedUser = await authService.switchToInstructor(req.userId!);
      const refresh_token = await authSessionService.replaceSessionRole(
        updatedUser!._id.toString(), req.sessionId!, updatedUser!.role,
      );
      const access_token = generalAccessToken({
        id: updatedUser!._id.toString(),
        role: updatedUser!.role,
        fullName: updatedUser!.fullName,
        email: updatedUser!.email ?? '',
        sid: req.sessionId,
      });
      res.cookie('refresh_token', refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
      });
      res.status(200).json({ status: 'OK', message: 'Chuyển vai trò thành công', data: updatedUser, access_token });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new AuthController();
