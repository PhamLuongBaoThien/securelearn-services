// File này khai báo route document asset.
// Document hiện dùng flow upload một bước.
import { Router } from 'express';
import documentAssetController from '../controllers/documentAsset.controller';
import { upload } from '../middlewares/upload.middleware';

const router = Router();

router.post('/upload', upload.single('file'), documentAssetController.uploadDocument);
router.get('/:documentAssetId', documentAssetController.getAsset);

export default router;
