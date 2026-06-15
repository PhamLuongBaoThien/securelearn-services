// Auth Middleware — Payment Service
// Mục đích:
// - decode JWT đã được Kong verify
// - gắn userId / role / name / email vào request
// - chặn tài khoản bị khóa trước khi tạo thanh toán
// Hàm chính:
// - extractUser(): lấy thông tin user từ Bearer token

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import redisClient from '../config/redis';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userName?: string;
  userEmail?: string;
  userPermissions?: string[];
}

export const extractUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập. Vui lòng cung cấp token.' });
    return;
  }

  const decoded = jwt.decode(token) as {
    id: string;
    role: string;
    fullName?: string;
    email?: string;
    permissions?: string[];
  } | null;
  if (!decoded) {
    res.status(401).json({ status: 'ERR', message: 'Token không hợp lệ.' });
    return;
  }

  req.userId = decoded.id;
  req.userRole = decoded.role;
  req.userName = decoded.fullName ?? '';
  req.userEmail = decoded.email ?? '';
  req.userPermissions = decoded.permissions ?? [];

  if (decoded.role !== 'ADMIN') {
    const isLocked = await redisClient.get(`locked_user:${decoded.id}`);
    if (isLocked) {
      res.status(403).json({ status: 'ERR', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' });
      return;
    }
  }

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
    if (req.userRole !== 'ADMIN' || !req.userPermissions?.includes(permission)) {
      res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền thực hiện thao tác này.' });
      return;
    }
    next();
  };
