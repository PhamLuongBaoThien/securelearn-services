// [BƯỚC 2.2: MIDDLEWARE KIỂM DUYỆT QUYỀN TRUY CẬP (ENTITLEMENT CHECK)]
// Cổng kiểm duyệt xem learner có quyền học khóa học chứa tài nguyên (video/document) này hay không.
// Tích hợp cache Redis (entitlementCacheService) và giao tiếp gRPC sang course-service.
import { NextFunction, Response } from 'express';
import { AuthRequest } from './auth.middleware';
import { courseGrpcClient } from '../grpc/course.client';
import entitlementCacheService from '../services/entitlementCache.service';

export const verifyCourseEntitlement = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  asset: { ownerUserId: string; courseId: string; isAttached: boolean; status: string } | null
): Promise<void> => {
  // Cổng bảo vệ tài nguyên media cho learner.
  // media-service không tự quyết định ai được xem video mà hỏi quyền học qua cache Redis hoặc gRPC course-service.
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

  const cached = await entitlementCacheService.get(req.userId, asset.courseId);
  if (cached) {
    if (cached.allowed) {
      next();
      return;
    }
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
    return;
  }

  try {
    const access = await courseGrpcClient.checkCourseEntitlement({
      userId: req.userId,
      courseId: asset.courseId,
    });
    if (access.allowed) {
      await entitlementCacheService.set(req.userId, asset.courseId, {
        allowed: true,
        source: access.source as 'PURCHASE' | 'SUBSCRIPTION' | undefined,
        termId: access.termId,
        accessEndsAt: access.accessEndsAt ? new Date(access.accessEndsAt) : null,
        cachedAt: new Date().toISOString(),
      });
      next();
      return;
    }
    await entitlementCacheService.set(req.userId, asset.courseId, {
      allowed: false,
      reason: access.reason || 'NOT_ENTITLED',
      cachedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[MediaEntitlement] Không thể kiểm tra quyền học qua gRPC:', error);
  }
  res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
};
