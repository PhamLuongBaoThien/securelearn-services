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
  userName?: string; // fullName của user, được giải mã từ JWT payload
  userEmail?: string;
  userPermissions?: string[];
  file?: any;
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

/**
 * Middleware kiểm tra role INSTRUCTOR.
 * Phải dùng sau extractUser.
 */
export const requireInstructor = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userRole !== 'INSTRUCTOR') {
    res.status(403).json({ status: 'ERR', message: 'Chỉ giảng viên mới có quyền thực hiện hành động này.' });
    return;
  }
  next();
};

/**
 * Middleware kiểm tra role ADMIN.
 * Phải dùng sau extractUser.
 */
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userRole !== 'ADMIN') {
    res.status(403).json({ status: 'ERR', message: 'Chỉ admin mới có quyền thực hiện hành động này.' });
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

/**
 * Middleware kiểm tra role STUDENT.
 * Phải dùng sau extractUser.
 */
export const requireStudent = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userRole !== 'STUDENT') {
    res.status(403).json({ status: 'ERR', message: 'Chỉ học viên mới có quyền thực hiện hành động này.' });
    return;
  }
  next();
};

/**
 * Middleware cho phép cả STUDENT lẫn INSTRUCTOR truy cập.
 * Dùng cho các chức năng mà giảng viên cũng được phép thực hiện với tư cách học viên
 * (ví dụ: ghi danh khóa học của người khác, xem danh sách khóa đã học).
 * Phải dùng sau extractUser.
 */
export const requireStudentOrInstructor = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userRole !== 'STUDENT' && req.userRole !== 'INSTRUCTOR') {
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền thực hiện hành động này.' });
    return;
  }
  next();
};
