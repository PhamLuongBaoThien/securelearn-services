// File này là controller cho document asset.
// Flow hiện tại đơn giản hơn video: upload và query trạng thái asset.
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import documentAssetService from '../services/documentAsset.service';

class DocumentAssetController {
  public async uploadDocument(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ status: 'ERR', message: 'Vui lòng tải tài liệu.' });
        return;
      }

      const asset = await documentAssetService.uploadDocument(
        {
          ownerUserId: req.userId!,
          courseId: req.body.courseId,
          lessonId: req.body.lessonId,
        },
        req.file
      );

      res.status(201).json({ status: 'OK', message: 'Tải tài liệu thành công.', data: asset });
    } catch (error: any) {
      res.status(400).json({ status: 'ERR', message: error.message });
    }
  }

  public async getAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const asset = await documentAssetService.getAsset(req.params.documentAssetId as string);
      res.status(200).json({ status: 'OK', data: asset });
    } catch (error: any) {
      res.status(404).json({ status: 'ERR', message: error.message });
    }
  }
}

export default new DocumentAssetController();
