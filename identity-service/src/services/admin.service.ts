// ========================
// Service Layer: Xử lý logic nghiệp vụ Authentication (Admin)
// Không chứa logic JWT — đã tách sang jwt.service.ts
// ========================
import bcrypt from 'bcryptjs';
import { Admin, IAdmin, SUPER_ADMIN_ROLE } from '../models/admin.model';
import { RolePermission, IRolePermissionDoc as IRolePermission } from '../models/rolePermission.model';
import { User } from '../models/user.model';

class AdminService {
  // ─── Helpers ───────────────────────────────────────────────────────────────

  private sanitizeAdminPayload(admin: IAdmin | Record<string, any>) {
    const adminObj = typeof (admin as any).toObject === 'function' ? (admin as any).toObject() : { ...admin };
    delete adminObj.password;
    return adminObj;
  }

  private pickCreateAdminData(adminData: any) {
    const { email, password, fullName, adminRole, status, phone, department } = adminData;
    return { email, password, fullName, adminRole, status, phone, department };
  }

  private pickUpdateAdminData(updateData: any) {
    const allowedFields = ['fullName', 'adminRole', 'status', 'phone', 'department'];
    return allowedFields.reduce<Record<string, any>>((acc, field) => {
      if (updateData[field] !== undefined) {
        acc[field] = updateData[field];
      }
      return acc;
    }, {});
  }

  private async ensureRoleExists(roleKey?: string): Promise<void> {
    if (!roleKey) return;

    const roleExists = await RolePermission.exists({ roleKey });
    if (!roleExists) {
      throw new Error(`Vai trò "${roleKey}" không tồn tại.`);
    }
  }

  // ─── Auth ────────────────────────────────────────────────────────────────

  /**
   * Đăng nhập Admin (email + mật khẩu).
   */
  public async login(email: string, password: string): Promise<IAdmin> {
    const admin = await Admin.findOne({ email });
    if (!admin) {
      throw new Error('Tài khoản admin không tồn tại.');
    }

    if (!admin.password) {
      throw new Error('Tài khoản admin chưa được thiết lập mật khẩu.');
    }
    if (admin.status === 'LOCKED') {
      throw new Error('Tài khoản admin đã bị khóa.');
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      throw new Error('Mật khẩu không chính xác.');
    }

    // Cập nhật thời gian đăng nhập gần nhất
    admin.lastLoginAt = new Date();
    await admin.save();

    return admin;
  }

  /**
   * Lấy thông tin profile Admin.
   */
  public async getProfile(adminId: string): Promise<any | null> {
    const admin = await Admin.findById(adminId).select('-password').lean();
    if (!admin) return null;

    const roleConfig = await RolePermission.findOne({ roleKey: admin.adminRole }).lean();
    const permissions = roleConfig?.permissions || [];

    return { ...admin, permissions };
  }

