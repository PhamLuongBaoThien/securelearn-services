// ========================
// Service Layer: Xử lý logic nghiệp vụ Authentication (Admin)
// Không chứa logic JWT — đã tách sang jwt.service.ts
// ========================
import bcrypt from 'bcryptjs';
import { Admin, IAdmin } from '../models/admin.model';

class AdminService {
  /**
   * Đăng nhập Admin (email + mật khẩu).
   * Chỉ xác minh thông tin — việc sinh token do Controller gọi jwt.service.
   */
  public async login(email: string, password: string): Promise<IAdmin> {
    // 1. Tìm admin theo email
    const admin = await Admin.findOne({ email });
    if (!admin) {
      throw new Error('Tài khoản admin không tồn tại.');
    }

    // 2. So sánh mật khẩu
    if (!admin.password) {
      throw new Error('Tài khoản admin chưa được thiết lập mật khẩu.');
    }
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      throw new Error('Mật khẩu không chính xác.');
    }

    return admin;
  }

  /**
   * Tạo tài khoản Admin mới (phục vụ mục đích setup/test).
   */
  public async setupAdmin(adminData: any): Promise<IAdmin> {
    const existingAdmin = await Admin.findOne({ email: adminData.email });
    if (existingAdmin) {
      throw new Error('Admin với email này đã tồn tại.');
    }
    const hashPassword = await bcrypt.hash(adminData.password, 10);
    const newAdmin = await Admin.create({
      ...adminData,
      password: hashPassword
    });
    return newAdmin;
  }

  /**
   * Lấy thông tin profile Admin.
   */
  public async getProfile(adminId: string): Promise<IAdmin | null> {
    const admin = await Admin.findById(adminId).select('-password');
    return admin;
  }
}

export default new AdminService();
