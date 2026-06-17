// ========================
// Document Asset Routes
// Mục đích:
// - khai báo route upload và đọc attachment tài liệu
// - dùng entitlement middleware để learner hợp lệ tải tài liệu của lesson
// ========================
import { Router } from 'express';
import documentAssetController from '../controllers/documentAsset.controller';
import { uploadDocument } from '../middlewares/upload.middleware';
import { requireDocumentAssetAccess } from '../middlewares/documentAssetOwnership.middleware';

const router = Router();

router.post('/upload', uploadDocument.single('file'), documentAssetController.uploadDocument);
router.post('/:documentAssetId/view-session', requireDocumentAssetAccess, documentAssetController.createViewSession);
router.post('/:documentAssetId/download-session', requireDocumentAssetAccess, documentAssetController.createDownloadSession);
router.get('/:documentAssetId/view', requireDocumentAssetAccess, documentAssetController.viewDocument);
router.get('/:documentAssetId/download', requireDocumentAssetAccess, documentAssetController.downloadDocument);
router.get('/:documentAssetId', requireDocumentAssetAccess, documentAssetController.getAsset);

export default router;
