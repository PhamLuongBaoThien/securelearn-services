/**
 * Lớp lưu trữ tệp đính kèm của Inbox Service trên Cloudflare R2.
 *
 * AWS SDK cung cấp S3Client và các command để dịch vụ giao tiếp với R2 qua
 * Amazon S3 API. Việc dùng AWS SDK không có nghĩa dữ liệu được lưu trên AWS S3.
 */
import {
  S3Client, // Client gửi các command theo Amazon S3 API đến R2.
  PutObjectCommand, // Ghi một object mới vào bucket.
  GetObjectCommand, // Đọc nội dung một object từ bucket.
  DeleteObjectCommand, // Xóa một object theo Object Key.
  HeadBucketCommand, // Kiểm tra bucket có tồn tại và thông tin xác thực có quyền truy cập.
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import crypto from "crypto";
const bucket = process.env.S3_BUCKET_NAME || "securelearn-inbox";

// Client nội bộ của Inbox Service, được cấu hình bằng endpoint và khóa truy cập R2.
const client = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: process.env.S3_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      }
    : undefined,
});
/**
 * Nhận diện MIME type từ chữ ký đầu tệp (magic bytes), thay vì chỉ tin phần
 * mở rộng hoặc Content-Type do trình duyệt gửi lên.
 */
const detected = (b: Buffer): string => {
  if (b.subarray(0, 4).toString() === "%PDF") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b.subarray(1, 4).toString() === "PNG")
    return "image/png";
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return "";
};
/** Chuẩn hóa tên tệp để tạo Object Key an toàn và giới hạn độ dài trên R2. */
export const sanitizeName = (v: string): string =>
  v
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(0, 180) || "attachment";
/**
 * Kiểm tra nội dung tệp đính kèm rồi ghi trực tiếp vào bucket bằng PutObject.
 * @returns Object Key và MIME type để lưu cùng bản ghi tin nhắn hỗ trợ.
 */
export const storeFile = async (
  ticketId: string,
  file: Express.Multer.File,
): Promise<{ key: string; mime: string }> => {
  const mime = detected(file.buffer);
  if (!mime) throw new Error("Chỉ chấp nhận JPEG, PNG, WebP hoặc PDF.");
  const key = `inbox/${ticketId}/${crypto.randomUUID()}-${sanitizeName(file.originalname)}`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: mime,
    }),
  );
  return { key, mime };
};
/**
 * Đọc tệp đính kèm từ R2 dưới dạng stream để Backend chuyển tiếp mà không cần
 * nạp toàn bộ tệp vào bộ nhớ.
 */
export const getFile = async (key: string): Promise<Readable> => {
  const r = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  return r.Body as Readable;
};
/** Xóa tệp đính kèm khỏi R2 theo Object Key đã lưu trong cơ sở dữ liệu. */
export const deleteFile = async (key: string) =>
  client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

/**
 * Health check cho tầng lưu trữ: xác nhận bucket tồn tại và Inbox Service có
 * thể truy cập bằng thông tin xác thực hiện tại.
 */
export const storageReady = async () => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
};
