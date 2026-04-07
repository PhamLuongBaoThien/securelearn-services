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
  fullName: string;
  role: Role;
  isVerified: boolean;
  subscriptionStatus: SubscriptionStatus;
  phone?: string;
  profile?: {
    avatarUrl?: string;
    bio?: string;
    headline?: string;
  };
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
    isVerified: {
      type: Boolean,
      default: false,
    },
    subscriptionStatus: {
      type: String,
      enum: Object.values(SubscriptionStatus),
      default: SubscriptionStatus.INACTIVE,
    },

    phone: {
      type: String,
      trim: true,
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

export const User = mongoose.model<IUser>('User', userSchema);
