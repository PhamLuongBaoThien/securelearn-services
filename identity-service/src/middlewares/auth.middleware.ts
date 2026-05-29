// ========================
// Middleware: Trích xuất thông tin User từ JWT (đã được Kong verify)
//
// Kong đã verify JWT trước khi request đến đây.
// Middleware chỉ cần decode token để lấy userId, userRole.
// ========================
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import redisClient from '../config/redis';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

/**
 * Middleware trích xuất thông tin user từ JWT token.
 * Kong đã verify token → middleware chỉ decode lấy data.
 */
export const extractUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập. Vui lòng cung cấp token.' });
    return;
  }

  const decoded = jwt.decode(token) as { id: string; role: string } | null;

  if (!decoded) {
    res.status(401).json({ status: 'ERR', message: 'Token không hợp lệ.' });
    return;
  }

  req.userId = decoded.id;
  req.userRole = decoded.role;
  if (decoded.role !== 'ADMIN') {
    const isLocked = await redisClient.get(`locked_user:${decoded.id}`);
    if (isLocked) {
      res.status(403).json({ status: 'ERR', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' });
      return;
    }
  }
  next();
};
