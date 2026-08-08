import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/auth.service';

const PERMISSION_PREREQUISITES: Record<string, string> = {
  'notif:manage': 'notif:read',
};

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userPermissions?: string[];
}

export const extractUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace(/^Bearer\s+/i, '');
    const identity = await verifyAccessToken(token);
    req.userId = identity.id;
    req.userRole = identity.role;
    req.userPermissions = identity.permissions;
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token không hợp lệ.';
    const status = message.includes('khóa') ? 403 : 401;
    res.status(status).json({ status: 'ERR', message });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.userRole !== 'ADMIN') {
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền quản trị thông báo.' });
    return;
  }
  next();
};

export const requirePermission = (permission: string) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    const prerequisite = PERMISSION_PREREQUISITES[permission];
    const hasPermission = req.userPermissions?.includes(permission) &&
      (!prerequisite || req.userPermissions.includes(prerequisite));
    if (req.userRole !== 'ADMIN' || !hasPermission) {
      res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền thực hiện thao tác này.' });
      return;
    }
    next();
  };
