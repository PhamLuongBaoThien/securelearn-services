// Flow upload video:
// 1. initiateUpload  → tạo DB record, trả về _id
// 2. completeUpload  → nhận file từ frontend qua backend, lưu disk, trigger FFmpeg
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
  /** Bước 1: Khởi tạo asset record trong DB. */
  public async initiateUpload(data: {
    ownerUserId: string;
    courseId: string;
    lessonId: string;
  }) {
    const asset = await VideoAsset.create({
      ownerUserId: data.ownerUserId,
      courseId: data.courseId,
      lessonId: data.lessonId,
      status: VideoAssetStatus.INITIATED,
      processingProgress: 0,
      isAttached: false,
      attachedLessonId: null,
      attachedAt: null,
    });
    return { _id: asset._id.toString() };
  }

  /**
   * Bước 2: Nhận file từ frontend (qua backend), lưu disk, trigger FFmpeg.
   * TODO #4: Khi migrate lên R2, thay bằng presigned URL flow để bỏ qua bước này.
   */
  public async completeUpload(videoAssetId: string, file: Express.Multer.File) {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) throw new Error('Video asset không tồn tại.');

    const assetDir = path.join(MEDIA_ROOT, 'videos', asset._id.toString());
    fs.mkdirSync(assetDir, { recursive: true });

    const rawFilePath = path.join(assetDir, file.originalname);
    fs.renameSync(file.path, rawFilePath);

    asset.originalFileName = file.originalname;
    asset.mimeType = file.mimetype;
    asset.sizeBytes = file.size;
    asset.rawFilePath = rawFilePath;
    asset.status = VideoAssetStatus.PROCESSING;
    asset.processingProgress = 10;
    asset.errorMessage = null;
    await asset.save();

    void this.processVideoInBackground(asset._id.toString());
    return asset;
  }

  public async getAsset(videoAssetId: string) {
    const asset = await VideoAsset.findById(videoAssetId).lean();
    if (!asset) throw new Error('Video asset không tồn tại.');
    return asset;
  }

  public async markAssetAttached(videoAssetId: string, lessonId: string): Promise<void> {
    await VideoAsset.updateOne(
      { _id: videoAssetId },
      {
        $set: {
          isAttached: true,
          attachedLessonId: lessonId,
          attachedAt: new Date(),
        },
      },
    );
  }

  public async deleteAsset(videoAssetId: string): Promise<void> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) return;

    try {
      const s3Folder = `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}`;
      await s3Service.deleteFolder(s3Folder);

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

    try {
      const assetDir = path.join(MEDIA_ROOT, 'videos', asset._id.toString());
      const outputDir = path.join(assetDir, 'hls');

      // #3 — Real progress callback: update DB mỗi khi FFmpeg báo cáo ~5%
      const onProgress = async (percent: number) => {
        await VideoAsset.updateOne(
          { _id: asset._id },
          { $set: { processingProgress: percent } },
        );
      };

      // #1 — FFmpeg: tự probe codec, copy nếu H.264, ngược lại encode ultrafast
      const { encryptionKeyHex, durationSec } = await processVideoToHLS(
        asset.rawFilePath,
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
        await s3Service.uploadFile(filePath, objectKey, mimeType, true);
      };

      for (let i = 0; i < files.length; i += HLS_UPLOAD_CONCURRENCY) {
        await Promise.all(files.slice(i, i + HLS_UPLOAD_CONCURRENCY).map(uploadSegment));
      }

      // Cập nhật DB → READY
      const manifestFileName = `${asset._id.toString()}_playlist.m3u8`;
      const manifestKey = `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}/hls/${manifestFileName}`;
      asset.manifestKey = manifestKey;
      asset.manifestPath = s3Service.getFileUrl(manifestKey);
      asset.processingProgress = 100;
      asset.status = VideoAssetStatus.READY;
      asset.durationSec = durationSec;
      await asset.save();

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
        manifestPath: asset.manifestPath,
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
