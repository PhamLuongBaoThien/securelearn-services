import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import redisClient from '../config/redis';
export interface AuthRequest extends Request {
    userId?: string;
    userRole?: string;
}
export const extractUser = async (req: AuthRequest, res: Response, next: NextFunction) => { const token = req.header('Authorization')?.replace('Bearer ', ''); const decoded = token ? jwt.decode(token) as any : null; if (!decoded?.id || !decoded?.role) {
    res.status(401).json({ status: 'ERR', message: 'Token không hợp lệ.' });
    return;
} req.userId = decoded.id; req.userRole = decoded.role; if (decoded.role !== 'ADMIN') {
    const [locked, revoked] = await redisClient.mget(`locked_user:${decoded.id}`, `revoked_session:${decoded.sid}`);
    if (locked) {
        res.status(403).json({ status: 'ERR', message: 'Tài khoản đã bị khóa.' });
        return;
    }
    if (revoked) {
        res.status(401).json({ status: 'ERR', message: 'Phiên đăng nhập đã bị thu hồi.' });
        return;
    }
} next(); };
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => { if (req.userRole !== 'ADMIN') {
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền quản trị thông báo.' });
    return;
} next(); };

