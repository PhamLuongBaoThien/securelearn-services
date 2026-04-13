// ========================
// Service Layer: Xử lý logic nghiệp vụ Authentication (User)
// Không chứa logic JWT — đã tách sang jwt.service.ts
// ========================
import bcrypt from 'bcryptjs';
import { User, IUser, Role } from '../models/user.model';
import redisClient from '../config/redis';
import mailerService from './mailer.service';
import {
  publishMessage,
  Exchange,
  RoutingKey,
  type UserRegisteredPayload,
  type UserUpdatedPayload,
  type UserDeletedPayload,
} from '@securelearn/common';

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

    // Publish event: Thông báo cho các service khác biết có user mới
    await publishMessage<UserRegisteredPayload>(
      Exchange.IDENTITY,
      RoutingKey.USER_REGISTERED,
      {
        userId: newUser._id.toString(),
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        registeredAt: new Date().toISOString(),
      }
    );

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
  public async getProfile(userId: string): Promise<any> {
    const user = await User.findById(userId).lean();
    if (user) {
      // Trả về hasPassword để frontend biết user có mật khẩu cục bộ hay không
      (user as any).hasPassword = !!user.password; // as any giúp bỏ qua lỗi type
      delete (user as any).password; // Không trả password hash ra ngoài
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
    const updatedFields = Object.keys(data).filter(
      (key) => data[key as keyof typeof data] !== undefined
    );
    await publishMessage<UserUpdatedPayload>(
      Exchange.IDENTITY,
      RoutingKey.USER_UPDATED,
      {
        userId,
        updatedFields,
      }
    );

    return user;
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
    await publishMessage<UserDeletedPayload>(
      Exchange.IDENTITY,
      RoutingKey.USER_DELETED,
      {
        userId,
        email: result.email,
      }
    );
  }

  /**
   * Đổi mật khẩu
   */
  public async changePassword(userId: string, oldPassword?: string, newPassword?: string): Promise<void> {
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
    await user.save();
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
    await user.save();

    // Xóa OTP khỏi Redis
    await redisClient.del(`password_reset_otp:${email}`);
  }
}

export default new AuthService();
