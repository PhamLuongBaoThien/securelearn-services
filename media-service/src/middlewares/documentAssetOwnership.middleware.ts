import { NextFunction, Response } from 'express';
import { DocumentAsset } from '../models/documentAsset.model';
import { AuthRequest } from './auth.middleware';

// Dùng cho route có :documentAssetId trước khi controller chạy.
// Tác dụng: user chỉ được đọc metadata tài liệu do chính họ upload.
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
