import ffmpeg from 'fluent-ffmpeg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Xử lý video: Chuyển đổi file video sang định dạng HLS chia nhỏ (.ts) 
 * và mã hoá AES-128 trên từng phân đoạn.
 * 
 * @param inputPath Đường dẫn tới file video gốc
 * @param outputDir Thư mục chứa các file đầu ra (.m3u8 và .ts)
 * @param videoId ID định danh của video
 */
export const processVideoToHLS = async (inputPath: string, outputDir: string, videoId: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        // 1. Khởi tạo thư mục đầu ra nếu chưa có
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // 2. Sinh khóa mã hoá AES-128 (16 bytes)
        const key = crypto.randomBytes(16);
        const keyHex = key.toString('hex');
        
        // CẢNH BÁO MẬT MÃ: Trong ứng dụng thực tế, khóa này cực kỳ quan trọng. 
        // Phải lưu keyHex vào MongoDB/Redis cùng với videoId và KHÔNG được để lộ.
        // Chỉ cấp phát khóa thông qua một endpoint an toàn kiểm tra JWT & quyền truy cập.
        console.log(`[MediaService] Generated Encryption Key for ${videoId}: ${keyHex}`);

        // Lưu key tạm vào file để FFmpeg sử dụng trong quá trình mã hoá
        const keyFilePath = path.join(outputDir, `${videoId}.key`);
        fs.writeFileSync(keyFilePath, key);

        // 3. Tạo file thiết lập thông tin key (key_info) cho FFmpeg
        /* Định dạng của file key_info:
           - Dòng 1: Key URI (Đường dẫn để Video Player gọi lên backend lấy khóa giải mã)
           - Dòng 2: Đường dẫn file key vật lý để FFmpeg đọc và mã hoá
           - Dòng 3: IV - Initialization Vector (Tùy chọn, dùng custom IV cho bảo mật)
        */
        const keyInfoPath = path.join(outputDir, 'key_info.txt');
        
        // Dòng 1: Endpoint nội bộ/public để lấy khóa giải mã dựa trên videoId (Yêu cầu Token)
        const keyUri = `https://api.securelearn.com/media/keys/${videoId}`;
        
        // Dòng 3: Custom IV
        const ivHex = crypto.randomBytes(16).toString('hex');
        fs.writeFileSync(keyInfoPath, `${keyUri}\n${keyFilePath}\n${ivHex}`);

        const m3u8OutputPath = path.join(outputDir, `${videoId}_playlist.m3u8`);

        console.log(`[MediaService] Bắt đầu xử lý HLS AES-128 cho video: ${videoId}...`);

        // 4. Chạy tiến trình FFmpeg
        ffmpeg(inputPath)
            .videoCodec('libx264')   // Encode video H.264 - H.264 là 1 dạng nén video, giúp giảm dung lượng video nhưng vẫn giữ được chất lượng.
            .audioCodec('aac')       // Encode audio AAC - AAC là 1 dạng nén âm thanh, giúp giảm dung lượng âm thanh nhưng vẫn giữ được chất lượng.
            .addOptions([
                '-profile:v baseline',                      // Tương thích đa thiết bị
                '-level 3.0',                               // level là mức độ nén, level càng cao thì càng giảm dung lượng video nhưng vẫn giữ được chất lượng. lý do không làm cho số cao hơn là vì level càng cao thì thiết bị cần mạnh hơn để giải mã video, nếu làm số cao hơn thì nhiều thiết bị không giải mã được.
                '-start_number 0',                          // Bắt đầu đánh số chunk từ 0 (chunk là các phân đoạn nhỏ của video)
                '-hls_time 10',                             // Độ dài mỗi chunk: 10 giây
                '-hls_list_size 0',                         // Trữ toàn bộ danh sách ở playlist
                '-hls_key_info_file ' + keyInfoPath,        // Truyền file chứa thông tin mã hóa
                '-hls_segment_filename ' + path.join(outputDir, `${videoId}_segment_%03d.ts`) // Format tên file chunk
            ])
            .output(m3u8OutputPath)
            .on('end', () => {
                console.log(`[MediaService] Hoàn tất HLS processing cho ${videoId}`);
                
                // DỌN DẸP BẢO MẬT (Security Cleanup):
                // Xóa file key local và key_info vì nó không được public ra bên ngoài (trên S3/MinIO)
                // Chỉ upload file .m3u8 và các file .ts lên Object Storage
                try {
                    if (fs.existsSync(keyInfoPath)) fs.unlinkSync(keyInfoPath);
                    if (fs.existsSync(keyFilePath)) fs.unlinkSync(keyFilePath);
                } catch (cleanupErr) {
                    console.error('[MediaService] Lỗi khi dọn dẹp file bảo mật:', cleanupErr);
                }
                
                resolve(m3u8OutputPath);
            })
            .on('error', (err) => {
                console.error(`[MediaService] Lỗi khi xử lý video ${videoId}:`, err);
                
                // Dọn dẹp nếu có lỗi
                if (fs.existsSync(keyInfoPath)) fs.unlinkSync(keyInfoPath);
                if (fs.existsSync(keyFilePath)) fs.unlinkSync(keyFilePath);
                
                reject(err);
            })
            .run();
    });
};

/*
 * Ví dụ cách chạy:
 * 
 * async function runWorker() {
 *     try {
 *         const filePath = './temp/raw_lesson_1.mp4';
 *         const outputDir = './temp/hls_output/lesson_1';
 *         const videoId = 'lesson_1_uid_99x';
 *         
 *         await processVideoToHLS(filePath, outputDir, videoId);
 *         
 *         // -> Bước tiếp theo: Upload toàn bộ thư mục outputDir (m3u8, .ts) lên MinIO / S3
 *     } catch (e) {
 *         console.error('Processing failed');
 *     }
 * }
 */
