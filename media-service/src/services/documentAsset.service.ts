// File này chứa flow upload document asset.
// Lưu ý:
// - document hiện đơn giản hơn video, chưa có bước xử lý hậu kỳ riêng
// - upload xong là đánh READY, sau đó frontend bind trực tiếp vào lesson
import fs from 'fs';
import path from 'path';
import { DocumentAsset, DocumentAssetStatus } from '../models/documentAsset.model';

const MEDIA_ROOT = path.resolve(process.cwd(), 'tmp-media');

class DocumentAssetService {
  // Upload document một bước: lưu file và tạo asset READY.
  public async uploadDocument(
    data: { ownerUserId: string; courseId: string; lessonId: string },
    file: Express.Multer.File // Express.Multer.File là kiểu dữ liệu của file được upload qua multer
  ) {
    const assetDir = path.join(MEDIA_ROOT, 'documents', data.lessonId);
    fs.mkdirSync(assetDir, { recursive: true });

    const filePath = path.join(assetDir, file.originalname); // file.path là đường dẫn tạm thời, file.originalname là tên file gốc
    const objectKey = path.posix.join('courses', data.courseId, 'lessons', data.lessonId, 'documents', file.originalname);
    fs.renameSync(file.path, filePath); // tức là rename file.path thành filePath

    const asset = await DocumentAsset.create({
      ownerUserId: data.ownerUserId,
      courseId: data.courseId,
      lessonId: data.lessonId,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      pageCount: 0,
      objectKey,
      filePath,
      status: DocumentAssetStatus.READY,
    });

    return asset;
  }

  public async getAsset(documentAssetId: string) {
    const asset = await DocumentAsset.findById(documentAssetId).lean();
    if (!asset) throw new Error('Document asset không tồn tại.');
    return asset;
  }
}

export default new DocumentAssetService();
