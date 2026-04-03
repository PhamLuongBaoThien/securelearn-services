// ========================
// Controller Layer: Xử lý Request/Response cho Authentication (User)
// ========================
import { Request, Response } from 'express';
import authService from '../services/auth.service';
import { generalAccessToken, generalRefreshToken, refreshTokenJwtService } from '../services/jwt.service';
import { AuthRequest } from '../middlewares/auth.middleware';

class AuthController {
  /**
   * [POST] /api/v1/auth/register
   * Đăng ký tài khoản bằng email + mật khẩu.
   */
  public async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, fullName } = req.body;

      if (!email || !password || !fullName) {
        res.status(400).json({
          status: 'ERR',
          message: 'Vui lòng cung cấp đầy đủ: email, password, fullName.',
        });
        return;
      }

      if (password.length < 6) {
        res.status(400).json({
          status: 'ERR',
          message: 'Mật khẩu phải có ít nhất 6 ký tự.',
        });
        return;
      }

      const newUser = await authService.register(email, password, fullName);

      res.status(201).json({
        status: 'OK',
        message: 'Đăng ký tài khoản thành công!',
        data: {
          _id: newUser._id,
          email: newUser.email,
          fullName: newUser.fullName,
          role: newUser.role,
        },
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/v1/auth/login
   * Đăng nhập bằng email + mật khẩu.
   * Trả về access_token trong body + refresh_token trong HttpOnly Cookie.
   */
  public async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({
          status: 'ERR',
          message: 'Vui lòng cung cấp email và mật khẩu.',
        });
        return;
      }

      // Service chỉ xác minh thông tin, không sinh token
      const user = await authService.login(email, password);

      // Sinh token từ jwt.service
      const access_token = generalAccessToken({ id: user._id.toString(), role: user.role });
      const refresh_token = generalRefreshToken({ id: user._id.toString(), role: user.role });

      // Lưu Refresh Token vào HttpOnly Cookie (chống XSS — JS không đọc được)
      res.cookie('refresh_token', refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 365 * 24 * 60 * 60 * 1000, // 365 ngày
      });

      res.status(200).json({
        status: 'OK',
        message: 'Đăng nhập thành công!',
        data: {
          user: {
            _id: user._id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            subscriptionStatus: user.subscriptionStatus,
          },
          access_token,
        },
      });
    } catch (error: any) {
      res.status(401).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/v1/auth/refresh-token
   * Dùng Refresh Token (từ cookie) để cấp lại Access Token mới.
   * Giúp user duy trì đăng nhập mà không cần nhập lại mật khẩu.
   */
  public async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const token = req.cookies?.refresh_token;
      if (!token) {
        res.status(401).json({ status: 'ERR', message: 'Không tìm thấy refresh token.' });
        return;
      }

      const result = await refreshTokenJwtService(token);

      if (result.status === 'ERR') {
        res.clearCookie('refresh_token');
        res.status(401).json(result);
        return;
      }

      res.status(200).json({
        status: 'OK',
        message: result.message,
        access_token: result.access_token,
      });
    } catch (error: any) {
      res.clearCookie('refresh_token');
      res.status(401).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/v1/auth/me
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
   * Callback sau khi Google OAuth2 xác thực thành công.
   */
  public async googleCallback(req: Request, res: Response): Promise<void> {
    try {
      const user: any = req.user;
      const access_token = generalAccessToken({ id: user._id.toString(), role: user.role });
      const refresh_token = generalRefreshToken({ id: user._id.toString(), role: user.role });

      // Gắn refresh token vào cookie
      res.cookie('refresh_token', refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });

      // Redirect về frontend kèm access token qua query param
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
      res.redirect(`${clientUrl}/oauth-callback?token=${access_token}`);
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: 'Lỗi xử lý đăng nhập Google.' });
    }
  }

  /**
   * [POST] /api/v1/auth/logout
   * Đăng xuất — xóa cookie refresh token.
   */
  public async logout(_req: Request, res: Response): Promise<void> {
    res.clearCookie('refresh_token');
    res.status(200).json({ status: 'OK', message: 'Đăng xuất thành công.' });
  }
}

export default new AuthController();
