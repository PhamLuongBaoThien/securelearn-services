import ffmpeg from 'fluent-ffmpeg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const FFMPEG_THREADS = Math.max(
  1,
  Math.min(8, Number.parseInt(process.env.FFMPEG_THREADS || '2', 10) || 2),
);

export type ProgressCallback = (percent: number) => Promise<void>;

export type ProbedVideoMetadata = {
  video: string;
  audio: string;
  durationSec: number;
  width: number;
  height: number;
};

export type ProcessedRendition = {
  quality: string;
  width: number;
  height: number;
  bandwidth: number;
  manifestFileName: string;
  manifestOutputPath: string;
  manifestKeySuffix: string;
};

export type ProcessedHlsOutput = {
  masterManifestOutputPath: string;
  masterManifestFileName: string;
  encryptionKeyHex: string;
  durationSec: number;
  renditions: ProcessedRendition[];
  availableQualities: string[];
  sourceWidth: number;
  sourceHeight: number;
};

const HLS_SEGMENT_DURATION_SECONDS = 10;
const MASTER_MANIFEST_FILE_NAME = 'master.m3u8';
const DEFAULT_RENDITION_BANDWIDTHS: Record<number, number> = {
  360: 800_000,
  720: 2_800_000,
  1080: 5_000_000,
};

const QUALITY_PRESETS = [360, 720, 1080] as const;
const QUALITY_CODECS = 'avc1.42e028,mp4a.40.2';
const TARGET_FPS = 30;

/** Làm tròn kích thước khung hình về số chẵn vì bộ mã hóa H.264/yuv420p yêu cầu chiều chẵn. */
const normalizeEven = (value: number) => {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
};

/** Chuẩn hóa nhãn chất lượng thành tên thư mục an toàn, ví dụ "720P" thành "720p". */
const sanitizeQualityLabel = (quality: string) => quality.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Ước lượng bandwidth ghi trong master.m3u8 để trình phát lựa chọn rendition phù hợp. */
const estimateBandwidth = (height: number) => {
  const preset = DEFAULT_RENDITION_BANDWIDTHS[height];
  if (preset) return preset;
  return Math.max(500_000, Math.round((height / 360) * DEFAULT_RENDITION_BANDWIDTHS[360]));
};

/**
 * Tạo danh sách chất lượng không vượt quá độ phân giải video nguồn.
 * Ví dụ nguồn 1080p tạo 360p/720p/1080p; nguồn thấp hơn 720p giữ thêm độ cao gốc.
 * @param sourceHeight Chiều cao video nguồn đọc từ FFprobe.
 * @returns Danh sách nhãn chất lượng tăng dần và không trùng lặp.
 */
export const buildQualityLadder = (sourceHeight: number): string[] => {
  const normalizedSourceHeight = Math.max(1, Math.round(sourceHeight));
  const qualities = QUALITY_PRESETS.filter((height) => height <= normalizedSourceHeight).map((height) => `${height}p`);

  if (normalizedSourceHeight < 720) {
    const exactSourceLabel = `${normalizedSourceHeight}p`;
    if (!qualities.includes(exactSourceLabel)) qualities.push(exactSourceLabel);
  }

  // Bảo đảm danh sách chất lượng không rỗng, loại bỏ phần tử trùng và sắp xếp chất lượng từ thấp đến cao
  if (qualities.length === 0) qualities.push(`${normalizedSourceHeight}p`);
  return Array.from(new Set(qualities)).sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
};

/**
 * Chuyển quality ladder thành cấu hình encode cho từng rendition, gồm kích thước,
 * bandwidth, đường dẫn playlist và thư mục đầu ra, đồng thời giữ đúng tỷ lệ khung hình.
 */
const buildRenditions = (sourceWidth: number, sourceHeight: number): ProcessedRendition[] => {
  const aspectRatio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 16 / 9;
  return buildQualityLadder(sourceHeight).map((quality) => {
    const height = Math.max(1, Number.parseInt(quality, 10) || sourceHeight);
    const width = height >= sourceHeight
      ? normalizeEven(sourceWidth || aspectRatio * height)
      : normalizeEven(aspectRatio * height);
    const folderName = sanitizeQualityLabel(quality);
    const manifestFileName = 'playlist.m3u8';

    return {
      quality,
      width,
      height,
      bandwidth: estimateBandwidth(height),
      manifestFileName,
      manifestOutputPath: path.join(folderName, manifestFileName),
      manifestKeySuffix: path.posix.join(folderName, manifestFileName),
    };
  });
};

