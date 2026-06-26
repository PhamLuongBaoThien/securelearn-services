// Flow upload video:
// 1. initiateUpload: validate sớm, tạo VideoAsset + multipart session.
// 2. getBatchPartPresignedUrls: cấp URL để FE PUT từng chunk lên storage.
// 3. confirmUpload: complete multipart, chuyển sang background processing.
// 4. processVideoInBackground: validate file thật, convert HLS, upload segments, publish event.
import fs from 'fs';
import path from 'path';
import { processVideoToHLS, probeVideoMetadata } from './videoProcessor';
import { VideoAsset, VideoAssetStatus } from '../models/videoAsset.model';
import { publishVideoFailed, publishVideoReady } from '../events/publishers';
import s3Service from './s3.service';
import redisClient from '../config/redis';

const MEDIA_ROOT = path.resolve(process.cwd(), 'tmp-media'); // thư mục tạm để lưu file raw và output HLS trong quá trình xử lý video. Cấu trúc: tmp-media/videos/<assetId>/raw_input, tmp-media/videos/<assetId>/hls/*.ts, *.m3u8 (process.cwd() là thư mục gốc của project, thường là backend/media-service) => đường dẫn tuyệt đối, tránh lỗi khi chạy ở môi trường khác nhau. Sau khi xử lý xong sẽ xóa toàn bộ thư mục này để dọn dẹp file tạm
const ORPHAN_TTL_MS = Number(process.env.MEDIA_ORPHAN_TTL_MS || 30 * 60 * 1000);
const PROCESSING_TIMEOUT_MS = Number(process.env.MEDIA_PROCESSING_TIMEOUT_MS || 45 * 60 * 1000);
// #2 — Tăng lên 20 khi migrate lên Cloudflare R2
const HLS_UPLOAD_CONCURRENCY = Number(process.env.HLS_UPLOAD_CONCURRENCY || 10);
const PLAYBACK_MANIFEST_CACHE_TTL_SECONDS = Number(process.env.PLAYBACK_MANIFEST_CACHE_TTL_SECONDS || 240);
const PLAYBACK_SEGMENT_URL_TTL_SECONDS = Number(process.env.PLAYBACK_SEGMENT_URL_TTL_SECONDS || 3600);
const KEY_URI_PLACEHOLDER = '__SECURELEARN_KEY_URI__';

// ===== GIỚI HẠN BẢO MẬT =====

// Số lượng video tối đa 1 user được upload cùng lúc.
// Ngăn attacker spam tạo hàng trăm multipart session để lấp đầy storage.
// Instructor thông thường upload tuần tự từng bài, nên 3 là đủ.
const MAX_CONCURRENT_UPLOADS = 3;

// Kích thước file video tối đa cho phép (10GB).
// Video khóa học thường 100MB–2GB, 10GB là biên an toàn cho video 4K dài.
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

// Cấu hình thời hạn Presigned URL CỐ ĐỊNH.
// Áp dụng chung một thời hạn đủ lớn (6 tiếng) cho mọi file (dù nhỏ hay to)
// để code đơn giản hơn, đảm bảo người dùng mạng chậm luôn có đủ thời gian upload.
const PRESIGN_FIXED_EXPIRY = 6 * 3600; // 6 giờ (tính bằng giây)

const getVideoExtension = (fileName: string): string =>
  fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

