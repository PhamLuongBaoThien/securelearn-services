// ========================
// Asset Entitlement Middleware
// Mục đích:
// - cho owner hoặc learner có entitlement hợp lệ đọc asset học tập
// - nối media-service với course-service để kiểm tra quyền học tập trung
// ========================
import { NextFunction, Response } from 'express';
import { AuthRequest } from './auth.middleware';

const courseServiceUrl = process.env.COURSE_SERVICE_URL || 'http://course-service:5002';

export const verifyCourseEntitlement = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  asset: { ownerUserId: string; courseId: string; isAttached: boolean; status: string } | null
): Promise<void> => {
  if (!asset || !req.userId) {
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
    return;
  }
  if (asset.ownerUserId === req.userId || req.userRole === 'ADMIN') {
    next();
    return;
  }
  if (!asset.isAttached || asset.status !== 'READY') {
    res.status(403).json({ status: 'ERR', message: 'Tài nguyên chưa sẵn sàng để học.' });
    return;
  }
  const authorization = req.header('Authorization');
  try {
    const response = await fetch(`${courseServiceUrl}/api/courses/${asset.courseId}/entitlement`, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    const data = await response.json() as { data?: { allowed?: boolean } };
    if (response.ok && data.data?.allowed) {
      next();
      return;
    }
  } catch (error) {
    console.warn('[MediaEntitlement] Không thể kiểm tra quyền học:', error);
  }
  res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
};