/**
 * Gọi FFprobe để đọc codec video/audio, thời lượng và độ phân giải thật của tệp nguồn.
 * Dữ liệu này dùng để phát hiện file hỏng/giả mạo và xây dựng quality ladder.
 * @param inputPath Đường dẫn file video tạm trên máy chạy Media Service.
 */
export const probeVideoMetadata = (inputPath: string): Promise<ProbedVideoMetadata> =>
  new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err: unknown, metadata: ffmpeg.FfprobeData) => {
      if (err) return reject(err);
      const streams = metadata.streams || [];
      const videoStream = streams.find((stream) => stream.codec_type === 'video');
      const audioStream = streams.find((stream) => stream.codec_type === 'audio');
      const rawDuration =
        Number(metadata?.format?.duration) ||
        Number(videoStream?.duration) ||
        0;
      const durationSec = Math.max(0, Math.round(rawDuration));
      resolve({
        video: videoStream?.codec_name ?? '',
        audio: audioStream?.codec_name ?? '',
        durationSec,
        width: Number(videoStream?.width) || 0,
        height: Number(videoStream?.height) || 0,
      });
    });
  });

/**
 * Gọi FFmpeg để mã hóa một rendition sang H.264/AAC, chia segment khoảng 10 giây,
 * mã hóa AES-128 và tạo playlist.m3u8 cùng các tệp .ts trong thư mục chất lượng.
 * @param params Chứa file nguồn, thư mục đích, cấu hình rendition, key-info và callback tiến độ.
 */
const encodeRenditionToHls = async (params: {
  inputPath: string;
  outputDir: string;
  rendition: ProcessedRendition;
  keyInfoPath: string;
  onProgress?: (percent: number) => Promise<void>;
}): Promise<void> => {
  const {
    inputPath,
    outputDir,
    rendition,
    keyInfoPath,
    onProgress,
  } = params;

  const renditionDir = path.join(outputDir, sanitizeQualityLabel(rendition.quality));
  fs.mkdirSync(renditionDir, { recursive: true });

  const playlistPath = path.join(renditionDir, rendition.manifestFileName);
  const segmentPattern = path.join(renditionDir, `${sanitizeQualityLabel(rendition.quality)}_%03d.ts`);

  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg(inputPath);

    cmd
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('128k')
      .addOptions([
        '-preset veryfast',
        '-crf 23',
        '-threads ' + FFMPEG_THREADS,
        '-profile:v baseline', // cấu hình profile baseline để đảm bảo tương thích với nhiều thiết bị
        '-level 4.0', // đặt level 4.0 để hỗ trợ độ phân giải cao hơn
        '-pix_fmt yuv420p', // định dạng pixel yuv420p để đảm bảo tương thích với nhiều thiết bị
        '-sc_threshold 0',
        `-r ${TARGET_FPS}`,
        `-force_key_frames expr:gte(t,n_forced*${HLS_SEGMENT_DURATION_SECONDS})`,
        `-vf scale=${rendition.width}:${rendition.height}:force_original_aspect_ratio=decrease,pad=${rendition.width}:${rendition.height}:(ow-iw)/2:(oh-ih)/2`,
      ]);

    cmd
      .addOptions([
        '-start_number 0',
        `-hls_time ${HLS_SEGMENT_DURATION_SECONDS}`,
        '-hls_list_size 0',
        '-hls_playlist_type vod',
        `-hls_key_info_file ${keyInfoPath}`,
        `-hls_segment_filename ${segmentPattern}`,
      ])
      .output(playlistPath)
      .on('progress', (progress: { percent?: number }) => {
        if (!onProgress) return;
        const pct = Math.min(Math.round(progress.percent || 0), 99);
        void onProgress(pct);
      })
      .on('end', () => resolve())
      .on('error', (error: Error) => reject(error))
      .run();
  });
};

