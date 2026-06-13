// ========================
// Document Asset Access Middleware
// Mục đích:
// - bảo vệ route document asset theo owner hoặc entitlement học tập
// - giữ logic truy cập attachment đồng nhất với video asset trong flow thuê bao
// ========================
import { NextFunction, Response } from 'express';
import { DocumentAsset } from '../models/documentAsset.model';
import { AuthRequest } from './auth.middleware';
import { verifyCourseEntitlement } from './assetEntitlement.middleware';

export const requireDocumentAssetOwner = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const documentAssetId = req.params.documentAssetId as string | undefined;
  if (!documentAssetId || !req.userId) {
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
    return;
  }

  const asset = await DocumentAsset.findById(documentAssetId).select('ownerUserId').lean();
  if (!asset || asset.ownerUserId !== req.userId) {
    res.status(403).json({ status: 'ERR', message: 'Bạn không có quyền truy cập tài nguyên này.' });
    return;
  }

  next();
};

export const requireDocumentAssetAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const documentAssetId = req.params.documentAssetId as string | undefined;
  const asset = documentAssetId
    ? await DocumentAsset.findById(documentAssetId).select('ownerUserId courseId isAttached status').lean()
    : null;
  // Attachment cũng đi qua entitlement để subscription learner đọc được tài liệu hợp lệ.
  await verifyCourseEntitlement(req, res, next, asset);
};
