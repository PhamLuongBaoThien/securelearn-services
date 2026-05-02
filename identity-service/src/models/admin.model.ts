import mongoose, { Schema, Document } from 'mongoose';

// ===== Admin Role Type =====
export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN' as const;
export type AdminRole = string;
export type AdminStatus = 'ACTIVE' | 'LOCKED';

export interface IAdmin extends Document {
  email: string;
  password?: string;
  fullName: string;
  // Role động, được validate theo RolePermission collection ở service/middleware
  adminRole: AdminRole;
  status: AdminStatus;
  phone?: string;
  department?: string;
  bio?: string;
  avatarUrl?: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const adminSchema: Schema = new Schema(
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
      required: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    adminRole: {
      type: String,
      // Không dùng enum cứng — validate động theo RolePermission collection
      default: 'SUPPORT_AGENT',
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'LOCKED'],
      default: 'ACTIVE',
    },
    phone: {
      type: String,
      trim: true,
    },
    department: {
      type: String,
      trim: true,
    },
    bio: {
      type: String,
    },
    avatarUrl: {
      type: String,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

export const Admin = mongoose.model<IAdmin>('Admin', adminSchema);
