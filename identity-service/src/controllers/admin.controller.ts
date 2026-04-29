// ========================
// Controller Layer: Xử lý Request/Response cho Authentication (Admin)
// Trang đăng nhập Admin hoàn toàn tách biệt với trang User.
// ========================
import { Request, Response } from 'express';
import adminService from '../services/admin.service';
import { generalAccessToken, generalRefreshToken, refreshTokenJwtService } from '../services/jwt.service';
import { AuthRequest } from '../middlewares/auth.middleware';

const REFRESH_TOKEN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 ngày

class AdminController {
  /**
   * [POST] /api/admin/auth/setup
   * Tạo tài khoản Admin cho việc test.
   */
  public async setupAdmin(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, fullName, permissions } = req.body;
      if (!email || !password || !fullName) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng cung cấp đủ thông tin.' });
        return;
      }

      const admin = await adminService.setupAdmin({ email, password, fullName, permissions: permissions || [] });
      res.status(201).json({
        status: 'OK',
        message: 'Tạo tài khoản Admin thành công.',
        data: {
          _id: admin._id,
          email: admin.email,
          fullName: admin.fullName,
          permissions: admin.permissions
        }
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/admin/auth/login
   * Đăng nhập vào hệ thống quản trị.
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

      // Service chỉ xác minh thông tin
      const admin = await adminService.login(email, password);

      // Sinh token từ jwt.service
      const access_token = generalAccessToken({
        id: admin._id.toString(),
        role: 'ADMIN',
        fullName: admin.fullName,
      });
      const refresh_token = generalRefreshToken({ id: admin._id.toString(), role: 'ADMIN' });

      // Lưu Refresh Token vào HttpOnly Cookie riêng cho admin
      res.cookie('admin_refresh_token', refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
      });

      res.status(200).json({
        status: 'OK',
        message: 'Đăng nhập Admin thành công!',
        data: {
          admin: {
            _id: admin._id,
            email: admin.email,
            fullName: admin.fullName,
            permissions: admin.permissions,
          },
          access_token,
        },
      });
    } catch (error: any) {
      res.status(401).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/admin/auth/refresh-token
   * Cấp lại Access Token mới cho Admin.
   */
  public async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const token = req.cookies?.admin_refresh_token;
      if (!token) {
        res.status(401).json({ status: 'ERR', message: 'Không tìm thấy refresh token.' });
        return;
      }

      const result = await refreshTokenJwtService(token);

      if (result.status === 'ERR') {
        res.clearCookie('admin_refresh_token');
        res.status(401).json(result);
        return;
      }

      const admin = await adminService.getProfile(result.decoded!.id);
      const access_token = generalAccessToken({
        id: result.decoded!.id,
        role: result.decoded!.role,
        fullName: admin?.fullName ?? '',
      });

      res.status(200).json({
        status: 'OK',
        message: 'Cấp lại access token thành công.',
        access_token,
      });
    } catch (error: any) {
      res.clearCookie('admin_refresh_token');
      res.status(401).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [GET] /api/admin/auth/me
   * Lấy thông tin Admin đang đăng nhập.
   */
  public async getMe(req: AuthRequest, res: Response): Promise<void> {
    try {
      const admin = await adminService.getProfile(req.userId!);
      if (!admin) {
        res.status(404).json({ status: 'ERR', message: 'Không tìm thấy tài khoản admin.' });
        return;
      }

      res.status(200).json({ status: 'OK', data: admin });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/admin/auth/logout
   * Đăng xuất Admin — xóa cookie refresh token.
   */
  public async logout(_req: Request, res: Response): Promise<void> {
    res.clearCookie('admin_refresh_token');
    res.status(200).json({ status: 'OK', message: 'Đăng xuất Admin thành công.' });
  }

  /**
   * [PUT] /api/admin/auth/profile
   * Cập nhật thông tin Admin. Hỗ trợ upload ảnh đại diện (multipart/form-data).
   */
  public async updateProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { fullName, phone, department, bio } = req.body;
      const adminId = req.userId!;

      const updateData: any = {};
      if (fullName) updateData.fullName = fullName;
      if (phone !== undefined) updateData.phone = phone;
      if (department !== undefined) updateData.department = department;
      if (bio !== undefined) updateData.bio = bio;

      // Xử lý avatarUrl nếu có upload file
      if (req.file) {
        updateData.avatarUrl = (req.file as any).path; // Lấy URL từ Cloudinary storage
      }

      const updatedAdmin = await adminService.updateProfile(adminId, updateData);
      
      res.status(200).json({
        status: 'OK',
        message: 'Cập nhật hồ sơ thành công.',
        data: updatedAdmin,
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [PUT] /api/admin/auth/password
   * Thay đổi mật khẩu cho Admin.
   */
  public async changePassword(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { oldPassword, newPassword } = req.body;
      const adminId = req.userId!;

      await adminService.changePassword(adminId, oldPassword, newPassword);

      res.status(200).json({
        status: 'OK',
        message: 'Thay đổi mật khẩu thành công.',
      });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new AdminController();
