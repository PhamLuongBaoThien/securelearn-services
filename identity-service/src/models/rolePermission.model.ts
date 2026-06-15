// - định nghĩa các role (vai trò) động trong hệ thống kèm theo permission (quyền hạn)
// - phục vụ hệ thống phân quyền (RBAC) linh hoạt thay vì fix cứng enum
import mongoose, { Schema, Document } from 'mongoose';

export interface IRolePermissionDoc extends Document {
  roleKey: string;       // Key duy nhất, uppercase (VD: 'CONTENT_MANAGER', 'CUSTOM_ROLE')
  label: string;         // Tên hiển thị (VD: 'Quản lý nội dung')
  color: string;         // Màu badge (VD: 'violet', 'emerald', 'blue')
  permissions: string[];
  isSystem: boolean;     // true = không thể xóa (SUPER_ADMIN)
  updatedAt: Date;
}

const rolePermissionSchema: Schema = new Schema(
  {
    roleKey: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    color: {
      type: String,
      default: 'zinc',
      trim: true,
    },
    permissions: [{ type: String, trim: true }],
    isSystem: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export const RolePermission = mongoose.model<IRolePermissionDoc>('RolePermission', rolePermissionSchema);

// ===== Danh sách tất cả permissions trong hệ thống =====
export const ALL_PERMISSIONS = [
  'course:read', 'course:update', 'course:delete', 'course:approve',
  'user:read', 'user:lock',
  'finance:read', 'finance:manage',
  'notif:read', 'notif:manage',
  'system:config', 'system:rbac',
] as const;

export type PermissionId = (typeof ALL_PERMISSIONS)[number];

// ===== Màu có thể chọn cho badge =====
export const ROLE_COLORS = ['red', 'violet', 'emerald', 'blue', 'amber', 'pink', 'indigo', 'teal', 'orange', 'zinc'] as const;
export type RoleColor = (typeof ROLE_COLORS)[number];

// ===== Seed mặc định =====
interface SeedEntry { roleKey: string; label: string; color: string; permissions: string[]; isSystem: boolean }

const SEED_DATA: SeedEntry[] = [
  {
    roleKey: 'SUPER_ADMIN',
    label: 'Super Admin',
    color: 'red',
    permissions: [...ALL_PERMISSIONS],
    isSystem: true,
  },
  {
    roleKey: 'CONTENT_MANAGER',
    label: 'Quản lý nội dung',
    color: 'violet',
    permissions: ['course:read', 'course:update', 'course:approve'],
    isSystem: false,
  },
  {
    roleKey: 'FINANCE_MANAGER',
    label: 'Quản lý tài chính',
    color: 'emerald',
    permissions: ['finance:read', 'finance:manage'],
    isSystem: false,
  },
  {
    roleKey: 'SUPPORT_AGENT',
    label: 'Nhân viên hỗ trợ',
    color: 'blue',
    permissions: ['user:read'],
    isSystem: false,
  },
];

export async function seedRolePermissions(): Promise<void> {
  const count = await RolePermission.countDocuments();
  if (count > 0) {
    // Nếu đã có data cũ (thiếu label/color), migration nhẹ
    await RolePermission.updateMany(
      { label: { $exists: false } },
      [{ $set: { label: '$roleKey', color: 'zinc', isSystem: false } }]
    );
    // Đảm bảo SUPER_ADMIN có isSystem: true
    await RolePermission.updateOne({ roleKey: 'SUPER_ADMIN' }, { $set: { isSystem: true } });
    return;
  }
  await RolePermission.insertMany(SEED_DATA);
  console.log('[RolePermission] Seed mặc định đã được tạo.');
}
