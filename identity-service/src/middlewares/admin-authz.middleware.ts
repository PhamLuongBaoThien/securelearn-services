// ========================
// Middleware: Admin Authorization
// - requireSuperAdmin: chỉ SUPER_ADMIN (dùng cho quản lý nhân viên — cố định, không config)
// - requirePermission: kiểm tra permission theo RolePermission collection (configurable)
// - forbidSelfAdminDeletion: không tự xóa chính mình
// ========================
import { Response, NextFunction } from 'express';
import { Admin, SUPER_ADMIN_ROLE } from '../models/admin.model';
import { RolePermission } from '../models/rolePermission.model';
import { AuthRequest } from './auth.middleware';
import { getRequiredPermissions } from '../utils/permission.utils';

/**
 * Chỉ cho phép Super Admin truy cập các endpoint quản lý nhân viên admin.
 * Đây là quyền cố định — không thay đổi được qua RBAC config.
 */
export const requireSuperAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập.' });
      return;
    }

    const admin = await Admin.findById(req.userId).select('adminRole');
    if (!admin) {
      res.status(404).json({ status: 'ERR', message: 'Tài khoản admin không tồn tại.' });
      return;
    }

    if (admin.adminRole !== SUPER_ADMIN_ROLE) {
      res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền quản lý nhân viên admin.' });
      return;
    }

    next();
  } catch (error: any) {
    res.status(500).json({ status: 'ERR', message: error.message || 'Không thể xác thực quyền admin.' });
  }
};

/**
 * Factory middleware: kiểm tra xem admin có permission cụ thể không.
 * SUPER_ADMIN luôn được bypass.
 * 
 * Cách dùng:
 *   router.get('/courses', extractUser, requirePermission('course:read'), controller.getCourses);
 */
export const requirePermission = (permissionId: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập.' });
        return;
      }

      const admin = await Admin.findById(req.userId).select('adminRole status');
      if (!admin) {
        res.status(404).json({ status: 'ERR', message: 'Tài khoản admin không tồn tại.' });
        return;
      }

      if (admin.status === 'LOCKED') {
        res.status(403).json({ status: 'ERR', message: 'Tài khoản admin đã bị khóa.' });
        return;
      }

      // SUPER_ADMIN bypass tất cả
      if (admin.adminRole === SUPER_ADMIN_ROLE) {
        next();
        return;
      }

      // Lookup permissions của role từ DB
      const rolePermission = await RolePermission.findOne({ roleKey: admin.adminRole }).select('permissions');
      const requiredPermissions = getRequiredPermissions(permissionId);
      const hasRequiredPermissions = requiredPermissions.every((requiredPermission) =>
        rolePermission?.permissions.includes(requiredPermission),
      );
      if (!rolePermission || !hasRequiredPermissions) {
        res.status(403).json({
          status: 'ERR',
          message: `Bạn không có quyền thực hiện hành động này. (Yêu cầu: ${requiredPermissions.join(', ')})`,
        });
        return;
      }

      next();
    } catch (error: any) {
      res.status(500).json({ status: 'ERR', message: error.message || 'Không thể xác thực quyền.' });
    }
  };
};

/**
 * Chặn thao tác xóa chính tài khoản admin hiện tại qua endpoint staff.
 */
export const forbidSelfAdminDeletion = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userId && req.params.id === req.userId) {
    res.status(403).json({ status: 'ERR', message: 'Không thể tự xóa tài khoản của chính mình.' });
    return;
  }
  next();
};
