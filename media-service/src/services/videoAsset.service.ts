// LUỒNG VIDEO ĐƯỢC TÁCH THÀNH HAI GIAI ĐOẠN:
//
// GIAI ĐOẠN 1 - NHẬN TỆP GỐC:
// - initiateUpload (POST /api/media/videos/initiate-upload) kiểm tra metadata, tạo VideoAsset
//   và khởi tạo Multipart Upload trên Cloudflare R2.
// - getBatchPartPresignedUrls (GET .../batch-part-urls) cấp URL có chữ ký để trình duyệt
//   PUT từng part trực tiếp lên R2; Media Service không nhận byte của file video.
// - confirmUpload (POST .../confirm-upload) nhận PartNumber/ETag, yêu cầu R2 ghép các part,
//   kiểm tra object gốc tồn tại rồi lưu trạng thái QUEUED trong Media DB.
//
// GIAI ĐOẠN 2 - XỬ LÝ NỀN:
// - Worker nội bộ Media Service lấy job QUEUED từ MongoDB, không lấy job mã hóa từ RabbitMQ.
// - Worker tải object gốc từ R2, dùng FFprobe xác minh file, FFmpeg tạo HLS đa chất lượng
//   mã hóa AES-128, rồi tải master/playlist/segment lên lại R2.
// - Khi hoàn tất, VideoAsset thành READY hoặc FAILED và RabbitMQ chỉ phát sự kiện kết quả
//   để Course Service đồng bộ trạng thái Lesson.
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
// Giới hạn số PutObject đồng thời để tránh làm nghẽn kết nối tới R2 khi tải nhiều segment HLS.
const HLS_UPLOAD_CONCURRENCY = Math.max(
  1,
  Math.min(10, Number.parseInt(process.env.HLS_UPLOAD_CONCURRENCY || '5', 10) || 5),
);
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
// Giới hạn mỗi video ở mức 2 GiB để phù hợp tài nguyên xử lý của môi trường hiện tại.
// Giá trị này được kiểm tra khi khởi tạo upload và kiểm tra lại trên file thực tế trước khi xử lý.
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
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

/** Lấy phần mở rộng để kiểm tra đồng thời MIME type và tên tệp ngay khi khởi tạo upload. */
const getVideoExtension = (fileName: string): string =>
  fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

