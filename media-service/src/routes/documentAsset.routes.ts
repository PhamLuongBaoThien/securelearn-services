// File này khai báo route document asset.
// Document dùng flow upload một bước.
import { Router } from 'express';
import documentAssetController from '../controllers/documentAsset.controller';
import { uploadDocument } from '../middlewares/upload.middleware';
import { requireDocumentAssetOwner } from '../middlewares/documentAssetOwnership.middleware';

const router = Router();

router.post('/upload', uploadDocument.single('file'), documentAssetController.uploadDocument);
router.get('/:documentAssetId', requireDocumentAssetOwner, documentAssetController.getAsset);

export default router;
