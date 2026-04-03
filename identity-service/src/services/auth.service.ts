// ========================
// Service Layer: Xử lý logic nghiệp vụ Authentication (User)
// Không chứa logic JWT — đã tách sang jwt.service.ts
// ========================
import bcrypt from 'bcryptjs';
import { User, IUser, Role } from '../models/user.model';

class AuthService {
  /**
   * Đăng ký tài khoản mới (email + mật khẩu).
   */
  public async register(email: string, password: string, fullName: string): Promise<IUser> {
    // 1. Kiểm tra email đã tồn tại chưa
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new Error('Email này đã được sử dụng.');
    }

    // 2. Hash mật khẩu bằng bcrypt (salt 10 rounds)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Lưu user mới vào MongoDB
    const newUser = new User({
      email,
      password: hashedPassword,
      fullName,
      role: Role.STUDENT,
    });

    await newUser.save();
    return newUser;
  }

  /**
   * Đăng nhập bằng email + mật khẩu.
   * Chỉ xác minh thông tin — việc sinh token do Controller gọi jwt.service.
   */
  public async login(email: string, password: string): Promise<IUser> {
    // 1. Tìm user theo email
    const user = await User.findOne({ email });
    if (!user) {
      throw new Error('Email không tồn tại trong hệ thống.');
    }

    // 2. Nếu user đăng ký qua Google thì không có password cục bộ
    if (!user.password) {
      throw new Error('Tài khoản này dùng Google để đăng nhập. Vui lòng chọn "Đăng nhập bằng Google".');
    }

    // 3. So sánh mật khẩu
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new Error('Mật khẩu không chính xác.');
    }

    return user;
  }

  /**
   * Lấy thông tin profile của user theo ID.
   */
  public async getProfile(userId: string): Promise<IUser | null> {
    const user = await User.findById(userId).select('-password');
    return user;
  }
}

export default new AuthService();
