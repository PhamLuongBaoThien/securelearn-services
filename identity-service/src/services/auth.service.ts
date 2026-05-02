// ========================
// Service Layer: Xử lý logic nghiệp vụ Authentication (User)
// Không chứa logic JWT — đã tách sang jwt.service.ts
// ========================
import bcrypt from 'bcryptjs';
import { User, IUser, Role } from '../models/user.model';
import redisClient from '../config/redis';
import mailerService from './mailer.service';
import {
  publishUserRegistered,
  publishUserUpdated,
  publishUserDeleted,
} from '../events/publishers';

class AuthService {
  private sanitizeUser(user: IUser): Omit<Record<string, any>, 'password'> { // Tức là không trả về password khi trả về user
    const sanitizedUser = user.toObject() as Record<string, any>; // .toObject() là để convert Mongoose Document sang plain JavaScript object, chuyển như thế để giúp không xóa property password khỏi user (property là )
    delete sanitizedUser.password;
    return sanitizedUser;
  }

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
      hasPassword: true,
      fullName,
      role: Role.STUDENT,
    });

    await newUser.save();

    // Publish event: Thông báo cho các service khác biết có user mới
    await publishUserRegistered({
      userId: newUser._id.toString(),
      email: newUser.email,
      fullName: newUser.fullName,
      role: newUser.role,
      registeredAt: new Date().toISOString(),
    });

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

    // 2. Kiểm tra tài khoản bị khóa
    if (user.isLocked) {
      throw new Error('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
    }

    // 3. Nếu user đăng ký qua Google thì không có password cục bộ
    if (!user.password) {
      throw new Error('Tài khoản này dùng Google để đăng nhập. Vui lòng chọn "Đăng nhập bằng Google".');
    }

    // 4. So sánh mật khẩu
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new Error('Mật khẩu không chính xác.');
    }

    // 5. Cập nhật lastLoginAt
    user.lastLoginAt = new Date();
    await user.save();

    return user;
  }

  /**
   * Lấy thông tin profile của user theo ID.
   */
  public async getProfile(userId: string): Promise<any> {
    // Read-only path: dùng lean() để lấy plain object trực tiếp,
    // tránh hydrate (hydrate là việc Mongoose tự động gán các method (giống như trong class) vào 1 object thông thường (plain object) để biến nó thành Mongoose document) thành Mongoose document rồi mới phải sanitizeUser().
    const user = await User.findById(userId).lean();
    if (user) {
      delete (user as any).password;
    }
    return user;
  }

  /**
   * Cập nhật thông tin profile của user.
   */
  public async updateProfile(userId: string, data: { fullName?: string; phone?: string; avatarUrl?: string; bio?: string; headline?: string }): Promise<IUser | null> {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('Người dùng không tồn tại.');
    }

    if (data.fullName !== undefined) user.fullName = data.fullName;
    if (data.phone !== undefined) user.phone = data.phone;
    
    // Khởi tạo profile object nếu chưa có
    if (!user.profile) {
      user.profile = {};
    }

    if (data.avatarUrl !== undefined) user.profile.avatarUrl = data.avatarUrl;
    if (data.bio !== undefined) user.profile.bio = data.bio;
    if (data.headline !== undefined) user.profile.headline = data.headline;

    await user.save();

    // Publish event: Thông báo profile đã được cập nhật
    // Gửi kèm fullName (nếu có thay đổi) để course-service tự đồng bộ instructorName
    const updatedFields = Object.keys(data).filter(
      (key) => data[key as keyof typeof data] !== undefined
    );
    await publishUserUpdated({
      userId,
      updatedFields,
      ...(data.fullName !== undefined && { fullName: user.fullName }),
    });

    return this.sanitizeUser(user) as any;
  }

  /**
   * Xóa tài khoản của user theo ID.
   */
  public async deleteAccount(userId: string): Promise<void> {
    const result = await User.findByIdAndDelete(userId);
    if (!result) {
      throw new Error('Người dùng không tồn tại.');
    }

    // Publish event: Thông báo user đã bị xóa
    await publishUserDeleted({ userId, email: result.email });
  }

  /**
   * Đổi mật khẩu
   */
  public async changePassword(userId: string, oldPassword?: string, newPassword?: string): Promise<any> {
    const user = await User.findById(userId);
    if (!user) throw new Error('Người dùng không tồn tại.');

    if (!newPassword || newPassword.length < 6) {
       throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
    }

    if (user.password) {
      // User đăng nhập bằng mật khẩu
      if (!oldPassword) throw new Error('Vui lòng nhập mật khẩu hiện tại.');
      const isMatch = await bcrypt.compare(oldPassword, user.password);
      if (!isMatch) throw new Error('Mật khẩu hiện tại không đúng.');
    } else {
      // User ban đầu đăng nhập bằng google, chưa có mật khẩu
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.hasPassword = true;
    await user.save();
    return this.sanitizeUser(user);
  }

  /**
   * Quên mật khẩu: Gửi OTP (15 phút) qua email cho user.
   */
  public async forgotPassword(email: string): Promise<void> {
    const user = await User.findOne({ email });
    if (!user) {
      throw new Error('Email chưa được đăng ký trong hệ thống.');
    }

    // Cho phép cả tài khoản Google-only dùng chức năng này
    // Mục đích: Tạo mật khẩu cục bộ để có thể đăng nhập bằng cả 2 cách

    // Tạo mã OTP 6 số
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Lưu OTP vào Redis với TTL là 15 phút = 900s
    await redisClient.setex(`password_reset_otp:${email}`, 900, otp);

    // Gửi OTP mail
    await mailerService.sendPasswordResetOTP(email, otp);
  }

  /**
   * Quét và kiểm tra tính hợp lệ của OTP (không xoá khỏi Redis)
   */
  public async verifyResetOTP(email: string, otp: string): Promise<void> {
    const savedOtp = await redisClient.get(`password_reset_otp:${email}`);
    
    if (!savedOtp) {
       throw new Error('Mã OTP đã hết hạn hoặc không tồn tại. Vui lòng yêu cầu lại.');
    }

    if (savedOtp !== otp) {
       throw new Error('Mã OTP không chính xác.');
    }
  }

  /**
   * Reset mật khẩu thông qua OTP
   */
  public async resetPasswordByOTP(email: string, otp: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
    }

    // Lấy OTP từ Redis
    const savedOtp = await redisClient.get(`password_reset_otp:${email}`);
    
    if (!savedOtp) {
       throw new Error('Mã OTP đã hết hạn hoặc không tồn tại. Vui lòng yêu cầu lại.');
    }

    if (savedOtp !== otp) {
       throw new Error('Mã OTP không chính xác.');
    }

    // Tìm và update User
    const user = await User.findOne({ email });
    if (!user) throw new Error('Người dùng không tồn tại.');

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.hasPassword = true;
    await user.save();

    // Xóa OTP khỏi Redis
    await redisClient.del(`password_reset_otp:${email}`);
  }

  /**
   * Chuyển đổi vai trò của người dùng sang INSTRUCTOR
   */
  public async switchToInstructor(userId: string): Promise<IUser | null> {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('Người dùng không tồn tại.');
    }

    if (user.role !== Role.INSTRUCTOR) {
      user.role = Role.INSTRUCTOR;
      await user.save();
      
      // Publish event: Thông báo role đã được cập nhật
      await publishUserUpdated({ userId, updatedFields: ['role'] });
    }

    return user;
  }
}

export default new AuthService();
