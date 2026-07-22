// Flow upload video:
// 1. initiateUpload: validate sớm, tạo VideoAsset + multipart session.
// 2. getBatchPartPresignedUrls: cấp URL để FE PUT từng chunk lên storage.
// 3. confirmUpload: complete multipart, chuyển sang background processing.
// 4. processVideoInBackground: validate file thật, convert HLS multi-quality, upload segments, publish event.
import fs from 'fs';
import path from 'path';
import { processVideoToHLS, probeVideoMetadata, type ProbedVideoMetadata } from './videoProcessor';
import { VideoAsset, VideoAssetStatus } from '../models/videoAsset.model';
import { publishVideoFailed, publishVideoReady } from '../events/publishers';
import s3Service from './s3.service';
import playbackAccessService from './playbackAccess.service';

const MEDIA_ROOT = path.resolve(process.cwd(), 'tmp-media');
const ORPHAN_TTL_MS = Number(process.env.MEDIA_ORPHAN_TTL_MS || 30 * 60 * 1000);
const PROCESSING_TIMEOUT_MS = Number(process.env.MEDIA_PROCESSING_TIMEOUT_MS || 45 * 60 * 1000);
const HLS_UPLOAD_CONCURRENCY = Number(process.env.HLS_UPLOAD_CONCURRENCY || 10);
const PLAYBACK_SEGMENT_URL_TTL_SECONDS = Number(process.env.PLAYBACK_SEGMENT_URL_TTL_SECONDS || 3600);
const VIDEO_ENCODE_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number.parseInt(process.env.VIDEO_ENCODE_CONCURRENCY || '2', 10) || 2),
);
const VIDEO_QUEUE_POLL_INTERVAL_MS = Math.max(
  500,
  Number.parseInt(process.env.VIDEO_QUEUE_POLL_INTERVAL_MS || '2000', 10) || 2000,
);

const MAX_CONCURRENT_UPLOADS = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;
const ALLOWED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
]);
const ALLOWED_VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm']);
const MAX_SAFE_FILE_NAME_LENGTH = 180;
const PRESIGN_FIXED_EXPIRY = 6 * 3600;

const getVideoExtension = (fileName: string): string =>
  fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