/**
 * Điều phối toàn bộ quá trình chuyển một video nguồn thành gói HLS đa chất lượng.
 * Hàm tạo khóa AES-128, lần lượt encode các rendition, tạo master.m3u8, tổng hợp metadata
 * trả về cho VideoAssetService và luôn xóa các file key/key-info tạm sau khi xử lý.
 * @param inputPath Đường dẫn video nguồn đã tải từ R2 về máy xử lý.
 * @param outputDir Thư mục tạm chứa master, playlist và segment HLS.
 * @param videoId Mã video dùng để tạo key URI và tên file khóa tạm.
 * @param onProgress Callback ghi phần trăm xử lý tổng hợp của các rendition.
 * @param preProbed Metadata FFprobe đã đọc trước đó để tránh probe lại.
 */
export const processVideoToHLS = async (
  inputPath: string,
  outputDir: string,
  videoId: string,
  onProgress?: ProgressCallback,
  preProbed?: ProbedVideoMetadata,
): Promise<ProcessedHlsOutput> => {
  let durationSec = 0;
  let sourceWidth = 0;
  let sourceHeight = 0;

  try {
    const metadata = preProbed ?? await probeVideoMetadata(inputPath);
    durationSec = metadata.durationSec;
    sourceWidth = metadata.width;
    sourceHeight = metadata.height;
    console.log(
      `[MediaService] Codec probe: video=${metadata.video}, audio=${metadata.audio}, duration=${durationSec}s, resolution=${sourceWidth}x${sourceHeight}`,
    );
  } catch (error) {
    console.warn('[MediaService] Probe codec thất bại, fallback sang encode mode:', error);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const renditions = buildRenditions(sourceWidth || 1280, sourceHeight || 720);
  const key = crypto.randomBytes(16);
  const keyHex = key.toString('hex');
  const keyFilePath = path.join(outputDir, `${videoId}.key`);
  fs.writeFileSync(keyFilePath, key);

  const apiUrl = process.env.API_URL || 'http://localhost:8000';
  const keyUri = `${apiUrl}/api/media/videos/${videoId}/key`;
  const masterManifestOutputPath = path.join(outputDir, MASTER_MANIFEST_FILE_NAME);
  const keyInfoPaths: string[] = [];

  try {
    for (let index = 0; index < renditions.length; index += 1) {
      const rendition = renditions[index];
      const keyInfoPath = path.join(outputDir, `key_info_${sanitizeQualityLabel(rendition.quality)}.txt`);
      keyInfoPaths.push(keyInfoPath);
      const ivHex = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(keyInfoPath, `${keyUri}\n${keyFilePath}\n${ivHex}`);

      let lastReported = -1;
      await encodeRenditionToHls({
        inputPath,
        outputDir,
        rendition,
        keyInfoPath,
        onProgress: onProgress
          ? async (percent) => {
              const weighted = Math.min(
                99,
                Math.round(((index + percent / 100) / renditions.length) * 99),
              );
              if (weighted === lastReported) return;
              lastReported = weighted;
              await onProgress(weighted);
            }
          : undefined,
      });
    }

    const masterLines = ['#EXTM3U', '#EXT-X-VERSION:3'];
    for (const rendition of renditions) {
      masterLines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidth},RESOLUTION=${rendition.width}x${rendition.height},CODECS="${QUALITY_CODECS}"`,
        rendition.manifestOutputPath.replace(/\\/g, '/'),
      );
    }
    fs.writeFileSync(masterManifestOutputPath, masterLines.join('\n'));

    if (onProgress) await onProgress(99);

    return {
      masterManifestOutputPath,
      masterManifestFileName: MASTER_MANIFEST_FILE_NAME,
      encryptionKeyHex: keyHex,
      durationSec,
      renditions,
      availableQualities: renditions.map((rendition) => rendition.quality),
      sourceWidth,
      sourceHeight,
    };
  } finally {
    for (const keyInfoPath of keyInfoPaths) {
      try {
        if (fs.existsSync(keyInfoPath)) fs.unlinkSync(keyInfoPath);
      } catch (error) {
        console.error('[MediaService] Lỗi khi dọn dẹp key_info:', error);
      }
    }
    try {
      if (fs.existsSync(keyFilePath)) fs.unlinkSync(keyFilePath);
    } catch (error) {
      console.error('[MediaService] Lỗi khi dọn dẹp file key:', error);
    }
  }
};





