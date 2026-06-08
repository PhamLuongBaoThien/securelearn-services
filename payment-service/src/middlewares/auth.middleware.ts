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
}

const identityServiceBaseUrl = process.env.IDENTITY_SERVICE_URL || 'http://localhost:5001';

const resolveProfileFromIdentityService = async (token: string): Promise<Partial<Pick<AuthRequest, 'userEmail' | 'userName'>>> => {
  try {
    const response = await fetch(`${identityServiceBaseUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = (await response.json()) as {
      status?: string;
      data?: { email?: string; fullName?: string };
    };

    if (response.ok && data.status === 'OK' && data.data) {
      return {
        userEmail: data.data.email || '',
        userName: data.data.fullName || '',
      };
    }
  } catch (error) {
    console.warn('[PaymentAuth] Không thể lấy profile từ identity-service:', error);
  }

  return {};
};

export const extractUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ status: 'ERR', message: 'Bạn chưa đăng nhập. Vui lòng cung cấp token.' });
    return;
  }

  const decoded = jwt.decode(token) as { id: string; role: string; fullName?: string; email?: string } | null;
  if (!decoded) {
    res.status(401).json({ status: 'ERR', message: 'Token không hợp lệ.' });
    return;
  }

  req.userId = decoded.id;
  req.userRole = decoded.role;
  req.userName = decoded.fullName ?? '';
  req.userEmail = decoded.email ?? '';

  if (!req.userEmail) {
    const profile = await resolveProfileFromIdentityService(token);
    req.userEmail = profile.userEmail ?? '';
    req.userName = req.userName || profile.userName || '';
  }

  if (decoded.role !== 'ADMIN') {
    const isLocked = await redisClient.get(`locked_user:${decoded.id}`);
    if (isLocked) {
      res.status(403).json({ status: 'ERR', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' });
      return;
    }
  }

  next();
};
