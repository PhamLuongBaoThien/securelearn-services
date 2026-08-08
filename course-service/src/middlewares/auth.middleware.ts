import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import redisClient from '../config/redis';

const PERMISSION_PREREQUISITES: Record<string, string> = {
  'course:update': 'course:read',
  'course:delete': 'course:read',
  'course:approve': 'course:read',
};

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  sessionId?: string;
  userName?: string;
  userEmail?: string;
  userPermissions?: string[];
  file?: any;
}

export const extractUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập. Vui lòng cung cấp token.' });
    return;
  }
  const decoded = jwt.decode(token) as {
    id: string; role: string; sid?: string; fullName?: string; email?: string; permissions?: string[];
  } | null;
  if (!decoded?.id || !decoded.role) {
    res.status(401).json({ status: 'ERR', message: 'Token không hợp lệ.' });
    return;
  }
  req.userId = decoded.id;
  req.userRole = decoded.role;
  req.sessionId = decoded.sid;
  req.userName = decoded.fullName ?? '';
  req.userEmail = decoded.email ?? '';
  req.userPermissions = decoded.permissions ?? [];
  if (decoded.role !== 'ADMIN') {
    if (!decoded.sid) {
      res.status(401).json({ status: 'ERR', message: 'Phiên đăng nhập cũ không còn hợp lệ. Vui lòng đăng nhập lại.' });
      return;
    }
    const [isLocked, isRevoked] = await redisClient.mget(`locked_user:${decoded.id}`, `revoked_session:${decoded.sid}`);
    if (isLocked) {
      res.status(403).json({ status: 'ERR', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' });
      return;
    }
    if (isRevoked) {
      res.status(401).json({ status: 'ERR', message: 'Phiên đăng nhập đã bị thu hồi.' });
      return;
    }
  }
  next();
};

export const requireInstructor = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userRole !== 'INSTRUCTOR') {
    res.status(403).json({ status: 'ERR', message: 'Chỉ người giảng dạy mới có quyền thực hiện hành động này.' });
    return;
  }
  next();
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userRole !== 'ADMIN') {
    res.status(403).json({ status: 'ERR', message: 'Chỉ admin mới có quyền thực hiện hành động này.' });
    return;
  }
  next();
};

export const requirePermission = (permission: string) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    const prerequisite = PERMISSION_PREREQUISITES[permission];
    const hasPermission = req.userPermissions?.includes(permission) &&
      (!prerequisite || req.userPermissions.includes(prerequisite));
    if (req.userRole !== 'ADMIN' || !hasPermission) {
      res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền thực hiện thao tác này.' });
      return;
    }
    next();
  };

export const requireStudent = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userRole !== 'STUDENT') {
    res.status(403).json({ status: 'ERR', message: 'Chỉ học viên mới có quyền thực hiện hành động này.' });
    return;
  }
  next();
};

export const requireStudentOrInstructor = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userRole !== 'STUDENT' && req.userRole !== 'INSTRUCTOR') {
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền thực hiện hành động này.' });
    return;
  }
  next();
};
