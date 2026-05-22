import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Kong đã verify JWT trước khi request đi vào media-service.
// Middleware này chỉ decode token để lấy userId/userRole phục vụ nghiệp vụ.
export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export const extractUser = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập.' });
    return;
  }

  const decoded = jwt.decode(token) as { id: string; role?: string } | null;
  if (!decoded?.id) {
    res.status(401).json({ status: 'ERR', message: 'Token không hợp lệ.' });
    return;
  }

  req.userId = decoded.id;
  req.userRole = decoded.role;
  next();
};
