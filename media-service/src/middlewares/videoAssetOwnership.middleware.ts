import { NextFunction, Response } from 'express';
import { VideoAsset } from '../models/videoAsset.model';
import { AuthRequest } from './auth.middleware';

// Dùng cho mọi route có :videoAssetId trước khi controller chạy.
// Tác dụng: đảm bảo user hiện tại là owner của asset, tránh poll/key/confirm/abort asset người khác.
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
