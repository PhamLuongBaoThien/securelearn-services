// ========================
// Routes: API endpoint cho Admin Authentication & Management
// Hoàn toàn tách biệt với User — đường dẫn khác, cookie khác.
// ========================
import { Router } from 'express';
import adminController from '../controllers/admin.controller';
import { extractUser } from '../middlewares/auth.middleware';
import { forbidSelfAdminDeletion, requireSuperAdmin } from '../middlewares/admin-authz.middleware';
import upload from '../middlewares/upload.middleware';

const router = Router();

// ─── Auth ─────────────────────────────────────────────────────────────────────
// [POST] /api/admin/auth/login
router.post('/login', adminController.login);

// [POST] /api/admin/auth/logout
router.post('/logout', adminController.logout);

// [GET] /api/admin/auth/me
router.get('/me', extractUser, adminController.getMe);

// [POST] /api/admin/auth/refresh-token
router.post('/refresh-token', adminController.refreshToken);

// ─── Profile ──────────────────────────────────────────────────────────────────
// [PUT] /api/admin/auth/profile
router.put('/profile', extractUser, upload.single('avatar'), adminController.updateProfile);

// [PUT] /api/admin/auth/password
router.put('/password', extractUser, adminController.changePassword);

// ─── Staff Management (SUPER_ADMIN only) ──────────────────────────────────────
// [GET] /api/admin/auth/staff
router.get('/staff', extractUser, requireSuperAdmin, adminController.getStaff);

// [POST] /api/admin/auth/staff
router.post('/staff', extractUser, requireSuperAdmin, adminController.createStaff);

// [PUT] /api/admin/auth/staff/:id
router.put('/staff/:id', extractUser, requireSuperAdmin, adminController.updateStaff);

// [DELETE] /api/admin/auth/staff/:id
router.delete('/staff/:id', extractUser, requireSuperAdmin, forbidSelfAdminDeletion, adminController.deleteStaff);

// ─── Role Permissions (SUPER_ADMIN only) ──────────────────────────────────────
// [GET] /api/admin/auth/roles — Lấy tất cả role + permissions (cho phép mọi admin đọc để render menu)
router.get('/roles', extractUser, adminController.getRolePermissions);

// [POST] /api/admin/auth/roles — Tạo role mới
router.post('/roles', extractUser, requireSuperAdmin, adminController.createRole);

// [PUT] /api/admin/auth/roles/:role — Cập nhật permissions/label/color
router.put('/roles/:role', extractUser, requireSuperAdmin, adminController.updateRolePermissions);

// [DELETE] /api/admin/auth/roles/:role — Xóa role
router.delete('/roles/:role', extractUser, requireSuperAdmin, adminController.deleteRole);

// ─── User Management (Student & Instructor) ───────────────────────────────────
// [GET] /api/admin/auth/users
router.get('/users', extractUser, adminController.getUsers);

// [PATCH] /api/admin/auth/users/:id/lock
router.patch('/users/:id/lock', extractUser, adminController.lockUser);

// [PATCH] /api/admin/auth/users/:id/unlock
router.patch('/users/:id/unlock', extractUser, adminController.unlockUser);

export default router;
