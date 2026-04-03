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
   * Lấy thông tin profile Admin.
   */
  public async getProfile(adminId: string): Promise<IAdmin | null> {
    const admin = await Admin.findById(adminId).select('-password');
    return admin;
  }
}

export default new AdminService();
