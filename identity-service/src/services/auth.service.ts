// ========================
// Service Layer: Xử lý logic nghiệp vụ Authentication (User)
// Không chứa logic JWT — đã tách sang jwt.service.ts
// ========================
import bcrypt from 'bcryptjs';
import { User, IUser, Role } from '../models/user.model';
import redisClient from '../config/redis';
import mailerService from './mailer.service';
import otpService from './otp.service';
import { normalizeEmail, normalizePublicSlugBase, normalizeVietnamPhone } from '../utils/identity.utils';
import publicProfileSlugService from './publicProfileSlug.service';
import { getMissingInstructorFields } from '../validators/profile-completeness';
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
  public async register(emailInput: string, password: string, confirmPassword: string, fullName: string): Promise<void> {
    const email = normalizeEmail(emailInput);
    if (!fullName) throw new Error('Vui lòng cung cấp họ và tên.');
    const trimmedName = fullName.trim().normalize('NFC');
    if (!trimmedName) throw new Error('Vui lòng nhập họ và tên.');
    if (trimmedName.length < 2) throw new Error('Họ và tên phải có tối thiểu 2 ký tự.');
    if (/\d/.test(trimmedName)) throw new Error('Họ và tên không được chứa số.');

    if (password !== confirmPassword) throw new Error('Mật khẩu nhập lại không khớp.');
    if (password.length < 6) throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
    if (await User.exists({ email })) throw new Error('Email này đã được sử dụng.');
    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = await otpService.issue('register', email, { hashedPassword, fullName: trimmedName });
    await mailerService.sendRegistrationOTP(email, otp);
  }

  public async verifyRegistration(emailInput: string, otp: string): Promise<IUser> {
    const email = normalizeEmail(emailInput);
    const pending = await otpService.verify<{ hashedPassword: string; fullName: string }>('register', email, otp);
    if (await User.exists({ email })) throw new Error('Email này đã được sử dụng.');
    const newUser = await User.create({ email, password: pending.hashedPassword, hasPassword: true, fullName: pending.fullName, role: Role.STUDENT, emailVerifiedAt: new Date() });
    await publicProfileSlugService.ensureForUser(newUser);
    await publishUserRegistered({ userId: newUser._id.toString(), email: newUser.email, fullName: newUser.fullName, role: newUser.role, registeredAt: new Date().toISOString() });
    return newUser;
  }
  /**
   * Đăng nhập bằng email + mật khẩu.
   * Chỉ xác minh thông tin — việc sinh token do Controller gọi jwt.service.
   */
  public async login(emailInput: string, password: string): Promise<IUser> {
    const email = normalizeEmail(emailInput);
    // 1. Tìm user theo email
    const user = await User.findOne({ email });
    if (!user) {
      throw new Error('Email không tồn tại trong hệ thống.');
    }

    // 2. Kiểm tra tài khoản bị khóa
    if (user.isLocked) {
      await redisClient.set(`locked_user:${user._id.toString()}`, '1');
      throw new Error('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
    }
    await redisClient.del(`locked_user:${user._id.toString()}`);

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

  private mapPublicProfile(user: IUser, canonicalSlug: string) {
    return {
      _id: user._id.toString(), publicSlug: canonicalSlug, fullName: user.fullName,
      role: user.role, createdAt: user.createdAt,
      profile: {
        avatarUrl: user.profile?.avatarUrl || '',
        bio: user.profile?.bio || '',
        headline: user.profile?.headline || '',
        website: user.profile?.website || '',
        github: user.profile?.github || '',
        facebook: user.profile?.facebook || '',
        youtube: user.profile?.youtube || '',
        linkedin: user.profile?.linkedin || '',
      },
    };
  }

  public async getPublicProfileBySlug(slug: string) {
    const resolved = await publicProfileSlugService.resolve(slug);
    return resolved ? this.mapPublicProfile(resolved.user, resolved.canonicalSlug) : null;
  }

  public async searchPublicInstructors(searchInput: string, limitInput: number) {
    const search = searchInput.trim().slice(0, 100);
    const limit = Math.min(Math.max(limitInput || 3, 1), 10);
    if (!search) return [];
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({
      role: Role.INSTRUCTOR,
      isLocked: false,
      publicSlug: { $exists: true, $ne: '' },
      $or: [
        { fullName: { $regex: escaped, $options: 'i' } },
        { 'profile.headline': { $regex: escaped, $options: 'i' } },
      ],
    })
      .select('fullName publicSlug profile.avatarUrl profile.headline')
      .limit(limit)
      .lean();
    return users.map((user) => ({
      _id: user._id.toString(),
      publicSlug: user.publicSlug,
      fullName: user.fullName,
      headline: user.profile?.headline || '',
      avatarUrl: user.profile?.avatarUrl || '',
    }));
  }

  public async getPublicInstructorProfile(userId: string) {
    const user = await User.findOne({ _id: userId, role: Role.INSTRUCTOR, isLocked: false });
    if (!user) return null;
    return this.mapPublicProfile(user, await publicProfileSlugService.ensureForUser(user));
  }

  /** Cập nhật thông tin profile của user. */
  public async updateProfile(userId: string, data: { fullName?: string; phone?: string; avatarUrl?: string; bio?: string; headline?: string; website?: string; github?: string; facebook?: string; youtube?: string; linkedin?: string }): Promise<IUser | null> {
    const user = await User.findById(userId);
    if (!user) throw new Error('Người dùng không tồn tại.');
    if (data.fullName !== undefined) {
      const fullName = data.fullName.trim().normalize('NFC');
      if (fullName.length < 2) throw new Error('Họ và tên phải có tối thiểu 2 ký tự.');
      if (/\d/.test(fullName)) throw new Error('Họ và tên không được chứa số.');
      if (normalizePublicSlugBase(fullName) !== normalizePublicSlugBase(user.fullName)) {
        user.publicSlug = await publicProfileSlugService.buildUniqueSlug(userId, fullName);
      }
      user.fullName = fullName;
    }
    if (data.phone !== undefined) {
      const phoneInput = data.phone.trim();
      if (!phoneInput) user.phone = undefined;
      else {
        const phone = normalizeVietnamPhone(phoneInput);
        if (await User.exists({ phone, _id: { $ne: userId } })) throw new Error('Số điện thoại này đã được tài khoản khác sử dụng.');
        user.phone = phone;
      }
    }
    if (!user.profile) user.profile = {};
    if (data.avatarUrl !== undefined) user.profile.avatarUrl = data.avatarUrl;
    if (data.bio !== undefined) user.profile.bio = data.bio;
    if (data.headline !== undefined) user.profile.headline = data.headline;
    if (data.website !== undefined) user.profile.website = data.website;
    if (data.github !== undefined) user.profile.github = data.github;
    if (data.facebook !== undefined) user.profile.facebook = data.facebook;
    if (data.youtube !== undefined) user.profile.youtube = data.youtube;
    if (data.linkedin !== undefined) user.profile.linkedin = data.linkedin;
    try {
      await user.save();
    } catch (error: any) {
      if (error?.code === 11000) throw new Error('Thông tin cập nhật đã được tài khoản khác sử dụng.');
      throw error;
    }
    const updatedFields = Object.keys(data).filter((key) => data[key as keyof typeof data] !== undefined);
    await publishUserUpdated({
      userId, updatedFields,
      ...(data.fullName !== undefined && { fullName: user.fullName }),
      ...(data.avatarUrl !== undefined && { avatarUrl: user.profile?.avatarUrl || '' }),
      ...(data.bio !== undefined && { bio: user.profile?.bio || '' }),
    });
    return this.sanitizeUser(user) as any;
  }
  public async checkInstructorProfile(userId: string): Promise<{ complete: boolean; missingFields: string[] }> {
    const user = await User.findById(userId).lean();
    if (!user || user.role !== Role.INSTRUCTOR) return { complete: false, missingFields: ['role'] };
    const missingFields = getMissingInstructorFields(user);

    return { complete: missingFields.length === 0, missingFields };
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
   * Kiểm tra mật khẩu hiện tại trước khi gửi OTP đổi mật khẩu.
   */
  private async verifyCurrentPassword(user: IUser, oldPassword?: string): Promise<void> {
    if (!user.password) return;
    if (!oldPassword) throw new Error('Vui lòng nhập mật khẩu hiện tại.');
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) throw new Error('Mật khẩu hiện tại không đúng.');
  }

  /**
   * Gửi OTP về email của tài khoản đang đăng nhập để xác nhận đổi mật khẩu.
   */
  public async requestPasswordChangeOTP(userId: string, oldPassword?: string, newPassword?: string, confirmPassword?: string): Promise<void> {
    const user = await User.findById(userId);
    if (!user) throw new Error('Người dùng không tồn tại.');

    await this.verifyCurrentPassword(user, oldPassword);
    if (!newPassword || newPassword.length < 6) throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
    if (newPassword !== confirmPassword) throw new Error('Mật khẩu xác nhận không khớp.');
    const otp = await otpService.issue('password_change', userId, { email: user.email }, 300);
    await mailerService.sendPasswordChangeOTP(user.email, otp);
  }

  /**
   * Đổi mật khẩu sau khi xác thực mật khẩu hiện tại và OTP email.
   */
  public async changePassword(userId: string, oldPassword?: string, newPassword?: string, otp?: string): Promise<any> {
    const user = await User.findById(userId);
    if (!user) throw new Error('Người dùng không tồn tại.');

    if (!newPassword || newPassword.length < 6) {
       throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
    }
    if (!otp) throw new Error('Vui lòng nhập mã OTP đã gửi đến email.');

    await this.verifyCurrentPassword(user, oldPassword);
    await otpService.verify<{ email: string }>('password_change', userId, otp);

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.hasPassword = true;
    await user.save();
    return this.sanitizeUser(user);
  }

  /**
   * Quên mật khẩu: Gửi OTP qua email cho user.
   * Sử dụng otpService chung: HMAC digest, cooldown 60s, rate-limit 5 lần/giờ.
   */
  public async forgotPassword(email: string): Promise<void> {
    const user = await User.findOne({ email });
    if (!user) {
      throw new Error('Email chưa được đăng ký trong hệ thống.');
    }

    // Cho phép cả tài khoản Google-only dùng chức năng này
    // Mục đích: Tạo mật khẩu cục bộ để có thể đăng nhập bằng cả 2 cách

    const otp = await otpService.issue('password_reset', email, { email }, 300);
    await mailerService.sendPasswordResetOTP(email, otp);
  }

  /**
   * Kiểm tra tính hợp lệ của OTP (không xoá khỏi Redis — bước trung gian).
   */
  public async verifyResetOTP(email: string, otp: string): Promise<void> {
    await otpService.check('password_reset', email, otp);
  }

  /**
   * Reset mật khẩu thông qua OTP (xoá OTP sau khi thành công).
   */
  public async resetPasswordByOTP(email: string, otp: string, newPassword: string): Promise<string> {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
    }

    // Verify và consume OTP
    await otpService.verify('password_reset', email, otp);

    // Tìm và update User
    const user = await User.findOne({ email });
    if (!user) throw new Error('Người dùng không tồn tại.');

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.hasPassword = true;
    await user.save();
    return user._id.toString();
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

