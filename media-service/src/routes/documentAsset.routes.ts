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

// [POST] /api/media/documents/upload — Nhận tài liệu lesson, kiểm tra tệp và lưu DocumentAsset vào object storage.
router.post('/upload', uploadDocument.single('file'), documentAssetController.uploadDocument);
// [GET] /api/media/documents/:documentAssetId/view — Trả nội dung/URL xem trực tuyến sau khi kiểm tra quyền khóa học.
router.get('/:documentAssetId/view', requireDocumentAssetAccess, documentAssetController.viewDocument);
// [GET] /api/media/documents/:documentAssetId/download — Cấp phản hồi tải tài liệu cho người dùng có entitlement hợp lệ.
router.get('/:documentAssetId/download', requireDocumentAssetAccess, documentAssetController.downloadDocument);
// [GET] /api/media/documents/:documentAssetId — Lấy metadata của tài liệu được phép truy cập.
router.get('/:documentAssetId', requireDocumentAssetAccess, documentAssetController.getAsset);

export default router;
