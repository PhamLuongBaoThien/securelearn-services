import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import redisClient from '../config/redis';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  sessionId?: string;
  videoAccessMode?: 'LEARNER' | 'OWNER_PREVIEW';
}

export const extractUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập.' });
    return;
  }
  const decoded = jwt.decode(token) as { id: string; role?: string; sid?: string } | null;
  if (!decoded?.id || !decoded.role) {
    res.status(401).json({ status: 'ERR', message: 'Token không hợp lệ.' });
    return;
  }
  req.userId = decoded.id;
  req.userRole = decoded.role;
  req.sessionId = decoded.sid;
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