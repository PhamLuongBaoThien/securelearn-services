// ========================
// Cấu hình Google OAuth2 / OpenID Connect (Passport Strategy)
// ========================
import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import { User, Role } from '../models/user.model';
import {
  publishMessage,
  Exchange,
  RoutingKey,
  type UserRegisteredPayload,
} from '@securelearn/common';
import dotenv from 'dotenv';

dotenv.config();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '',
    },
    async (
      _accessToken: string,
      _refreshToken: string,
      profile: Profile,
      done: (error: any, user?: any) => void
    ) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error('Tài khoản Google không có email.'));
        }

        // Tìm User đã tồn tại hay chưa
        let user = await User.findOne({ email });

        if (!user) {
          // Tự động tạo tài khoản mới (OAuth2 Auto Provisioning)
          user = await User.create({
            email,
            fullName: profile.displayName || 'Người dùng Google',
            role: Role.STUDENT,
            isVerified: true, // Đã xác thực qua Google
            profile: {
              avatarUrl: profile.photos?.[0]?.value || '',
            },
          });

          // Publish event: User mới đăng ký qua Google
          await publishMessage<UserRegisteredPayload>(
            Exchange.IDENTITY,
            RoutingKey.USER_REGISTERED,
            {
              userId: user._id.toString(),
              email: user.email,
              fullName: user.fullName,
              role: user.role,
              registeredAt: new Date().toISOString(),
            }
          );
        } else {
          // Account Linking: User đã tồn tại (đăng ký bằng email/password)
          // → Cập nhật isVerified và avatar nếu chưa có
          let needSave = false;

          if (!user.isVerified) {
            user.isVerified = true; // Đã xác thực qua Google
            needSave = true;
          }

          if (!user.profile?.avatarUrl && profile.photos?.[0]?.value) {
            if (!user.profile) user.profile = {};
            user.profile.avatarUrl = profile.photos[0].value;
            needSave = true;
          }

          if (needSave) await user.save();
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

