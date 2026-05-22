// Flow upload video:
// 1. initiateUpload  → tạo DB record + multipart session
// 2. confirmUpload   → complete multipart trên storage, trigger FFmpeg
// 3. processVideoInBackground (async):
//    #1 — FFmpeg probe codec → copy hoặc encode ultrafast
//    #3 — Cập nhật progress thực vào DB mỗi 5%
//    #2 — Upload HLS segments song song lên storage
import fs from 'fs';
import path from 'path';
import { processVideoToHLS } from './videoProcessor';
import { VideoAsset, VideoAssetStatus } from '../models/videoAsset.model';
import { publishVideoFailed, publishVideoReady } from '../events/publishers';
import s3Service from './s3.service';

const MEDIA_ROOT = path.resolve(process.cwd(), 'tmp-media');
const ORPHAN_TTL_MS = Number(process.env.MEDIA_ORPHAN_TTL_MS || 30 * 60 * 1000);
const PROCESSING_TIMEOUT_MS = Number(process.env.MEDIA_PROCESSING_TIMEOUT_MS || 45 * 60 * 1000);
// #2 — Tăng lên 20 khi migrate lên Cloudflare R2
const HLS_UPLOAD_CONCURRENCY = Number(process.env.HLS_UPLOAD_CONCURRENCY || 10);

