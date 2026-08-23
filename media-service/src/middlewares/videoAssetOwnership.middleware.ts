// [BƯỚC 2.2: MIDDLEWARE BẢO VỆ TÀI NGUYÊN VIDEO (VIDEO ASSET ACCESS CONTROL)]
// - verify course entitlement cho phép học viên đã thanh toán/đăng ký học được quyền lấy manifest (.m3u8) và giải mã key.
// - requireVideoAssetOwner dành riêng cho Admin/Giảng viên (người upload asset).
import { NextFunction, Response } from 'express';
import { VideoAsset } from '../models/videoAsset.model';
import { AuthRequest } from './auth.middleware';
import { verifyCourseEntitlement } from './assetEntitlement.middleware';

export const requireVideoAssetOwner = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const videoAssetId = req.params.videoAssetId as string | undefined;
  if (!videoAssetId || !req.userId) {
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
    return;
  }

  const asset = await VideoAsset.findById(videoAssetId).select('ownerUserId').lean();
  if (!asset || asset.ownerUserId !== req.userId) {
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
    return;
  }

  next();
};

// middleware này giúp learner đã có entitlement (đã thanh toán hoặc đã đăng ký học khóa học) đọc manifest/key mà không phải là owner upload của video asset.
/**
 * [FLOW HỌC VIDEO - MEDIA.0: CỔNG ENTITLEMENT]
 * Chạy trước playback-session/manifest/key/segment để xác định asset và kiểm tra user có quyền đọc video.
 * Learning Session/Key Session vẫn được kiểm tra sâu hơn trong controller/service tương ứng.
 */
export const requireVideoAssetAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const videoAssetId = req.params.videoAssetId as string | undefined;
  const asset = videoAssetId
    ? await VideoAsset.findById(videoAssetId).select('ownerUserId courseId isAttached status').lean()
    : null;
  // Cho learner đã có entitlement học đọc manifest/key mà không phải là owner upload của asset.
  await verifyCourseEntitlement(req, res, next, asset);
};
