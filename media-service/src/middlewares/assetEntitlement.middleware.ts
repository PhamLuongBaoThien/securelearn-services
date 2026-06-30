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
  // [CỔNG KIỂM DUYỆT QUYỀN TRUY CẬP (ENTITLEMENT CHECK)]
  // 1. Phân quyền: Admin hoặc Giảng viên sở hữu (ownerUserId) được truy cập trực tiếp.
  // 2. Trạng thái: Chặn nếu video chưa gắn vào bài học hoặc chưa sẵn sàng (READY).
  // 3. Tách biệt: media-service không quản lý mua khóa học nên phải dùng gRPC hỏi course-service.
  // 4. Redis-First Cache: Kiểm tra Redis trước để tối ưu hiệu năng, nếu miss mới gọi gRPC và cache lại 5 phút.
  
  // Cổng bảo vệ tài nguyên media cho learner.
  // media-service không tự quyết định ai được xem video mà hỏi quyền học qua cache Redis hoặc gRPC course-service.

  // Nếu video không tồn tại hoặc request thiếu userId (chưa đăng nhập)
  if (!asset || !req.userId) {
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
    return;
  }

  // Cho phép Admin hoặc Giảng viên sở hữu (ownerUserId) được truy cập trực tiếp.
  if (asset.ownerUserId === req.userId || req.userRole === 'ADMIN') {
    req.videoAccessMode = 'OWNER_PREVIEW';
    next();
    return;
  }

  // Trạng thái: Chặn nếu video chưa gắn vào bài học hoặc chưa sẵn sàng (READY).
  if (!asset.isAttached || asset.status !== 'READY') {
    res.status(403).json({ status: 'ERR', message: 'Tài nguyên chưa sẵn sàng để học.' });
    return;
  }

  // Đọc từ Redis cache xem cặp (Học viên này + Khóa học này) đã được xác thực quyền xem chưa
  const cached = await entitlementCacheService.get(req.userId, asset.courseId);
  if (cached) {
    if (cached.allowed) {
      req.videoAccessMode = 'LEARNER';
      next(); // Cache ghi nhận: "Đã mua khóa học này" -> Cho qua luôn vào Controller
      return;
    }
    // Cache ghi nhận: "Không có quyền" -> Bỏ qua không gọi gRPC nữa
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
    return;
  }

  try {
    const access = await courseGrpcClient.checkCourseEntitlement({
      userId: req.userId,
      courseId: asset.courseId,
    });
    if (access.allowed) {
      req.videoAccessMode = 'LEARNER';
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
