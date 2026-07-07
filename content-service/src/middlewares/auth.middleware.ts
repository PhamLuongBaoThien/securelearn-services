import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userPermissions?: string[];
  file?: Express.Multer.File & { path?: string; filename?: string };
}

export const extractUser = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập.' });
    return;
  }
  const decoded = jwt.decode(token) as { id?: string; role?: string; permissions?: string[] } | null;
  if (!decoded?.id || !decoded.role) {
    res.status(401).json({ status: 'ERR', message: 'Token không hợp lệ.' });
    return;
  }
  req.userId = decoded.id;
  req.userRole = decoded.role;
  req.userPermissions = decoded.permissions || [];
  next();
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userRole !== 'ADMIN') {
    res.status(403).json({ status: 'ERR', message: 'Chỉ admin mới có quyền thực hiện thao tác này.' });
    return;
  }
  next();
};

export const requirePermission = (permission: string) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userPermissions?.includes(permission)) {
      res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền thực hiện thao tác này.' });
      return;
    }
    next();
  };