  /**
   * Cập nhật thông tin Admin (phone, department, bio, avatarUrl).
   */
  public async updateProfile(adminId: string, updateData: Partial<IAdmin>): Promise<IAdmin> {
    const admin = await Admin.findByIdAndUpdate(
      adminId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');
    if (!admin) {
      throw new Error('Tài khoản admin không tồn tại.');
    }
    return admin;
  }

  /**
   * Đổi mật khẩu Admin.
   */
  public async changePassword(adminId: string, oldPassword?: string, newPassword?: string): Promise<void> {
    if (!newPassword) throw new Error('Vui lòng cung cấp mật khẩu mới.');

    const admin = await Admin.findById(adminId);
    if (!admin) throw new Error('Tài khoản admin không tồn tại.');
    if (!admin.password) throw new Error('Tài khoản admin chưa được thiết lập mật khẩu.');
    if (!oldPassword) throw new Error('Vui lòng cung cấp mật khẩu hiện tại.');

    const isMatch = await bcrypt.compare(oldPassword, admin.password);
    if (!isMatch) throw new Error('Mật khẩu hiện tại không chính xác.');

    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();
  }

  // ─── Staff Management ────────────────────────────────────────────────────

  /**
   * Lấy danh sách tất cả Admin (trừ password).
   */
  public async getAdmins(): Promise<any[]> {
    const admins = await Admin.find().select('-password').sort({ createdAt: -1 }).lean();
    return admins.map((admin) => this.sanitizeAdminPayload(admin));
  }

  /**
   * Tạo tài khoản Admin mới từ trang Quản lý.
   * Không thể tạo SUPER_ADMIN qua đây.
   */
  public async createAdmin(adminData: any): Promise<IAdmin> {
    const payload = this.pickCreateAdminData(adminData);

    if (!payload.email || !payload.password || !payload.fullName) {
      throw new Error('Vui lòng cung cấp đầy đủ họ tên, email và mật khẩu.');
    }

    if (payload.adminRole === SUPER_ADMIN_ROLE) {
      throw new Error('Không thể tạo tài khoản Super Admin qua giao diện này.');
    }

    await this.ensureRoleExists(payload.adminRole || 'SUPPORT_AGENT');

    // Admin và User là hai loại tài khoản độc lập, nên có thể dùng cùng một email.
    // Email vẫn phải duy nhất trong collection Admin.
    const existingAdmin = await Admin.findOne({ email: payload.email });
    if (existingAdmin) throw new Error('Email này đã được sử dụng cho một tài khoản nhân viên.');

    if (payload.phone) {
      const existingPhoneAdmin = await Admin.findOne({ phone: payload.phone });
      const existingPhoneUser = await User.findOne({ phone: payload.phone });
      if (existingPhoneAdmin || existingPhoneUser) throw new Error('Số điện thoại này đã được sử dụng.');
    }

    const hashPassword = await bcrypt.hash(payload.password, 10);
    const newAdmin = await Admin.create({
      email: payload.email,
      fullName: payload.fullName,
      adminRole: payload.adminRole || 'SUPPORT_AGENT',
      status: payload.status || 'ACTIVE',
      phone: payload.phone,
      department: payload.department,
      password: hashPassword,
    });

    return this.sanitizeAdminPayload(newAdmin) as any;
  }

  /**
   * Cập nhật thông tin Admin (adminRole, status, department, etc).
   */
  public async updateAdminInfo(adminId: string, updateData: any): Promise<IAdmin> {
    const sanitizedUpdate = this.pickUpdateAdminData(updateData);
    if (Object.keys(sanitizedUpdate).length === 0) {
      throw new Error('Không có dữ liệu hợp lệ để cập nhật.');
    }

    // Không thể thay đổi role thành SUPER_ADMIN qua đây
    if (sanitizedUpdate.adminRole === SUPER_ADMIN_ROLE) {
      throw new Error('Không thể gán vai trò Super Admin qua giao diện này.');
    }

    await this.ensureRoleExists(sanitizedUpdate.adminRole);

    if (sanitizedUpdate.phone) {
      const existingPhoneAdmin = await Admin.findOne({ phone: sanitizedUpdate.phone, _id: { $ne: adminId } });
      const existingPhoneUser = await User.findOne({ phone: sanitizedUpdate.phone });
      if (existingPhoneAdmin || existingPhoneUser) {
        throw new Error('Số điện thoại này đã được sử dụng bởi một tài khoản khác.');
      }
    }

    const admin = await Admin.findByIdAndUpdate(
      adminId,
      { $set: sanitizedUpdate },
      { new: true, runValidators: true }
    ).select('-password');
    if (!admin) throw new Error('Tài khoản admin không tồn tại.');
    return admin;
  }

  /**
   * Xóa tài khoản Admin (không thể xóa SUPER_ADMIN).
   */
  public async deleteAdmin(adminId: string): Promise<void> {
    const admin = await Admin.findById(adminId);
    if (!admin) throw new Error('Tài khoản admin không tồn tại.');
    if (admin.adminRole === SUPER_ADMIN_ROLE) throw new Error('Không thể xóa tài khoản Super Admin.');
    await Admin.findByIdAndDelete(adminId);
  }

  // ─── Role Permissions ────────────────────────────────────────────────────

  /**
   * Lấy tất cả role + permissions từ DB.
   */
  public async getRolePermissions(): Promise<IRolePermission[]> {
    return RolePermission.find().sort({ isSystem: -1, createdAt: 1 }).lean() as any;
  }

  /**
   * Tạo role mới (không phải system role).
   */
  public async createRole(data: {
    roleKey: string;
    label: string;
    color: string;
    permissions?: string[];
  }): Promise<IRolePermission> {
    const { roleKey, label, color, permissions = [] } = data;

    if (!roleKey || !label) throw new Error('Vui lòng cung cấp tên vai trò và key.');

    const cleanKey = roleKey.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    if (!cleanKey) throw new Error('Key vai trò không hợp lệ. Chỉ dùng chữ, số và dấu gạch dưới.');

    const existing = await RolePermission.findOne({ roleKey: cleanKey });
    if (existing) throw new Error(`Key "${cleanKey}" đã tồn tại.`);

    const newRole = await RolePermission.create({
      roleKey: cleanKey,
      label,
      color,
      permissions,
      isSystem: false,
    });
    return newRole;
  }

  /**
   * Cập nhật permissions, label, color cho một role.
   * SUPER_ADMIN: không thể thay đổi permissions, nhưng có thể không làm gì.
   */
  public async updateRolePermissions(
    roleKey: string,
    data: { permissions?: string[]; label?: string; color?: string }
  ): Promise<IRolePermission> {
    const role = await RolePermission.findOne({ roleKey });
    if (!role) throw new Error('Vai trò không tồn tại.');

    if (role.isSystem && data.permissions) {
      throw new Error('Không thể thay đổi permissions của System Role (Super Admin).');
    }

    const updateSet: Record<string, any> = {};
    if (data.permissions !== undefined && !role.isSystem) updateSet.permissions = data.permissions;
    if (data.label !== undefined) updateSet.label = data.label;
    if (data.color !== undefined) updateSet.color = data.color;

    const updated = await RolePermission.findOneAndUpdate(
      { roleKey },
      { $set: updateSet },
      { new: true }
    );
    if (!updated) throw new Error('Không thể cập nhật.');
    return updated;
  }

  /**
   * Xóa role (chỉ được xóa nếu không có admin nào đang dùng và không phải system role).
   */
  public async deleteRole(roleKey: string): Promise<void> {
    const role = await RolePermission.findOne({ roleKey });
    if (!role) throw new Error('Vai trò không tồn tại.');
    if (role.isSystem) throw new Error('Không thể xóa System Role.');

    const usageCount = await Admin.countDocuments({ adminRole: roleKey });
    if (usageCount > 0) {
      throw new Error(`Không thể xóa — có ${usageCount} nhân viên đang dùng vai trò này.`);
    }

    await RolePermission.deleteOne({ roleKey });
  }
}

export default new AdminService();