// Dùng trước khi tạo objectKey lưu raw video.
// Tác dụng: tránh path traversal/control chars và giữ object key gọn, an toàn khi lưu trên S3/MinIO/R2.
const sanitizeFileName = (fileName: string): string => {
  const safeName = fileName
    .replace(/[\\/]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return safeName.slice(0, MAX_SAFE_FILE_NAME_LENGTH);
};

class VideoAssetService {
  public get playbackSegmentUrlTtlSeconds(): number {
    return PLAYBACK_SEGMENT_URL_TTL_SECONDS;
  }

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
    // Validation sớm chạy trước khi tạo DB record và multipart session.
    // Tác dụng: reject file sai định dạng/quá lớn ngay từ đầu, không để chiếm upload slot hoặc storage tạm.
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

    // ===== CHỐNG SPAM: Giới hạn số upload đồng thời per user =====
    // Đếm các asset đang ở trạng thái upload (INITIATED hoặc UPLOADING).
    // Nếu user đã có 3 upload đang chạy → từ chối tạo thêm.
    // Mục đích: ngăn attacker dùng 1 account tạo hàng trăm multipart session
    // để chiếm bandwidth và storage trên MinIO.
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
      status: VideoAssetStatus.UPLOADING, // upload multipart đang diễn ra
      processingProgress: 0,
      isAttached: false,
    });

    // objectKey là đường dẫn logic trên storage. Raw file chỉ là đầu vào tạm cho FFmpeg.
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
   * Lấy tất cả presigned URLs cho toàn bộ parts trong 1 lần gọi — giảm N API calls xuống 1.
   * FE sẽ dùng batch này để cải thiện tốc độ upload.
   */
  public async getBatchPartPresignedUrls(videoAssetId: string, totalParts: number): Promise<string[]> {
    const asset = await VideoAsset.findById(videoAssetId);
    if (!asset) throw new Error(`Video asset không tồn tại khi lấy batch part-urls: ${videoAssetId}.`);
    if (!asset.rawObjectKey || !asset.multipartUploadId) { // rawObjectKey là bằng chứng cho thấy multipart session đã được tạo ở bước initiateUpload., multipartUploadId là bằng chứng cho thấy session đó vẫn còn hiệu lực (chưa bị confirm hoặc abort).
      throw new Error('Upload session không hợp lệ hoặc đã kết thúc.');
    }

    // ===== THỜI HẠN PRESIGNED URL CỐ ĐỊNH =====
    // Dùng chung 1 thời hạn cố định, đủ dài để bất kỳ ai dù mạng yếu cũng tải kịp.
    const expiresIn = PRESIGN_FIXED_EXPIRY;

    // Sinh tất cả presigned URLs song song, mỗi URL có cùng thời hạn
    const urls = await Promise.all(
      Array.from({ length: totalParts }, (_, i) =>
        s3Service.getPartPresignedUrl(asset.rawObjectKey!, asset.multipartUploadId!, i + 1, expiresIn)
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
      void this.processVideoInBackground(asset._id.toString()); // Trong trường hợp FE đã gọi confirmUpload nhưng chưa kịp trigger background (ví dụ do lỗi mạng), nếu asset đã ở trạng thái UPLOADED thì vẫn tiếp tục trigger background processing để đảm bảo video được xử lý.
      return asset;
    }
    if ([VideoAssetStatus.PROCESSING, VideoAssetStatus.READY].includes(asset.status)) {
      return asset;
    }
    if (!asset.rawObjectKey || !asset.multipartUploadId) {
      throw new Error('Upload session không hợp lệ.');
    }

    // S3 yêu cầu danh sách parts đúng thứ tự tăng dần theo PartNumber.
    const completedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber); // đảm bảo FE có gửi parts đúng thứ tự, nếu không sẽ bị lỗi khi complete multipart.
    await s3Service.completeMultipartUpload(asset.rawObjectKey, asset.multipartUploadId, completedParts);

    const exists = await s3Service.objectExists(asset.rawObjectKey);
    if (!exists) throw new Error('File không tìm thấy trên storage sau khi complete.');

    asset.status = VideoAssetStatus.UPLOADED;
    asset.uploadCompletedAt = new Date();
    asset.multipartUploadId = null;
    asset.processingProgress = 5; // Đánh dấu 5% ngay khi upload xong, trước khi bắt đầu FFmpeg, để FE có phản hồi nhanh rằng file đã được tải lên thành công.
    await asset.save(); // lúc này asset đã ở trạng thái UPLOADED, sẵn sàng cho bước xử lý video ở background.

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
    const asset = await VideoAsset.findById(videoAssetId).lean();
    if (!asset) throw new Error(`Video asset không tồn tại khi đọc trạng thái: ${videoAssetId}.`);
    return asset;
  }

  // [BẢO MẬT STREAMING - BƯỚC 2.1]
  // Đọc file manifest (.m3u8) từ MinIO và viết lại đường dẫn để ẩn các thông tin bảo mật,
  // đồng thời ký presigned URL có thời hạn ngắn (1 giờ) cho các phân đoạn video (.ts).
  public async getPlaybackManifest(videoAssetId: string, keyUri?: string) {
    const asset = await VideoAsset.findById(videoAssetId).lean();

    // Nếu manifestKey không có hoặc asset chưa ở trạng thái READY thì throw error
    if (!asset?.manifestKey || asset.status !== 'READY') {
      throw new Error('Video chưa sẵn sàng để phát.');
    }
    
    // Nếu có keyUri, kiểm tra xem manifest đã viết lại đã có sẵn trong Redis cache chưa
    if (keyUri) {
      const cached = await this.getCachedPlaybackManifest(asset.manifestKey);
      // Nếu tìm thấy cache, thay thế chuỗi giữ chỗ bằng keyUri chứa session cá nhân của học viên
      if (cached) return cached.replaceAll(KEY_URI_PLACEHOLDER, keyUri);
    }

    // Đọc nội dung file manifest HLS gốc (.m3u8) từ MinIO
    const manifest = await s3Service.getObjectText(asset.manifestKey);
    const baseKey = asset.manifestKey.slice(0, asset.manifestKey.lastIndexOf('/') + 1);
    
    // Quét từng dòng của file manifest để thực hiện viết lại (rewrite)
    const lines = await Promise.all(
      manifest.split(/\r?\n/).map(async (line) => {
        const value = line.trim();
        
        // 1. Nếu là dòng chỉ định khóa giải mã (#EXT-X-KEY): thay thế bằng Placeholder để ẩn URL gốc
        if (value.startsWith('#EXT-X-KEY') && keyUri) {
          return line.includes('URI="')
            ? line.replace(/URI="[^"]*"/, `URI="${KEY_URI_PLACEHOLDER}"`)
            : `${line},URI="${KEY_URI_PLACEHOLDER}"`;
        }
        
        // 2. Bỏ qua các dòng comment, chỉ thị định dạng HLS
        if (!value || value.startsWith('#') || /^https?:\/\//i.test(value)) return line;
        
        // 3. Nếu là dòng chứa file phân đoạn (.ts): ký đường dẫn presigned URL có hiệu lực trong 1 giờ
        return s3Service.getDownloadPresignedUrl(`${baseKey}${value}`, PLAYBACK_SEGMENT_URL_TTL_SECONDS);
      })
    );
    
    const rewritten = lines.join('\n');
    if (!keyUri) return rewritten;
    
    // Lưu manifest đã rewrite vào Redis cache (thời gian sống 4 phút) để phục vụ các yêu cầu tiếp theo
    await this.cachePlaybackManifest(asset.manifestKey, rewritten);
    
    // Trả về manifest, thay thế placeholder bằng keyUri thực tế (kèm session) của user
    return rewritten.replaceAll(KEY_URI_PLACEHOLDER, keyUri);
  }

  private playbackManifestCacheKey(manifestKey: string): string {
    return `playback:manifest:v1:${manifestKey}`;
  }

  // 1. Hàm getCachedPlaybackManifest có tác dụng là lấy manifest từ Redis cache

  private async getCachedPlaybackManifest(manifestKey: string): Promise<string | null> {
    try {
      return await redisClient.get(this.playbackManifestCacheKey(manifestKey));
    } catch (error) {
      console.warn('[VideoAssetService] Không thể đọc cache manifest:', error);
      return null;
    }
  }

  // 2. Hàm cachePlaybackManifest có tác dụng là lưu manifest vào Redis cache
  private async cachePlaybackManifest(manifestKey: string, manifest: string): Promise<void> {
    try {
      await redisClient.setex(
        this.playbackManifestCacheKey(manifestKey),
        PLAYBACK_MANIFEST_CACHE_TTL_SECONDS,
        manifest,
      );
    } catch (error) {
      console.warn('[VideoAssetService] Không thể ghi cache manifest:', error);
    }
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
      const assetDir = path.join(MEDIA_ROOT, 'videos', asset._id.toString()); // thư mục tạm cho file raw và output HLS của video này (MEDIA_ROOT/videos/<assetId>/...). Cấu trúc: tmp-media/videos/<assetId>/raw_input, tmp-media/videos/<assetId>/hls/*.ts, *.m3u8
      fs.mkdirSync(assetDir, { recursive: true }); // tạo thư mục tạm cho video này, đảm bảo có folder riêng cho từng video để tránh xung đột file khi xử lý nhiều video cùng lúc (Ví dụ video A và video B cùng có file raw_input, nếu không có folder riêng sẽ bị xung đột khi download về cùng 1 đường dẫn, recursive: true } nghĩa là nếu thư mục cha chưa tồn tại thì tạo mới). Sau khi xử lý xong sẽ xóa toàn bộ thư mục này để dọn dẹp file tạm.
      const outputDir = path.join(assetDir, 'hls'); // thư mục tạm để FFmpeg xuất file HLS, sau đó mới upload lên storage. Cấu trúc: tmp-media/videos/<assetId>/hls/*.ts, *.m3u8

      if (!asset.rawObjectKey) {
        throw new Error('Không tìm thấy file video để xử lý.');
      }
      const rawFilePath = path.join(assetDir, 'raw_input');
      console.log(`[VideoAssetService] Downloading raw video từ storage: ${asset.rawObjectKey}`);
      await s3Service.downloadFile(asset.rawObjectKey, rawFilePath);

      // VALIDATION SAU UPLOAD — Kiểm tra file THẬT SỰ trước khi chạy FFmpeg
      // Tại sao cần bước này?
      // Khi FE gọi initiate-upload, nó tự khai báo fileName, mimeType, sizeBytes.
      // Attacker có thể khai "video/mp4" nhưng upload 1 file .exe hoặc file rác.
      // Nếu không validate, FFmpeg sẽ vẫn cố xử lý → tốn CPU vô ích.
      // Bước validation này chạy SAU khi download raw file, TRƯỚC khi chạy FFmpeg.

      // --- Check 1: Kiểm tra kích thước file thực tế ---
      // So sánh dung lượng file trên disk vs con số FE khai báo.
      // Cho phép sai lệch 10% (do overhead encoding, padding...).
      // Nếu FE khai 100MB nhưng file thật 1GB → có dấu hiệu bất thường → reject.
      const actualSize = fs.statSync(rawFilePath).size; // kích thước file thực tế sau khi download về, dùng để so sánh với sizeBytes do FE khai báo ở bước initiateUpload.
      const declaredSize = asset.sourceSizeBytes; // kích thước file do FE khai báo lưu trong DB ở bước initiateUpload.
      if (declaredSize > 0) {
        const deviation = Math.abs(actualSize - declaredSize) / declaredSize; // abs() để lấy giá trị tuyệt đối của độ lệch, tránh trường hợp file nhỏ hơn khai báo cũng bị tính là lệch âm. Nếu deviation > 0.1 (tức là chênh lệch hơn 10%) thì có dấu hiệu bất thường → reject file.
        if (deviation > 0.1) {
          throw new Error(
            `Kích thước file thực tế (${(actualSize / 1024 / 1024).toFixed(1)}MB) ` +
            `khác biệt quá lớn so với khai báo (${(declaredSize / 1024 / 1024).toFixed(1)}MB).`
          );
        }
      }

      // --- Check 2: Giới hạn dung lượng tối đa ---
      // Video khóa học thường 100MB–2GB. 10GB là biên an toàn cho video 4K dài.
      // Ngăn user upload file quá lớn chiếm hết storage.
      if (actualSize > MAX_FILE_SIZE) {
        throw new Error(
          `File vượt quá giới hạn ${(MAX_FILE_SIZE / (1024 ** 3)).toFixed(0)}GB cho phép.`
        );
      }

      // --- Check 3: Probe codec — file có phải video thật không? ---
      // probeVideoMetadata dùng FFmpeg ffprobe để đọc header file (rất nhanh, <100ms).
      // Nếu file không phải video (ví dụ file .txt đổi tên thành .mp4):
      //   → ffprobe sẽ throw error hoặc trả về video codec rỗng → reject ngay.
      // Nếu video hợp lệ → lưu kết quả probe để truyền vào processVideoToHLS (tránh probe 2 lần).
      let probeResult: { video: string; audio: string; durationSec: number };
      try {
        probeResult = await probeVideoMetadata(rawFilePath);
        if (!probeResult.video) {
          throw new Error('Không tìm thấy video stream trong file.');
        }
        if (probeResult.durationSec <= 0) {
          throw new Error('Video không có thời lượng (duration = 0). File có thể bị hỏng.');
        }
        console.log(
          `[VideoAssetService] Validation OK: codec=${probeResult.video}/${probeResult.audio}, ` +
          `duration=${probeResult.durationSec}s, size=${(actualSize / 1024 / 1024).toFixed(1)}MB`
        );
      } catch (probeError: any) {
        // Log chi tiết lỗi (stderr của FFprobe) ra console để admin dễ debug
        console.error(`[VideoAssetService] FFprobe quét lỗi (Có thể do file giả mạo/hỏng): ${probeError.message}`);
        
        // Trả về thông báo thân thiện, ngắn gọn cho Frontend (không hiển thị mã lỗi kỹ thuật)
        throw new Error(`Tệp tải lên bị hỏng, sai định dạng hoặc không phải là một video hợp lệ. Vui lòng kiểm tra lại!`);
      }
      // KẾT THÚC VALIDATION — File đã được xác nhận là video hợp lệ

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

      // #1 — FFmpeg: copy nếu H.264, ngược lại encode ultrafast
      // Truyền probeResult đã có sẵn từ bước validation → tránh probe lại file lần 2.
      const { encryptionKeyHex, durationSec } = await processVideoToHLS(
        rawFilePath, // đường dẫn file raw video đã download về local, dùng làm input cho FFmpeg
        outputDir, // thư mục output tạm để FFmpeg xuất file HLS, sau đó mới upload lên storage. Cấu trúc: tmp-media/videos/<assetId>/hls/*.ts, *.m3u8
        asset._id.toString(), // dùng để đặt tên file manifest và segments theo format <assetId>_playlist.m3u8, <assetId>_segment1.ts, <assetId>_segment2.ts... giúp dễ quản lý và tránh xung đột tên file khi xử lý nhiều video cùng lúc.
        onProgress, // callback để FFmpeg báo cáo tiến độ thực tế, từ đó cập nhật vào DB. Ví dụ FFmpeg có thể gọi onProgress(5), onProgress(10)... mỗi khi đạt được cột mốc tiến độ mới, giúp FE có phản hồi nhanh về tiến trình xử lý video.
        probeResult, // kết quả probe từ validation, không cần probe lại
      );

      asset.encryptionKey = encryptionKeyHex; // lưu khóa mã hóa (dạng hex string) vào DB để sau này FE có thể gọi API lấy về giải mã khi cần thiết. Khóa này dùng để mã hóa AES-128 cho các segment HLS, đảm bảo chỉ người có khóa mới xem được video. Lưu ý: khóa này KHÔNG PHẢI là khóa để truy cập file trên storage, mà là khóa để giải mã nội dung video đã được mã hóa trong quá trình tạo HLS. Vì vậy, việc lưu khóa này trong DB là cần thiết để sau này khi FE cần phát video, nó sẽ gọi API lấy khóa này về để giải mã các segment HLS khi stream.

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
      // ===== DỌN DẸP KHI THẤT BẠI =====
      // Nếu validation hoặc FFmpeg fail → xóa raw video trên storage NGAY LẬP TỨC.
      // Không chờ orphan cleanup (mặc định 30 phút) → giảm storage bị chiếm bởi file rác.
      // Đặc biệt quan trọng khi attacker upload file giả: file bị xóa ngay thay vì nằm trên MinIO 30 phút.
      if (asset.rawObjectKey) {
        await s3Service.deleteFile(asset.rawObjectKey).catch((cleanupErr) => {
          console.error(`[VideoAssetService] Không thể xóa raw file ${asset.rawObjectKey}:`, cleanupErr);
        });
      }

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
