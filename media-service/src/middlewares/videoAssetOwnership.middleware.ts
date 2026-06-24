// ========================
// Video Asset Access Middleware
// Mục đích:
// - bảo vệ route video asset theo owner hoặc entitlement học tập
// - cho phép learner thuê bao đọc video mà không cần là người upload asset
// ========================
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

// middleware này giúp learner đã có entitlement học đọc manifest/key mà không phải là owner upload của asset.
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
