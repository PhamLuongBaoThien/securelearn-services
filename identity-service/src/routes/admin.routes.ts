// ========================
// Routes: API endpoint cho Admin Authentication & Management
// Hoàn toàn tách biệt với User — đường dẫn khác, cookie khác.
// ========================
import { Router } from 'express';
import adminController from '../controllers/admin.controller';
import { extractUser } from '../middlewares/auth.middleware';
import { forbidSelfAdminDeletion, requirePermission, requireSuperAdmin } from '../middlewares/admin-authz.middleware';
import upload from '../middlewares/upload.middleware';

const router = Router();

// ─── Auth ─────────────────────────────────────────────────────────────────────
// [POST] /api/admin/auth/login — Xác thực quản trị viên và cấp token/cookie đăng nhập admin.
router.post('/login', adminController.login);

// [POST] /api/admin/auth/logout — Kết thúc phiên đăng nhập quản trị hiện tại.
router.post('/logout', adminController.logout);

// [GET] /api/admin/auth/me — Lấy hồ sơ, vai trò và quyền của quản trị viên hiện tại.
router.get('/me', extractUser, adminController.getMe);

// [POST] /api/admin/auth/refresh-token — Dùng refresh token admin để cấp access token mới.
router.post('/refresh-token', adminController.refreshToken);

// ─── Profile ──────────────────────────────────────────────────────────────────
// [PUT] /api/admin/auth/profile — Cập nhật thông tin cá nhân và avatar của quản trị viên.
router.put('/profile', extractUser, upload.single('avatar'), adminController.updateProfile);

// [PUT] /api/admin/auth/password — Đổi mật khẩu cho quản trị viên đang đăng nhập.
router.put('/password', extractUser, adminController.changePassword);

// ─── Staff Management (SUPER_ADMIN only) ──────────────────────────────────────
// [GET] /api/admin/auth/staff — SUPER_ADMIN xem danh sách tài khoản nhân sự quản trị.
router.get('/staff', extractUser, requireSuperAdmin, adminController.getStaff);

// [POST] /api/admin/auth/staff — SUPER_ADMIN tạo tài khoản nhân sự quản trị mới.
router.post('/staff', extractUser, requireSuperAdmin, adminController.createStaff);

// [DELETE] /api/admin/auth/staff/multi — SUPER_ADMIN xóa nhiều tài khoản nhân sự hợp lệ.
router.delete('/staff/multi', extractUser, requireSuperAdmin, adminController.multiDeleteStaff);

// [PUT] /api/admin/auth/staff/:id — SUPER_ADMIN cập nhật hồ sơ/vai trò của một nhân sự.
router.put('/staff/:id', extractUser, requireSuperAdmin, adminController.updateStaff);

// [DELETE] /api/admin/auth/staff/:id — SUPER_ADMIN xóa một nhân sự, đồng thời cấm tự xóa chính mình.
router.delete('/staff/:id', extractUser, requireSuperAdmin, forbidSelfAdminDeletion, adminController.deleteStaff);

// ─── Role Permissions (SUPER_ADMIN only) ──────────────────────────────────────
// [GET] /api/admin/auth/roles — Lấy tất cả role + permissions (cho phép mọi admin đọc để render menu)
router.get('/roles', extractUser, requireSuperAdmin, adminController.getRolePermissions);

// [POST] /api/admin/auth/roles — Tạo role mới
router.post('/roles', extractUser, requireSuperAdmin, adminController.createRole);

// [PUT] /api/admin/auth/roles/:role — Cập nhật permissions/label/color
router.put('/roles/:role', extractUser, requireSuperAdmin, adminController.updateRolePermissions);

// [DELETE] /api/admin/auth/roles/:role — Xóa role
router.delete('/roles/:role', extractUser, requireSuperAdmin, adminController.deleteRole);

// ─── User Management (Student & Instructor) ───────────────────────────────────
// [GET] /api/admin/auth/users — Quản trị viên có quyền user:read tra cứu danh sách học viên/giảng viên.
router.get('/users', extractUser, requirePermission('user:read'), adminController.getUsers);

// [PATCH] /api/admin/auth/users/multi-lock — Khóa đồng loạt nhiều tài khoản người dùng.
router.patch('/users/multi-lock', extractUser, requirePermission('user:lock'), adminController.multiLockUsers);

// [PATCH] /api/admin/auth/users/multi-unlock — Mở khóa đồng loạt nhiều tài khoản người dùng.
router.patch('/users/multi-unlock', extractUser, requirePermission('user:lock'), adminController.multiUnlockUsers);

// [PATCH] /api/admin/auth/users/:id/lock — Khóa một tài khoản và vô hiệu hóa quyền truy cập của họ.
router.patch('/users/:id/lock', extractUser, requirePermission('user:lock'), adminController.lockUser);

// [PATCH] /api/admin/auth/users/:id/unlock — Mở khóa lại một tài khoản cụ thể.
router.patch('/users/:id/unlock', extractUser, requirePermission('user:lock'), adminController.unlockUser);

export default router;
