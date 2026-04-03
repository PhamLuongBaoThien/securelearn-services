// ========================
// Middleware xác thực JWT Token (Access Token)
// ========================
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Mở rộng Request để chứa payload đã giải mã từ token
export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

/**
 * Middleware kiểm tra Access Token từ Header Authorization.
 * Nếu token hợp lệ => gắn userId, userRole vào request và cho đi tiếp.
 * Nếu không hợp lệ => trả về 401.
 */
export const verifyJWT = (req: AuthRequest, res: Response, next: NextFunction): void => {
  // Lấy token từ header Authorization: Bearer <token>
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập. Vui lòng cung cấp token.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN as string) as { id: string; role: string };

    // Gắn thông tin user vào request để controller/service sử dụng
    req.userId = decoded.id;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    res.status(401).json({ status: 'ERR', message: 'Access token không hợp lệ hoặc đã hết hạn.' });
  }
};
