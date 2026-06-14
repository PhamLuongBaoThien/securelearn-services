// ========================
// Asset Entitlement Middleware
// Mục đích:
// - cho owner hoặc learner có entitlement hợp lệ đọc asset học tập
// - nối media-service với course-service để kiểm tra quyền học tập trung
// ========================
import { NextFunction, Response } from 'express';
import { AuthRequest } from './auth.middleware';
import { courseGrpcClient } from '../grpc/course.client';

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
  try {
    const access = await courseGrpcClient.checkCourseEntitlement({
      userId: req.userId,
      courseId: asset.courseId,
    });
    if (access.allowed) {
      next();
      return;
    }
  } catch (error) {
    console.warn('[MediaEntitlement] Không thể kiểm tra quyền học qua gRPC:', error);
  }
  res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
};