/** Loại bỏ ký tự điều khiển/đường dẫn khỏi tên tệp trước khi ghép vào Object Key trên R2. */
const sanitizeFileName = (fileName: string): string => {
  const safeName = fileName
    .replace(/[\\/]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return safeName.slice(0, MAX_SAFE_FILE_NAME_LENGTH);
};

/** Chuẩn hóa đường dẫn Windows thành Object Key dùng dấu gạch chéo của R2. */
const toPosixPath = (value: string) => value.replace(/\\/g, '/');

class VideoAssetService {
  private activeProcessingJobs = 0;
  private isClaimingJobs = false;
  private processingWorkerTimer: NodeJS.Timeout | null = null;
  private processingWorkerStopping = false;

  /** Công khai TTL của URL phân đoạn để controller trả đúng thời hạn cho Frontend. */
  public get playbackSegmentUrlTtlSeconds(): number {
    return PLAYBACK_SEGMENT_URL_TTL_SECONDS;
  }

  /**
   * Kiểm tra metadata ban đầu, tạo VideoAsset và khởi tạo Multipart Upload trên R2.
   * Hàm chỉ chuẩn bị phiên tải; nội dung video chưa được gửi qua Media Service ở bước này.
   * @returns Mã asset, Object Key và Multipart Upload ID để tiếp tục tải từng part.
   */
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

  /**
   * Cấp một Presigned URL cho mỗi PartNumber để trình duyệt PUT trực tiếp các part lên R2.
   * @param videoAssetId Asset sở hữu multipart session.
   * @param totalParts Tổng số part mà Frontend đã tính từ kích thước tệp.
   */
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

  /**
   * Hoàn tất giai đoạn tải tệp gốc: sắp xếp PartNumber, ghép các part trên R2,
   * xác minh object tồn tại và chuyển VideoAsset sang QUEUED cho worker xử lý nền.
   * Hàm có tính idempotent đối với asset đã QUEUED, PROCESSING hoặc READY.
   */
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

    // PartNumber xác định thứ tự ghép; ETag chứng minh R2 đã nhận đúng part tương ứng.
    const completedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
    await s3Service.completeMultipartUpload(asset.rawObjectKey, asset.multipartUploadId, completedParts);

    // Chỉ đưa job sang giai đoạn xử lý nền sau khi object video gốc thực sự tồn tại trên R2.
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

  /** Hủy multipart session trên R2 và xóa VideoAsset khi giai đoạn tải tệp gốc chưa hoàn tất. */
  public async abortUpload(videoAssetId: string): Promise<void> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) return;
    if (asset.rawObjectKey && asset.multipartUploadId) {
      await s3Service.abortMultipartUpload(asset.rawObjectKey, asset.multipartUploadId).catch(() => {});
    }
    await VideoAsset.deleteOne({ _id: videoAssetId });
    console.log(`[VideoAssetService] Đã hủy upload session ${videoAssetId}`);
  }

  /** Đọc metadata/trạng thái để Frontend theo dõi tiến độ xử lý nền. */
  public async getAsset(videoAssetId: string) {
    const asset = await VideoAsset.findById(videoAssetId).lean();
    if (!asset) throw new Error(`Video asset không tồn tại khi đọc trạng thái: ${videoAssetId}.`);
    return asset;
  }

  /**
   * Đọc master playlist từ R2 và thay đường dẫn rendition bằng API được bảo vệ
   * của Media Service để người xem không nhận trực tiếp Object Key nội bộ.
   */
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

  /**
   * Tìm playlist của mức chất lượng được yêu cầu rồi viết lại khóa giải mã và
   * các đường dẫn segment thành endpoint có kiểm tra phiên phát.
   */
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

  /**
   * Đọc leaf playlist từ R2, thay URI khóa AES-128 và tạo Segment Ticket cho
   * từng phân đoạn trước khi trả playlist cho hls.js.
   */
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

  /**
   * Xác minh Segment Ticket và Object Key, sau đó tạo Presigned GET URL 15 giây
   * để trình duyệt tải đúng phân đoạn từ R2.
   */
  public async getSegmentRedirectUrl(videoAssetId: string, ticket: string): Promise<string> {
    const objectKey = playbackAccessService.verifySegmentTicket(ticket, videoAssetId);
    if (!objectKey) throw new Error('Segment ticket không hợp lệ hoặc đã hết hạn.');
    const asset = await VideoAsset.findById(videoAssetId).select('_id courseId lessonId status').lean();
    if (!asset || asset.status !== VideoAssetStatus.READY) throw new Error('Video chưa sẵn sàng để phát.');
    const allowedPrefix = `courses/${asset.courseId}/lessons/${asset.lessonId}/videos/${asset._id}/hls/`;
    if (!objectKey.startsWith(allowedPrefix) || objectKey.includes('..')) throw new Error('Đường dẫn segment không hợp lệ.');
    return s3Service.getDownloadPresignedUrl(objectKey, 15);
  }
  /** Trả thông tin tối thiểu để Course Service xác minh asset trước khi gắn vào bài học qua gRPC. */
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

  /** Đánh dấu asset đã được Course Service gắn vào lesson sau sự kiện VIDEO_ASSET_ATTACHED. */
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

  /** Xóa multipart còn dang dở, video gốc và toàn bộ HLS của asset khi không còn được tham chiếu. */
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

  /**
   * Khởi động worker xử lý nền nằm trong Media Service.
   * Hàm phục hồi job bị gián đoạn, tạo bộ hẹn giờ quét MongoDB và xử lý ngay job đang chờ.
   */
  public async startProcessingWorker(): Promise<void> {
    this.processingWorkerStopping = false;

    // Hàng đợi xử lý được lưu bền bằng status của VideoAsset trong MongoDB.
    // Vì vậy Pod khởi động lại có thể đưa các job PROCESSING bị gián đoạn trở về QUEUED.
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

  /** Dừng nhận job mới và hủy bộ hẹn giờ quét hàng đợi khi service chuẩn bị tắt. */
  public stopProcessingWorker(): void {
    this.processingWorkerStopping = true;
    if (this.processingWorkerTimer) {
      clearInterval(this.processingWorkerTimer);
      this.processingWorkerTimer = null;
    }
  }

  /**
   * Lấy nguyên tử các VideoAsset QUEUED cũ nhất cho tới giới hạn encode concurrency.
   * Mỗi slot hoàn tất sẽ gọi lại hàm để nhận job kế tiếp.
   */
  private async pumpProcessingQueue(): Promise<void> {
    if (this.processingWorkerStopping || this.isClaimingJobs) return;
    this.isClaimingJobs = true;

    try {
      while (!this.processingWorkerStopping && this.activeProcessingJobs < VIDEO_ENCODE_CONCURRENCY) {
        // Claim nguyên tử job QUEUED cũ nhất và đổi ngay sang PROCESSING để tránh nhận trùng job.
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

  /**
   * Xử lý một job đã được claim: tải video gốc, xác minh bằng FFprobe, tạo HLS bằng FFmpeg,
   * tải artifact lên R2, cập nhật READY/FAILED và phát kết quả qua RabbitMQ.
   * @param videoAssetId Mã asset đang ở trạng thái PROCESSING.
   */
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
      // Worker tải video gốc từ R2 về thư mục tạm cục bộ vì FFprobe/FFmpeg xử lý theo đường dẫn file.
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
        // FFprobe kiểm tra dữ liệu thật của file thay vì chỉ tin fileName, MIME type do Frontend khai báo.
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

      /** Lưu tiến độ FFmpeg vào MongoDB để Frontend đọc qua API polling. */
      const onProgress = async (percent: number) => {
        await VideoAsset.updateOne(
          { _id: asset._id },
          { $set: { processingProgress: percent } },
        );
      };

      // FFmpeg tạo các rendition phù hợp nguồn, segment khoảng 10 giây, playlist HLS và AES-128 key.
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

      /** Liệt kê đệ quy master playlist, rendition playlist và segment trong thư mục HLS tạm. */
      const listFilesRecursive = (dirPath: string): string[] => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries.flatMap((entry) => {
          const resolved = path.join(dirPath, entry.name);
          if (entry.isDirectory()) return listFilesRecursive(resolved);
          return [resolved];
        });
      };

      const files = listFilesRecursive(outputDir);
      // Đưa các artifact HLS lên R2 theo từng nhóm để giới hạn số request tải lên đồng thời.
      console.log(`[VideoAssetService] Uploading ${files.length} HLS artifacts (concurrency=${HLS_UPLOAD_CONCURRENCY})...`);

      /** Đưa một artifact HLS lên đúng Object Key trên R2 với MIME type tương ứng. */
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

      // Khi HLS đã sẵn sàng, object video gốc không còn cần thiết và được xóa để tiết kiệm lưu trữ.
      await s3Service.deleteFile(asset.rawObjectKey!).catch((cleanupError) => {
        console.error(`[VideoAssetService] Không thể xóa raw video ${asset.rawObjectKey}:`, cleanupError);
      });

      if (fs.existsSync(assetDir)) {
        fs.rmSync(assetDir, { recursive: true, force: true });
      }

      console.log(`[VideoAssetService] Video ${videoAssetId} READY`);

      // RabbitMQ thông báo kết quả để Course Service cập nhật Lesson; không dùng để vận chuyển video.
      await publishVideoReady({
        videoAssetId: asset._id.toString(),
        lessonId: asset.lessonId,
        status: 'READY',
        duration: asset.durationSec,
        manifestKey: asset.manifestKey,
      });
    } catch (error: any) {
      // Giữ video gốc trên R2 khi xử lý thất bại. Lỗi tải artifact HLS có thể chỉ là lỗi mạng
      // tạm thời; nguồn này cần được giữ lại để có thể xử lý lại hoặc phục vụ điều tra lỗi.
      asset.status = VideoAssetStatus.FAILED;
      asset.processingProgress = 0;
      asset.errorMessage = error.message;
      asset.availableQualities = [];
      asset.renditions = [];
      await asset.save();

      console.error(`[VideoAssetService] Video ${videoAssetId} FAILED:`, error.message);

      // Nhánh lỗi cũng phát sự kiện để Course Service và Frontend hiển thị trạng thái FAILED.
      await publishVideoFailed({
        videoAssetId: asset._id.toString(),
        lessonId: asset.lessonId,
        status: 'FAILED',
        errorMessage: error.message,
      });
    }
  }

  /** Khởi động lịch dọn VideoAsset không được Course Service gắn vào bài học sau thời gian TTL. */
  public startOrphanCleanupJob(): void {
    setInterval(() => {
      void this.cleanupOrphanedAssets();
    }, ORPHAN_TTL_MS);
  }

  /** Khởi động lịch phát hiện job PROCESSING bị treo quá lâu và chuyển chúng sang FAILED. */
  public startProcessingTimeoutJob(): void {
    setInterval(() => {
      void this.failStuckProcessingAssets();
    }, Math.min(PROCESSING_TIMEOUT_MS, 5 * 60 * 1000));
  }

  /** Tìm các asset quá hạn vẫn isAttached=false và xóa dữ liệu liên quan trên DB/R2. */
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

  /** Đánh dấu job xử lý quá thời hạn là FAILED và phát sự kiện để Course Service cập nhật bài học. */
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

