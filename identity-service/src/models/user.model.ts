// - lưu thông tin định danh và tài khoản của người dùng chung (học viên, giảng viên)
// - quản lý thông tin đăng nhập, xác thực và trạng thái tài khoản
import mongoose, { Schema, Document } from 'mongoose';

export enum Role {
  STUDENT = 'STUDENT',
  INSTRUCTOR = 'INSTRUCTOR'
}

export enum SubscriptionStatus {
  INACTIVE = 'INACTIVE',
  ACTIVE = 'ACTIVE'
}

export interface IUser extends Document {
  email: string;
  password?: string;
  hasPassword: boolean;
  fullName: string;
  role: Role;
  isLocked: boolean;
  lockedAt?: Date;
  lockedBy?: string;
  lockReason?: string;
  unlockedAt?: Date;
  unlockedBy?: string;
  unlockReason?: string;
  subscriptionStatus: SubscriptionStatus;
  phone?: string;
  emailVerifiedAt?: Date;
  profile?: {
    avatarUrl?: string;
    bio?: string;
    headline?: string;
  };
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema: Schema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: Object.values(Role),
      default: Role.STUDENT,
    },
    subscriptionStatus: {
      type: String,
      enum: Object.values(SubscriptionStatus),
      default: SubscriptionStatus.INACTIVE,
    },

    hasPassword: {
      type: Boolean,
      default: false,
    },

    isLocked: {
      type: Boolean,
      default: false,
    },

    lockedAt: {
      type: Date,
    },

    lockedBy: {
      type: String,
      trim: true,
    },

    lockReason: {
      type: String,
      trim: true,
    },

    unlockedAt: {
      type: Date,
    },

    unlockedBy: {
      type: String,
      trim: true,
    },

    unlockReason: {
      type: String,
      trim: true,
    },

    phone: {
      type: String,
      trim: true,
    },

    emailVerifiedAt: { type: Date },

    lastLoginAt: {
      type: Date,
    },

    profile: {
      avatarUrl: String,
      bio: String,
      headline: String,
    },
  },
  {
    timestamps: true, // Tự động thêm createdAt và updatedAt
  }
);

userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);

userSchema.pre('save', function (next) {
  this.hasPassword = Boolean(this.password);
  next();
});

export const User = mongoose.model<IUser>('User', userSchema);