const sanitizeFileName = (fileName: string): string => {
  const safeName = fileName
    .replace(/[\\/]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return safeName.slice(0, MAX_SAFE_FILE_NAME_LENGTH);
};

const toPosixPath = (value: string) => value.replace(/\\/g, '/');

class VideoAssetService {
  private activeProcessingJobs = 0;
  private isClaimingJobs = false;
  private processingWorkerTimer: NodeJS.Timeout | null = null;
  private processingWorkerStopping = false;

  public get playbackSegmentUrlTtlSeconds(): number {
    return PLAYBACK_SEGMENT_URL_TTL_SECONDS;
  }

  public async initiateUpload(data: {
    ownerUserId: string;
    courseId: string;
    lessonId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    const sizeBytes = Number(data.sizeBytes);
    const fileName = sanitizeFileName(String(data.fileName || ''));
    const mimeType = String(data.mimeType || '').toLowerCase().trim();
    const extension = getVideoExtension(fileName);

    if (!fileName || !mimeType || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new Error('Thông tin file không hợp lệ.');
    }
    if (!ALLOWED_VIDEO_MIME_TYPES.has(mimeType) || !ALLOWED_VIDEO_EXTENSIONS.has(extension)) {
      throw new Error('Định dạng video không được hỗ trợ. Vui lòng chọn MP4, MOV, AVI, MKV hoặc WebM.');
    }
    if (sizeBytes > MAX_FILE_SIZE) {
      throw new Error(`File vượt quá giới hạn ${(MAX_FILE_SIZE / (1024 ** 3)).toFixed(0)}GB cho phép.`);
    }

    const activeUploads = await VideoAsset.countDocuments({
      ownerUserId: data.ownerUserId,
      status: { $in: [VideoAssetStatus.INITIATED, VideoAssetStatus.UPLOADING] },
    });
    if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
      throw new Error(
        `Bạn đang có ${activeUploads} video đang tải lên. ` +
        `Vui lòng chờ hoàn tất trước khi tải thêm (tối đa ${MAX_CONCURRENT_UPLOADS} cùng lúc).`
      );
    }

    const asset = await VideoAsset.create({
      ownerUserId: data.ownerUserId,
      courseId: data.courseId,
      lessonId: data.lessonId,
      originalFileName: fileName,
      mimeType,
      sourceSizeBytes: sizeBytes,
      status: VideoAssetStatus.UPLOADING,
      processingProgress: 0,
      isAttached: false,
      availableQualities: [],
      renditions: [],
    });

    const rawObjectKey = `videos/raw/${asset._id}/${Date.now()}_${fileName}`;
    asset.rawObjectKey = rawObjectKey;
    const multipartUploadId = await s3Service.createMultipartUpload(rawObjectKey, mimeType);
    asset.multipartUploadId = multipartUploadId;
    await asset.save();

    return {
      _id: asset._id.toString(),
      rawObjectKey,
      multipartUploadId,
    };
  }

  public async getBatchPartPresignedUrls(videoAssetId: string, totalParts: number): Promise<string[]> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) throw new Error(`Video asset không tồn tại khi lấy batch part-urls: ${videoAssetId}.`);
    if (!asset.rawObjectKey || !asset.multipartUploadId) {
      throw new Error('Upload session không hợp lệ hoặc đã kết thúc.');
    }

    return Promise.all(
      Array.from({ length: totalParts }, (_, index) =>
        s3Service.getPartPresignedUrl(asset.rawObjectKey!, asset.multipartUploadId!, index + 1, PRESIGN_FIXED_EXPIRY)
      )
    );
  }

  public async confirmUpload(
    videoAssetId: string,
    parts: { ETag: string; PartNumber: number }[],
  ) {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) throw new Error(`Video asset không tồn tại khi confirm upload: ${videoAssetId}.`);
    if (asset.status === VideoAssetStatus.UPLOADED) {
      asset.status = VideoAssetStatus.QUEUED;
      asset.processingProgress = 5;
      await asset.save();
      void this.pumpProcessingQueue();
      return asset;
    }
    if ([VideoAssetStatus.QUEUED, VideoAssetStatus.PROCESSING, VideoAssetStatus.READY].includes(asset.status)) {
      return asset;
    }
    if (!asset.rawObjectKey || !asset.multipartUploadId) {
      throw new Error('Upload session không hợp lệ.');
    }

    const completedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
    await s3Service.completeMultipartUpload(asset.rawObjectKey, asset.multipartUploadId, completedParts);

    const exists = await s3Service.objectExists(asset.rawObjectKey);
    if (!exists) throw new Error('File không tìm thấy trên storage sau khi complete.');

    asset.status = VideoAssetStatus.QUEUED;
    asset.uploadCompletedAt = new Date();
    asset.multipartUploadId = null;
    asset.processingProgress = 5;
    await asset.save();

    void this.pumpProcessingQueue();
    return asset;
  }

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
    const asset = await VideoAsset.findById(videoAssetId).lean();
    if (!asset) throw new Error(`Video asset không tồn tại khi đọc trạng thái: ${videoAssetId}.`);
    return asset;
  }

  public async getPlaybackManifest(videoAssetId: string, keyUri?: string, sessionToken?: string) {
    const asset = await VideoAsset.findById(videoAssetId).lean();
    if (!asset?.manifestKey || asset.status !== 'READY') {
      throw new Error('Video chưa sẵn sàng để phát.');
    }

    if (!sessionToken || !asset.renditions?.length) {
      return this.rewriteLeafManifest(asset.manifestKey, keyUri, videoAssetId, sessionToken || '');
    }

    const masterManifest = await s3Service.getObjectText(asset.manifestKey);
    return masterManifest
      .split(/\r?\n/)
      .map((line) => {
        const value = line.trim();
        if (!value || value.startsWith('#') || /^https?:\/\//i.test(value)) return line;
        const rendition = asset.renditions.find(
          (item) => item.playlistPath === value || item.manifestKey.endsWith(value),
        );
        if (!rendition) return line;
        return `/api/media/videos/${videoAssetId}/manifest?quality=${encodeURIComponent(rendition.quality)}&session=${encodeURIComponent(sessionToken)}`;
      })
      .join('\n');
  }

  public async getRenditionManifest(videoAssetId: string, quality: string, keyUri: string, sessionToken: string) {
    const asset = await VideoAsset.findById(videoAssetId).lean();
    if (!asset?.manifestKey || asset.status !== 'READY') {
      throw new Error('Video chưa sẵn sàng để phát.');
    }

    const rendition = (asset.renditions ?? []).find((item) => item.quality === quality);
    if (!rendition) {
      throw new Error(`Không tìm thấy chất lượng ${quality} cho video.`);
    }

    return this.rewriteLeafManifest(rendition.manifestKey, keyUri, videoAssetId, sessionToken);
  }

  private async rewriteLeafManifest(manifestKey: string, keyUri: string | undefined, videoAssetId: string, sessionToken: string) {
    const manifest = await s3Service.getObjectText(manifestKey);
    const baseKey = manifestKey.slice(0, manifestKey.lastIndexOf('/') + 1);
    return manifest.split(/\r?\n/).map((line) => {
      const value = line.trim();
      if (value.startsWith('#EXT-X-KEY') && keyUri) {
        return line.includes('URI="')
          ? line.replace(/URI="[^"]*"/, `URI="${keyUri}"`)
          : `${line},URI="${keyUri}"`;
      }
      if (!value || value.startsWith('#') || /^https?:\/\//i.test(value) || value.endsWith('.m3u8')) return line;
      const ticket = playbackAccessService.createSegmentTicket(videoAssetId, `${baseKey}${value}`);
      return `/api/media/videos/${videoAssetId}/segment?ticket=${encodeURIComponent(ticket)}&session=${encodeURIComponent(sessionToken)}`;
    }).join('\n');
  }

  public async getSegmentRedirectUrl(videoAssetId: string, ticket: string): Promise<string> {
    const objectKey = playbackAccessService.verifySegmentTicket(ticket, videoAssetId);
    if (!objectKey) throw new Error('Segment ticket không hợp lệ hoặc đã hết hạn.');
    const asset = await VideoAsset.findById(videoAssetId).select('_id courseId lessonId status').lean();
    if (!asset || asset.status !== VideoAssetStatus.READY) throw new Error('Video chưa sẵn sàng để phát.');
    const allowedPrefix = `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}/hls/`;
    if (!objectKey.startsWith(allowedPrefix) || objectKey.includes('..')) throw new Error('Đường dẫn segment không hợp lệ.');
    return s3Service.getDownloadPresignedUrl(objectKey, 15);
  }
  public async getBindingSnapshot(videoAssetId: string) {
    const asset = await VideoAsset.findById(videoAssetId)
      .select('_id ownerUserId courseId lessonId status isAttached')
      .lean();
    if (!asset) return null;
    return {
      assetId: asset._id.toString(),
      ownerUserId: asset.ownerUserId,
      courseId: asset.courseId,
      lessonId: asset.lessonId,
      status: asset.status,
      isAttached: asset.isAttached,
    };
  }

  public async markAssetAttached(videoAssetId: string): Promise<void> {
    await VideoAsset.updateOne(
      { _id: videoAssetId },
      {
        $set: {
          isAttached: true,
        },
      },
    );
  }

  public async deleteAsset(videoAssetId: string): Promise<void> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) return;

    try {
      if (asset.rawObjectKey && asset.multipartUploadId) {
        await s3Service.abortMultipartUpload(asset.rawObjectKey, asset.multipartUploadId).catch(() => {});
      }

      if (asset.rawObjectKey) {
        const rawPrefix = `videos/raw/${asset._id}/`;
        await s3Service.deleteFolder(rawPrefix).catch(() => {});
      }

      const hlsFolder = `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}`;
      await s3Service.deleteFolder(hlsFolder);

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

  public async startProcessingWorker(): Promise<void> {
    this.processingWorkerStopping = false;

    // Với Deployment Recreate và 1 replica, job PROCESSING còn sót lại
    // là job bị gián đoạn khi pod cũ dừng, nên có thể đưa về queue.
    const recovery = await VideoAsset.updateMany(
      { status: VideoAssetStatus.PROCESSING },
      {
        $set: {
          status: VideoAssetStatus.QUEUED,
          processingProgress: 5,
          errorMessage: null,
        },
      },
    );
    if (recovery.modifiedCount > 0) {
      console.log('[VideoProcessingWorker] Đã đưa ' + recovery.modifiedCount + ' job gián đoạn về queue');
    }

    this.processingWorkerTimer = setInterval(() => {
      void this.pumpProcessingQueue();
    }, VIDEO_QUEUE_POLL_INTERVAL_MS);

    console.log(
      '[VideoProcessingWorker] Đã khởi động (concurrency=' + VIDEO_ENCODE_CONCURRENCY +
      ', poll=' + VIDEO_QUEUE_POLL_INTERVAL_MS + 'ms)',
    );
    await this.pumpProcessingQueue();
  }

  public stopProcessingWorker(): void {
    this.processingWorkerStopping = true;
    if (this.processingWorkerTimer) {
      clearInterval(this.processingWorkerTimer);
      this.processingWorkerTimer = null;
    }
  }

  private async pumpProcessingQueue(): Promise<void> {
    if (this.processingWorkerStopping || this.isClaimingJobs) return;
    this.isClaimingJobs = true;

    try {
      while (!this.processingWorkerStopping && this.activeProcessingJobs < VIDEO_ENCODE_CONCURRENCY) {
        const asset = await VideoAsset.findOneAndUpdate(
          { status: VideoAssetStatus.QUEUED },
          {
            $set: {
              status: VideoAssetStatus.PROCESSING,
              processingProgress: 5,
              errorMessage: null,
            },
          },
          { sort: { createdAt: 1 }, new: true },
        );
        if (!asset) break;

        this.activeProcessingJobs += 1;
        const videoAssetId = asset._id.toString();
        console.log(
          '[VideoProcessingWorker] Nhận job ' + videoAssetId +
          ' (' + this.activeProcessingJobs + '/' + VIDEO_ENCODE_CONCURRENCY + ')',
        );

        void this.processClaimedVideo(videoAssetId).finally(() => {
          this.activeProcessingJobs = Math.max(0, this.activeProcessingJobs - 1);
          void this.pumpProcessingQueue();
        });
      }
    } finally {
      this.isClaimingJobs = false;
    }
  }

  private async processClaimedVideo(videoAssetId: string): Promise<void> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) return;
    if (asset.status !== VideoAssetStatus.PROCESSING) {
      console.log('[VideoProcessingWorker] Bỏ qua job ' + videoAssetId + ' vì status=' + asset.status);
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

      const actualSize = fs.statSync(rawFilePath).size;
      const declaredSize = asset.sourceSizeBytes;
      if (declaredSize > 0) {
        const deviation = Math.abs(actualSize - declaredSize) / declaredSize;
        if (deviation > 0.1) {
          throw new Error(
            `Kích thước file thực tế (${(actualSize / 1024 / 1024).toFixed(1)}MB) ` +
            `khác biệt quá lớn so với khai báo (${(declaredSize / 1024 / 1024).toFixed(1)}MB).`
          );
        }
      }

      if (actualSize > MAX_FILE_SIZE) {
        throw new Error(
          `File vượt quá giới hạn ${(MAX_FILE_SIZE / (1024 ** 3)).toFixed(0)}GB cho phép.`
        );
      }

      let probeResult: ProbedVideoMetadata;
      try {
        probeResult = await probeVideoMetadata(rawFilePath);
        if (!probeResult.video) {
          throw new Error('Không tìm thấy video stream trong file.');
        }
        if (probeResult.durationSec <= 0) {
          throw new Error('Video không có thời lượng (duration = 0). File có thể bị hỏng.');
        }
        if (probeResult.width <= 0 || probeResult.height <= 0) {
          throw new Error('Không đọc được độ phân giải của video.');
        }
        console.log(
          `[VideoAssetService] Validation OK: codec=${probeResult.video}/${probeResult.audio}, ` +
          `duration=${probeResult.durationSec}s, size=${(actualSize / 1024 / 1024).toFixed(1)}MB, resolution=${probeResult.width}x${probeResult.height}`
        );
      } catch (probeError: any) {
        console.error(`[VideoAssetService] FFprobe quét lỗi (Có thể do file giả mạo/hỏng): ${probeError.message}`);
        throw new Error('Tệp tải lên bị hỏng, sai định dạng hoặc không phải là một video hợp lệ. Vui lòng kiểm tra lại!');
      }

      const onProgress = async (percent: number) => {
        await VideoAsset.updateOne(
          { _id: asset._id },
          { $set: { processingProgress: percent } },
        );
      };

      const {
        encryptionKeyHex,
        durationSec,
        masterManifestFileName,
        renditions,
        availableQualities,
        sourceWidth,
        sourceHeight,
      } = await processVideoToHLS(
        rawFilePath,
        outputDir,
        asset._id.toString(),
        onProgress,
        probeResult,
      );

      asset.encryptionKey = encryptionKeyHex;

      const listFilesRecursive = (dirPath: string): string[] => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries.flatMap((entry) => {
          const resolved = path.join(dirPath, entry.name);
          if (entry.isDirectory()) return listFilesRecursive(resolved);
          return [resolved];
        });
      };

      const files = listFilesRecursive(outputDir);
      console.log(`[VideoAssetService] Uploading ${files.length} HLS artifacts (concurrency=${HLS_UPLOAD_CONCURRENCY})...`);

      const uploadArtifact = async (filePath: string) => {
        const relativePath = toPosixPath(path.relative(outputDir, filePath));
        const objectKey = `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}/hls/${relativePath}`;
        const mimeType = relativePath.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';
        await s3Service.uploadFile(filePath, objectKey, mimeType);
      };

      for (let index = 0; index < files.length; index += HLS_UPLOAD_CONCURRENCY) {
        await Promise.all(files.slice(index, index + HLS_UPLOAD_CONCURRENCY).map(uploadArtifact));
      }

      const manifestKey = `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}/hls/${masterManifestFileName}`;
      asset.manifestKey = manifestKey;
      asset.processingProgress = 100;
      asset.status = VideoAssetStatus.READY;
      asset.durationSec = durationSec;
      asset.availableQualities = availableQualities;
      asset.sourceWidth = sourceWidth;
      asset.sourceHeight = sourceHeight;
      asset.renditions = renditions.map((rendition) => ({
        quality: rendition.quality,
        width: rendition.width,
        height: rendition.height,
        bandwidth: rendition.bandwidth,
        manifestKey: `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}/hls/${rendition.manifestKeySuffix}`,
        playlistPath: toPosixPath(rendition.manifestOutputPath),
      }));
      await asset.save();

      await s3Service.deleteFile(asset.rawObjectKey!).catch((cleanupError) => {
        console.error(`[VideoAssetService] Không thể xóa raw video ${asset.rawObjectKey}:`, cleanupError);
      });

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
      if (asset.rawObjectKey) {
        await s3Service.deleteFile(asset.rawObjectKey).catch((cleanupErr) => {
          console.error(`[VideoAssetService] Không thể xóa raw file ${asset.rawObjectKey}:`, cleanupErr);
        });
      }

      asset.status = VideoAssetStatus.FAILED;
      asset.processingProgress = 0;
      asset.errorMessage = error.message;
      asset.availableQualities = [];
      asset.renditions = [];
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
          VideoAssetStatus.UPLOADING,
          VideoAssetStatus.UPLOADED,
          VideoAssetStatus.QUEUED,
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

