import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import redisClient from '../config/redis';

const PERMISSION_PREREQUISITES: Record<string, string> = {
  'finance:manage': 'finance:read',
};

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  sessionId?: string;
  userName?: string;
  userEmail?: string;
  userPermissions?: string[];
}

type DecodedAccessToken = {
  id: string;
  role: string;
  sid?: string;
  fullName?: string;
  email?: string;
  permissions?: string[];
};

const attachUser = (req: AuthRequest, decoded: DecodedAccessToken) => {
  req.userId = decoded.id;
  req.userRole = decoded.role;
  req.sessionId = decoded.sid;
  req.userName = decoded.fullName ?? '';
  req.userEmail = decoded.email ?? '';
  req.userPermissions = decoded.permissions ?? [];
};

const checkSession = async (decoded: DecodedAccessToken, res: Response): Promise<boolean> => {
  if (decoded.role === 'ADMIN') return true;
  if (!decoded.sid) {
    res.status(401).json({ status: 'ERR', message: 'Phiên đăng nhập cũ không còn hợp lệ. Vui lòng đăng nhập lại.' });
    return false;
  }
  const [isLocked, isRevoked] = await redisClient.mget(`locked_user:${decoded.id}`, `revoked_session:${decoded.sid}`);
  if (isLocked) {
    res.status(403).json({ status: 'ERR', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' });
    return false;
  }
  if (isRevoked) {
    res.status(401).json({ status: 'ERR', message: 'Phiên đăng nhập đã bị thu hồi.' });
    return false;
  }
  return true;
};

export const extractUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập. Vui lòng cung cấp token.' });
    return;
  }
  const decoded = jwt.decode(token) as DecodedAccessToken | null;
  if (!decoded?.id || !decoded.role) {
    res.status(401).json({ status: 'ERR', message: 'Token không hợp lệ.' });
    return;
  }
  attachUser(req, decoded);
  if (!(await checkSession(decoded, res))) return;
  next();
};

export const optionalExtractUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    next();
    return;
  }
  const decoded = jwt.decode(token) as DecodedAccessToken | null;
  if (!decoded?.id || !decoded.role) {
    res.status(401).json({ status: 'ERR', message: 'Token không hợp lệ.' });
    return;
  }
  attachUser(req, decoded);
  if (!(await checkSession(decoded, res))) return;
  next();
};

export const requireRoles = (...roles: string[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền thực hiện thao tác này.' });
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