class VideoAssetService {
  /**
   * Bước 1: Khởi tạo asset record + tạo multipart upload session trên MinIO.
   * Trả về presigned info để FE upload thẳng lên storage, không qua backend.
   */
  public async initiateUpload(data: {
    ownerUserId: string;
    courseId: string;
    lessonId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    const asset = await VideoAsset.create({
      ownerUserId: data.ownerUserId,
      courseId: data.courseId,
      lessonId: data.lessonId,
      originalFileName: data.fileName,
      mimeType: data.mimeType,
      sourceSizeBytes: data.sizeBytes,
      status: VideoAssetStatus.UPLOADING, // upload multipart đang diễn ra
      processingProgress: 0,
      isAttached: false,
    });

    //object key là đường dẫn logic để lưu file trên storage, không phải URL hay file path thực tế
    const rawObjectKey = `videos/raw/${asset._id}/${Date.now()}_${data.fileName}`; // objectKey tạm cho file gốc khi upload, sẽ xóa sau khi xử lý xong
    asset.rawObjectKey = rawObjectKey;
    const multipartUploadId = await s3Service.createMultipartUpload(rawObjectKey, data.mimeType); // Tạo multipart upload session trên MinIO, trả về uploadId để FE upload từng part sau đó confirm hoàn tất
    asset.multipartUploadId = multipartUploadId;

    await asset.save();

    return {
      _id: asset._id.toString(),
      rawObjectKey,
      multipartUploadId,
    };
  }

  /**
   * Lấy tất cả presigned URLs cho toàn bộ parts trong 1 lần gọi — giảm N API calls xuống 1.
   * FE sẽ dùng batch này để cải thiện tốc độ upload.
   */
  public async getBatchPartPresignedUrls(videoAssetId: string, totalParts: number): Promise<string[]> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) throw new Error(`Video asset không tồn tại khi lấy batch part-urls: ${videoAssetId}.`);
    if (!asset.rawObjectKey || !asset.multipartUploadId) {
      throw new Error('Upload session không hợp lệ hoặc đã kết thúc.');
    }
    // Sinh tất cả presigned URLs song song
    const urls = await Promise.all(
      Array.from({ length: totalParts }, (_, i) =>
        s3Service.getPartPresignedUrl(asset.rawObjectKey!, asset.multipartUploadId!, i + 1)
      )
    );
    return urls;
  }

  /**
   * Xác nhận tất cả parts đã upload xong, complete multipart trên MinIO,
   * kiểm tra object tồn tại rồi trigger FFmpeg processing.
   */
  public async confirmUpload(
    videoAssetId: string,
    parts: { ETag: string; PartNumber: number }[],
  ) {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) throw new Error(`Video asset không tồn tại khi confirm upload: ${videoAssetId}.`);
    if (asset.status === VideoAssetStatus.UPLOADED) {
      void this.processVideoInBackground(asset._id.toString());
      return asset;
    }
    if ([VideoAssetStatus.PROCESSING, VideoAssetStatus.READY].includes(asset.status)) {
      return asset;
    }
    if (!asset.rawObjectKey || !asset.multipartUploadId) {
      throw new Error('Upload session không hợp lệ.');
    }

    // S3 yêu cầu danh sách parts đúng thứ tự tăng dần theo PartNumber.
    const completedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
    await s3Service.completeMultipartUpload(asset.rawObjectKey, asset.multipartUploadId, completedParts);

    const exists = await s3Service.objectExists(asset.rawObjectKey);
    if (!exists) throw new Error('File không tìm thấy trên storage sau khi complete.');

    asset.status = VideoAssetStatus.UPLOADED;
    asset.uploadCompletedAt = new Date();
    asset.multipartUploadId = null;
    asset.processingProgress = 5;
    await asset.save();

    void this.processVideoInBackground(asset._id.toString());
    return asset;
  }

  /** Hủy multipart upload session khi user cancel. */
  public async abortUpload(videoAssetId: string): Promise<void> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) return;
    if (asset.rawObjectKey && asset.multipartUploadId) {
      await s3Service.abortMultipartUpload(asset.rawObjectKey, asset.multipartUploadId).catch(() => {});
    }
    await VideoAsset.deleteOne({ _id: videoAssetId });
    console.log(`[VideoAssetService] Đã hủy upload session ${videoAssetId}`);
  }

  public async getAsset(videoAssetId: string) {
    const asset = await VideoAsset.findById(videoAssetId).select('-attachedLessonId -attachedAt').lean();
    if (!asset) throw new Error(`Video asset không tồn tại khi đọc trạng thái: ${videoAssetId}.`);
    return {
      ...asset,
      manifestPath: asset.manifestKey ? s3Service.getFileUrl(asset.manifestKey) : undefined,
    };
  }

  public async markAssetAttached(videoAssetId: string, _lessonId: string): Promise<void> {
    await VideoAsset.updateOne(
      { _id: videoAssetId },
      {
        $set: {
          isAttached: true,
        },
        $unset: {
          attachedLessonId: '',
          attachedAt: '',
        },
      },
    );
  }

  public async deleteAsset(videoAssetId: string): Promise<void> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) return;

    try {
      // Abort multipart session nếu còn treo (tránh để garbage trên MinIO)
      if (asset.rawObjectKey && asset.multipartUploadId) {
        await s3Service.abortMultipartUpload(asset.rawObjectKey, asset.multipartUploadId).catch(() => {});
      }

      // Xóa raw video (videos/raw/<assetId>/...)
      if (asset.rawObjectKey) {
        const rawPrefix = `videos/raw/${asset._id}/`;
        await s3Service.deleteFolder(rawPrefix).catch(() => {});
      }

      // Xóa HLS segments (courses/<courseId>/lessons/<lessonId>/videos/<assetId>/...)
      const hlsFolder = `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}`;
      await s3Service.deleteFolder(hlsFolder);

      // Xóa file local temp nếu còn sót
      const assetDir = path.join(MEDIA_ROOT, 'videos', asset._id.toString());
      if (fs.existsSync(assetDir)) {
        fs.rmSync(assetDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error(`[VideoAssetService] Lỗi khi xoá file vật lý cho asset ${videoAssetId}:`, error);
    }

    await VideoAsset.deleteOne({ _id: videoAssetId });
    console.log(`[VideoAssetService] Đã xoá video asset ${videoAssetId}`);
  }

  /**
   * Xử lý video ở background:
   * #1 — FFmpeg probe codec → copy (nhanh) hoặc encode ultrafast
   * #3 — Cập nhật processingProgress vào DB mỗi 5%
   * #2 — Upload HLS segments song song (batch ${HLS_UPLOAD_CONCURRENCY})
   */
  private async processVideoInBackground(videoAssetId: string): Promise<void> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) return;
    if (asset.status === VideoAssetStatus.PROCESSING || asset.status === VideoAssetStatus.READY) {
      console.log(`[VideoAssetService] Bỏ qua xử lý lại video ${videoAssetId} vì status=${asset.status}`);
      return;
    }

    try {
      const assetDir = path.join(MEDIA_ROOT, 'videos', asset._id.toString());
      fs.mkdirSync(assetDir, { recursive: true });
      const outputDir = path.join(assetDir, 'hls');

      if (!asset.rawObjectKey) {
        throw new Error('Không tìm thấy file video để xử lý.');
      }
      const rawFilePath = path.join(assetDir, 'raw_input');
      console.log(`[VideoAssetService] Downloading raw video từ storage: ${asset.rawObjectKey}`);
      await s3Service.downloadFile(asset.rawObjectKey, rawFilePath);

      // Đánh dấu PROCESSING ngay khi bắt đầu FFmpeg
      asset.status = VideoAssetStatus.PROCESSING;
      await asset.save();

      // #3 — Real progress callback: update DB mỗi khi FFmpeg báo cáo ~5%
      const onProgress = async (percent: number) => {
        await VideoAsset.updateOne(
          { _id: asset._id },
          { $set: { processingProgress: percent } },
        );
      };

      // #1 — FFmpeg: tự probe codec, copy nếu H.264, ngược lại encode ultrafast
      const { encryptionKeyHex, durationSec } = await processVideoToHLS(
        rawFilePath,
        outputDir,
        asset._id.toString(),
        onProgress,
      );

      asset.encryptionKey = encryptionKeyHex;

      // #2 — Upload HLS segments song song theo batch
      const files = fs.readdirSync(outputDir);
      console.log(
        `[VideoAssetService] Uploading ${files.length} HLS segments (concurrency=${HLS_UPLOAD_CONCURRENCY})...`,
      );

      const uploadSegment = async (file: string) => {
        const filePath = path.join(outputDir, file);
        const objectKey = `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}/hls/${file}`;
        const mimeType = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';
        await s3Service.uploadFile(filePath, objectKey, mimeType);
      };

      for (let i = 0; i < files.length; i += HLS_UPLOAD_CONCURRENCY) {
        await Promise.all(files.slice(i, i + HLS_UPLOAD_CONCURRENCY).map(uploadSegment));
      }

      // Cập nhật DB → READY
      const manifestFileName = `${asset._id.toString()}_playlist.m3u8`;
      const manifestKey = `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}/hls/${manifestFileName}`;
      asset.manifestKey = manifestKey;
      asset.processingProgress = 100;
      asset.status = VideoAssetStatus.READY;
      asset.durationSec = durationSec;
      await asset.save();

      // Raw video chỉ là file tạm cho pipeline encode.
      // Sau khi HLS đã upload xong và asset READY, xóa raw để tránh tốn storage/R2.
      await s3Service.deleteFile(asset.rawObjectKey!).catch((cleanupError) => {
        console.error(`[VideoAssetService] Không thể xóa raw video ${asset.rawObjectKey}:`, cleanupError);
      });

      // Dọn dẹp file local temp
      if (fs.existsSync(assetDir)) {
        fs.rmSync(assetDir, { recursive: true, force: true });
      }

      console.log(`[VideoAssetService] Video ${videoAssetId} READY`);

      await publishVideoReady({
        videoAssetId: asset._id.toString(),
        lessonId: asset.lessonId,
        status: 'READY',
        duration: asset.durationSec,
        manifestKey: asset.manifestKey,
      });
    } catch (error: any) {
      asset.status = VideoAssetStatus.FAILED;
      asset.processingProgress = 0;
      asset.errorMessage = error.message;
      await asset.save();

      console.error(`[VideoAssetService] Video ${videoAssetId} FAILED:`, error.message);

      await publishVideoFailed({
        videoAssetId: asset._id.toString(),
        lessonId: asset.lessonId,
        status: 'FAILED',
        errorMessage: error.message,
      });
    }
  }

  public startOrphanCleanupJob(): void {
    setInterval(() => {
      void this.cleanupOrphanedAssets();
    }, ORPHAN_TTL_MS);
  }

  public startProcessingTimeoutJob(): void {
    setInterval(() => {
      void this.failStuckProcessingAssets();
    }, Math.min(PROCESSING_TIMEOUT_MS, 5 * 60 * 1000));
  }

  private async cleanupOrphanedAssets(): Promise<void> {
    const cutoff = new Date(Date.now() - ORPHAN_TTL_MS);
    const staleAssets = await VideoAsset.find({
      isAttached: false,
      updatedAt: { $lt: cutoff },
      status: {
        $in: [
          VideoAssetStatus.INITIATED,
          VideoAssetStatus.UPLOADING,  // upload multipart dở dang
          VideoAssetStatus.UPLOADED,   // upload xong nhưng không confirm
          VideoAssetStatus.READY,
          VideoAssetStatus.FAILED,
        ],
      },
    })
      .select('_id')
      .lean();

    for (const asset of staleAssets) {
      console.log(`[VideoAssetService] Dọn video asset mồ côi ${asset._id.toString()}`);
      await this.deleteAsset(asset._id.toString());
    }
  }

  private async failStuckProcessingAssets(): Promise<void> {
    const cutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
    const stuckAssets = await VideoAsset.find({
      status: VideoAssetStatus.PROCESSING,
      updatedAt: { $lt: cutoff },
    });

    for (const asset of stuckAssets) {
      asset.status = VideoAssetStatus.FAILED;
      asset.errorMessage = 'Video processing timeout.';
      await asset.save();

      console.error(`[VideoAssetService] Video ${asset._id.toString()} bị timeout trong trạng thái PROCESSING`);

      await publishVideoFailed({
        videoAssetId: asset._id.toString(),
        lessonId: asset.lessonId,
        status: 'FAILED',
        errorMessage: asset.errorMessage,
      });
    }
  }
}

export default new VideoAssetService();
