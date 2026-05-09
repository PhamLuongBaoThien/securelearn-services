// File này chứa flow upload và xử lý video của media-service.
// Flow hiện tại:
// 1. initiate upload
// 2. complete upload nhận file thật
// 3. xử lý HLS nền
// 4. publish READY/FAILED qua RabbitMQ
import fs from 'fs';
import path from 'path';
import { processVideoToHLS } from './videoProcessor';
import { VideoAsset, VideoAssetStatus } from '../models/videoAsset.model';
import { publishVideoFailed, publishVideoReady } from '../events/publishers';

const MEDIA_ROOT = path.resolve(process.cwd(), 'tmp-media');

class VideoAssetService {
  public async initiateUpload(data: { ownerUserId: string; courseId: string; lessonId: string }) {
    const asset = await VideoAsset.create({
      ownerUserId: data.ownerUserId,
      courseId: data.courseId,
      lessonId: data.lessonId,
      status: VideoAssetStatus.INITIATED,
      processingProgress: 0,
    });

    return {
      _id: asset._id.toString(),
      status: asset.status,
      uploadMode: 'multipart-direct', //multipart-direct là cách thức upload video mà client sẽ tự upload file lên storage, ko thông qua backend. ngược lại là signed-url mà client sẽ upload thông qua backend, backend sẽ nhận file từ client rùi đẩy lên storage. uploadMode sẽ thay đổi trong tương lai khi ta muốn sử dụng signed-url.
    };
  }

  // Nhận file upload xong rồi đẩy sang background processing.
  public async completeUpload(videoAssetId: string, file: Express.Multer.File) {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) throw new Error('Video asset không tồn tại.');

    // tạo thư mục để lưu video
    const assetDir = path.join(MEDIA_ROOT, 'videos', asset._id.toString()); // nghĩa là tạo ra các thư mục lồng nhau
    fs.mkdirSync(assetDir, { recursive: true }); // recursive: true nghĩa là tạo ra các thư mục lồng nhau nếu chưa có

    const rawFilePath = path.join(assetDir, file.originalname); // nghĩa là nối đường dẫn
    const rawObjectKey = path.posix.join('courses', asset.courseId, 'lessons', asset.lessonId, 'videos', asset._id.toString(), file.originalname);
    fs.renameSync(file.path, rawFilePath); // nghĩa là di chuyển file từ nơi lưu tạm thời sang nơi lưu chính

    asset.originalFileName = file.originalname; // nghĩa là lưu tên file gốc
    asset.mimeType = file.mimetype; // nghĩa là lưu loại file
    asset.sizeBytes = file.size; // nghĩa là lưu kích thước file
    asset.rawObjectKey = rawObjectKey; // khóa object logical để map về storage contract
    asset.rawFilePath = rawFilePath; // nghĩa là lưu đường dẫn file gốc
    asset.status = VideoAssetStatus.PROCESSING; // nghĩa là lưu trạng thái xử lý
    asset.processingProgress = 10; // nghĩa là lưu tiến độ xử lý, lý do 10% là do 90% còn lại dành cho việc xử lý video sau khi hoàn tất upload.
    asset.errorMessage = null; // nghĩa là lưu thông báo lỗi
    await asset.save(); // nghĩa là lưu vào database

    void this.processVideoInBackground(asset._id.toString());

    return asset;
  }

  public async getAsset(videoAssetId: string) {
    const asset = await VideoAsset.findById(videoAssetId).lean();
    if (!asset) throw new Error('Video asset không tồn tại.');
    return asset;
  }

  // Xử lý video nền và bắn event để course-service cập nhật lesson.status.
  private async processVideoInBackground(videoAssetId: string): Promise<void> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) return;

    try {
      const outputDir = path.join(MEDIA_ROOT, 'videos', asset._id.toString(), 'hls'); // nghĩa là tạo ra các thư mục lồng nhau, hls là thư mục chứa các file hls.
      const manifestPath = await processVideoToHLS(asset.rawFilePath, outputDir, asset._id.toString()); // nghĩa là xử lý video sang định dạng hls.
      const manifestKey = path.posix.join('courses', asset.courseId, 'lessons', asset.lessonId, 'videos', asset._id.toString(), 'hls', 'master.m3u8');

      asset.manifestKey = manifestKey; // khóa object logical của manifest
      asset.manifestPath = manifestPath; // nghĩa là lưu đường dẫn file hls
      asset.processingProgress = 100; // nghĩa là lưu tiến độ xử lý
      asset.status = VideoAssetStatus.READY; // nghĩa là lưu trạng thái xử lý
      asset.durationSec = asset.durationSec || 0; // nghĩa là lưu thời lượng video
      await asset.save();

      await publishVideoReady({
        videoAssetId: asset._id.toString(),
        lessonId: asset.lessonId,
        status: 'READY',
        duration: asset.durationSec,
        manifestPath: asset.manifestPath,
      });
    } catch (error: any) {
      asset.status = VideoAssetStatus.FAILED;
      asset.processingProgress = 0;
      asset.errorMessage = error.message;
      await asset.save();

      await publishVideoFailed({
        videoAssetId: asset._id.toString(),
        lessonId: asset.lessonId,
        status: 'FAILED',
        errorMessage: error.message,
      });
    }
  }
}

export default new VideoAssetService();
