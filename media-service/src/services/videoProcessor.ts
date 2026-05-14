import ffmpeg from 'fluent-ffmpeg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type ProgressCallback = (percent: number) => Promise<void>;

/**
 * Probe codec của video để quyết định copy hay re-encode.
 */
const probeVideoMetadata = (inputPath: string): Promise<{ video: string; audio: string; durationSec: number }> =>
  new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err: any, metadata: any) => {
      if (err) return reject(err);
      const streams: any[] = metadata.streams || [];
      const video = streams.find((s) => s.codec_type === 'video')?.codec_name ?? '';
      const audio = streams.find((s) => s.codec_type === 'audio')?.codec_name ?? '';
      const rawDuration =
        Number(metadata?.format?.duration) ||
        Number(streams.find((s) => s.codec_type === 'video')?.duration) ||
        0;
      const durationSec = Math.max(0, Math.round(rawDuration));
      resolve({ video, audio, durationSec });
    });
  });

/**
 * Xử lý video: Chuyển đổi file video sang định dạng HLS chia nhỏ (.ts)
 * và mã hoá AES-128 trên từng phân đoạn.
 *
 * Tối ưu #1: Nếu video đã là H.264+AAC → dùng copy mode (không re-encode) → cực nhanh.
 * Tối ưu #1: Nếu cần encode → dùng preset ultrafast + threads 0 (nhanh hơn 5-10x so với medium).
 * Tối ưu #3: Báo cáo progress thực qua callback mỗi 5%.
 *
 * @param inputPath   Đường dẫn tới file video gốc (local)
 * @param outputDir   Thư mục chứa các file đầu ra (.m3u8 và .ts)
 * @param videoId     ID định danh của video (dùng đặt tên file và key)
 * @param onProgress  Callback nhận % tiến trình (0-99), được gọi mỗi 5%
 */
export const processVideoToHLS = async (
  inputPath: string,
  outputDir: string,
  videoId: string,
  onProgress?: ProgressCallback,
): Promise<{ m3u8OutputPath: string; encryptionKeyHex: string; durationSec: number }> => {
  // --- Probe codec TRƯỚC khi tạo Promise (tránh unhandled rejection trong executor) ---
  let canCopyVideo = false;
  let canCopyAudio = false;
  let durationSec = 0;
  try {
    const metadata = await probeVideoMetadata(inputPath);
    canCopyVideo = metadata.video === 'h264';
    canCopyAudio = ['aac', 'mp3'].includes(metadata.audio);
    durationSec = metadata.durationSec;
    console.log(`[MediaService] Codec probe: video=${metadata.video}, audio=${metadata.audio}, duration=${durationSec}s`);
    console.log(`[MediaService] Chế độ xử lý: ${canCopyVideo && canCopyAudio ? '⚡ COPY (không encode)' : '🔄 ENCODE (libx264+ultrafast)'}`);
  } catch (e) {
    console.warn('[MediaService] Probe codec thất bại, fallback sang encode mode:', e);
  }

  // --- Setup mã hoá AES-128 ---
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const key = crypto.randomBytes(16);
  const keyHex = key.toString('hex');
  const keyFilePath = path.join(outputDir, `${videoId}.key`);
  fs.writeFileSync(keyFilePath, key);

  const keyInfoPath = path.join(outputDir, 'key_info.txt');
  const apiUrl = process.env.API_URL || 'http://localhost:8000';
  const keyUri = `${apiUrl}/api/media/videos/${videoId}/key`;
  const ivHex = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(keyInfoPath, `${keyUri}\n${keyFilePath}\n${ivHex}`);

  const m3u8OutputPath = path.join(outputDir, `${videoId}_playlist.m3u8`);
  const segmentPattern = path.join(outputDir, `${videoId}_segment_%03d.ts`);

  console.log(`[MediaService] Bắt đầu HLS processing cho video: ${videoId}...`);

  // --- Chạy FFmpeg ---
  return new Promise((resolve, reject) => {
    let lastReported = 0;

    const cmd = ffmpeg(inputPath);

    // #1 — Copy stream nếu codec tương thích, ngược lại encode với ultrafast
    if (canCopyVideo && canCopyAudio) {
      cmd.videoCodec('copy').audioCodec('copy');
    } else {
      cmd
        .videoCodec('libx264')
        .audioCodec('aac')
        .addOptions([
          '-preset ultrafast', // #1 — Nhanh hơn 5-10x so với preset mặc định "medium"
          '-crf 26',           // Chất lượng tốt, giảm kích thước file
          '-threads 0',        // Dùng tất cả CPU cores
          '-profile:v baseline',
          '-level 3.0',
        ]);
    }

    cmd
      .addOptions([
        '-start_number 0',
        '-hls_time 10',
        '-hls_list_size 0',
        '-hls_key_info_file ' + keyInfoPath,
        '-hls_segment_filename ' + segmentPattern,
      ])
      .output(m3u8OutputPath)
      .on('progress', (progress: any) => {
        // #3 — Real progress: gọi callback mỗi 5% thay vì giả lập
        if (!onProgress) return;
        const pct = Math.min(Math.round(progress.percent || 0), 99);
        if (pct - lastReported >= 5) {
          lastReported = pct;
          void onProgress(pct);
        }
      })
      .on('end', () => {
        console.log(`[MediaService] ✅ Hoàn tất HLS processing cho ${videoId}`);
        // Dọn dẹp file bảo mật — không upload lên storage
        try {
          if (fs.existsSync(keyInfoPath)) fs.unlinkSync(keyInfoPath);
          if (fs.existsSync(keyFilePath)) fs.unlinkSync(keyFilePath);
        } catch (cleanupErr) {
          console.error('[MediaService] Lỗi khi dọn dẹp file bảo mật:', cleanupErr);
        }
        resolve({ m3u8OutputPath, encryptionKeyHex: keyHex, durationSec });
      })
      .on('error', (err: any) => {
        console.error(`[MediaService] Lỗi khi xử lý video ${videoId}:`, err);
        try {
          if (fs.existsSync(keyInfoPath)) fs.unlinkSync(keyInfoPath);
          if (fs.existsSync(keyFilePath)) fs.unlinkSync(keyFilePath);
        } catch (_) { /* ignore */ }
        reject(err);
      })
      .run();
  });
};
