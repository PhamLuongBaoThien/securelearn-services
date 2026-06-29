// ========================
// Controller Layer: Xử lý Request/Response cho Authentication (Admin)
// Trang đăng nhập Admin hoàn toàn tách biệt với trang User.
// ========================
import { Request, Response } from 'express';
import adminService from '../services/admin.service';
import { generalAccessToken, generalRefreshToken, refreshTokenJwtService } from '../services/jwt.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import { User } from '../models/user.model';
import { Admin } from '../models/admin.model';
import redisClient from '../config/redis';
import authSessionService from '../services/authSession.service';

const REFRESH_TOKEN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 ngày

class AdminController {
  /**
   * [POST] /api/admin/auth/login
   * Đăng nhập vào hệ thống quản trị.
   */
  public async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng cung cấp email và mật khẩu.' });
        return;
      }

      const admin = await adminService.login(email, password);
      const adminProfile = await adminService.getProfile(admin._id.toString());

      const access_token = generalAccessToken({
        id: admin._id.toString(),
        role: 'ADMIN',
        fullName: admin.fullName,
        email: admin.email,
        permissions: adminProfile?.permissions || [],
      });
      const refresh_token = generalRefreshToken({ id: admin._id.toString(), role: 'ADMIN' });

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
            adminRole: admin.adminRole,
            status: admin.status,
            phone: admin.phone,
            department: admin.department,
            avatarUrl: admin.avatarUrl,
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
        res.status(401).json({ status: 'ERR', message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
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
        email: admin?.email ?? '',
        permissions: admin?.permissions || [],
      });

      res.status(200).json({
        status: 'OK',
        message: 'Cấp lại access token thành công.',
        access_token,
      });
    } catch (error: any) {
      res.clearCookie('admin_refresh_token');
      res.status(401).json({ status: 'ERR', message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
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

      if (req.file) {
        updateData.avatarUrl = (req.file as any).path;
      }

      const updatedAdmin = await adminService.updateProfile(adminId, updateData);
      res.status(200).json({ status: 'OK', message: 'Cập nhật hồ sơ thành công.', data: updatedAdmin });
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
      await adminService.changePassword(req.userId!, oldPassword, newPassword);
      res.status(200).json({ status: 'OK', message: 'Thay đổi mật khẩu thành công.' });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  // ─── Staff Management ──────────────────────────────────────────────────────

  /**
   * [GET] /api/admin/auth/staff
   */
  public async getStaff(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const admins = await adminService.getAdmins();
      res.status(200).json({ status: 'OK', data: admins });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/admin/auth/staff
   */
  public async createStaff(req: AuthRequest, res: Response): Promise<void> {
    try {
      const admin = await adminService.createAdmin(req.body);
      res.status(201).json({ status: 'OK', message: 'Tạo tài khoản thành công', data: admin });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [PUT] /api/admin/auth/staff/:id
   */
  public async updateStaff(req: AuthRequest, res: Response): Promise<void> {
    try {
      const admin = await adminService.updateAdminInfo(req.params.id as string, req.body);
      res.status(200).json({ status: 'OK', message: 'Cập nhật thành công', data: admin });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [DELETE] /api/admin/auth/staff/:id
   */
  public async deleteStaff(req: AuthRequest, res: Response): Promise<void> {
    try {
      await adminService.deleteAdmin(req.params.id as string);
      res.status(200).json({ status: 'OK', message: 'Xóa tài khoản thành công' });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  // ─── Role Permissions ──────────────────────────────────────────────────────

  /**
   * [GET] /api/admin/auth/roles
   */
  public async getRolePermissions(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const roles = await adminService.getRolePermissions();
      res.status(200).json({ status: 'OK', data: roles });
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [POST] /api/admin/auth/roles — Tạo role mới
   */
  public async createRole(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { roleKey, label, color, permissions } = req.body;
      const newRole = await adminService.createRole({ roleKey, label, color, permissions });
      res.status(201).json({ status: 'OK', message: 'Tạo vai trò thành công.', data: newRole });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [PUT] /api/admin/auth/roles/:role — Cập nhật permissions/label/color
   */
  public async updateRolePermissions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const roleKey = req.params.role as string;
      const { permissions, label, color } = req.body;
      const updated = await adminService.updateRolePermissions(roleKey, { permissions, label, color });
      res.status(200).json({ status: 'OK', message: 'Cập nhật thành công.', data: updated });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  /**
   * [DELETE] /api/admin/auth/roles/:role — Xóa role
   */
  public async deleteRole(req: AuthRequest, res: Response): Promise<void> {
    try {
      await adminService.deleteRole(req.params.role as string);
      res.status(200).json({ status: 'OK', message: 'Đã xóa vai trò thành công.' });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }
  // ─── User Management (Student & Instructor) ────────────────────────────────

  /**
   * [GET] /api/admin/auth/users
   */
  public async getUsers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { role, status, search, page = 1, limit = 20 } = req.query;

      const query: Record<string, any> = {};
      if (role) query.role = role;
      if (status) query.status = status;
      if (search) {
        query.$or = [
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ];
      }

      // Map status filter
      if (status === 'LOCKED') {
        delete query.status;
        query.isLocked = true;
      } else if (status === 'ACTIVE') {
        delete query.status;
        query.isLocked = { $ne: true };
      }

      const skip = (Number(page) - 1) * Number(limit);
      const [users, total] = await Promise.all([
        User.find(query)
          .select('-password')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        User.countDocuments(query),
      ]);

      const adminIds = Array.from(
        new Set(
          users
            .flatMap((u: any) => [u.lockedBy, u.unlockedBy])
            .filter(Boolean)
            .map((id: any) => String(id))
        )
      );
      const admins = adminIds.length
        ? await Admin.find({ _id: { $in: adminIds } }).select('fullName email').lean()
        : [];
      const adminMap = new Map(
        admins.map((admin: any) => [
          admin._id.toString(),
          {
            _id: admin._id,
            fullName: admin.fullName,
            email: admin.email,
          },
        ])
      );

      const mapped = users.map((u: any) => ({
        _id: u._id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        status: u.isLocked ? 'LOCKED' : 'ACTIVE',
        isLocked: !!u.isLocked,
        subscriptionStatus: u.subscriptionStatus,
        phone: u.phone,
        profile: u.profile,
        lockedAt: u.lockedAt,
        lockedBy: u.lockedBy,
        lockReason: u.lockReason,
        unlockedAt: u.unlockedAt,
        unlockedBy: u.unlockedBy,
        unlockReason: u.unlockReason,
        lockedByAdmin: u.lockedBy ? adminMap.get(String(u.lockedBy)) : undefined,
        unlockedByAdmin: u.unlockedBy ? adminMap.get(String(u.unlockedBy)) : undefined,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        lastLoginAt: u.lastLoginAt,
      }));

      res.status(200).json({
        status: 'OK',
        data: {
          users: mapped,
          total,
          page: Number(page),
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (err: any) {
      res.status(500).json({ status: 'ERR', message: err.message });
    }
  }

  /**
   * [PATCH] /api/admin/auth/users/:id/lock
   */
  public async lockUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const reason = String(req.body.reason || '').trim();
      if (!reason) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng nhập lý do khóa tài khoản.' });
        return;
      }

      const user = await User.findByIdAndUpdate(
        req.params.id,
        {
          isLocked: true,
          lockedAt: new Date(),
          lockedBy: req.userId,
          lockReason: reason,
        },
        { new: true }
      ).select('-password');
      if (!user) {
        res.status(404).json({ status: 'ERR', message: 'Không tìm thấy người dùng.' });
        return;
      }
      await redisClient.set(`locked_user:${user._id.toString()}`, '1');
      await authSessionService.revokeAll(user._id.toString(), 'ACCOUNT_LOCKED');
      res.status(200).json({ status: 'OK', message: 'Đã khóa tài khoản.' });
    } catch (err: any) {
      res.status(500).json({ status: 'ERR', message: err.message });
    }
  }

  /**
   * [PATCH] /api/admin/auth/users/:id/unlock
   */
  public async unlockUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const reason = String(req.body.reason || '').trim();
      const user = await User.findByIdAndUpdate(
        req.params.id,
        {
          isLocked: false,
          unlockedAt: new Date(),
          unlockedBy: req.userId,
          unlockReason: reason,
        },
        { new: true }
      ).select('-password');
      if (!user) {
        res.status(404).json({ status: 'ERR', message: 'Không tìm thấy người dùng.' });
        return;
      }
      await redisClient.del(`locked_user:${user._id.toString()}`);
      res.status(200).json({ status: 'OK', message: 'Đã mở khóa tài khoản.' });
    } catch (err: any) {
      res.status(500).json({ status: 'ERR', message: err.message });
    }
  }

}

export default new AdminController();
