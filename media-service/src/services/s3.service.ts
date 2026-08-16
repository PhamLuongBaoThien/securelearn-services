import {
  S3Client, // lớp chính để tương tác với S3/R2/MinIO, cung cấp phương thức send() để gửi các lệnh (command) mô tả thao tác muốn thực hiện.
  PutObjectCommand, // command để upload một file lên storage.
  DeleteObjectCommand, // command để xóa một file trên storage.
  ListObjectsV2Command, // command để liệt kê các file trong bucket, hỗ trợ phân trang với ContinuationToken.
  DeleteObjectsCommand, // command để xóa nhiều file cùng lúc trên storage.
  CreateMultipartUploadCommand, // command để khởi tạo một multipart upload session, trả về UploadId dùng cho các bước tiếp theo.
  UploadPartCommand, // command để upload một phần (part) của file trong multipart upload, cần UploadId và PartNumber.
  CompleteMultipartUploadCommand, // command để hoàn tất multipart upload sau khi đã upload tất cả parts, cần UploadId và danh sách parts đã upload (ETag và PartNumber).
  AbortMultipartUploadCommand, // command để hủy multipart upload session nếu user cancel, cần UploadId.
  HeadObjectCommand, // command để kiểm tra sự tồn tại của một object trên storage, trả về metadata nếu tồn tại hoặc lỗi nếu không.
  GetObjectCommand, // command để download một file từ storage, trả về stream dữ liệu nếu thành công.
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'securelearn-media';

export const s3Client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: !!process.env.S3_ENDPOINT,
  // Tắt auto-checksum CRC32 của AWS SDK v3 mới:
  // Nếu để mặc định, SDK ký checksum vào presigned URL nhưng browser không
  // thể tính lại đúng giá trị đó → MinIO reject toàn bộ UploadPart request.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

// Client riêng để presign URL cho browser.
// PHẢI dùng S3_PUBLIC_ENDPOINT (127.0.0.1:9000 ở local) thay vì S3_ENDPOINT (minio:9000)
// vì chữ ký S3 bao gồm header "host" — nếu ký với "minio:9000" nhưng browser
// gửi request đến host public khác thì host không khớp → SignatureDoesNotMatch.
const presignClient = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || undefined,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

class S3Service {
  /**
   * Tải một file cục bộ lên Cloudflare R2 bằng PutObject.
   * Được dùng để đưa playlist và segment HLS sau xử lý lên kho lưu trữ.
   */
  public async uploadFile(
    filePath: string,
    objectKey: string,
    mimeType: string,
  ): Promise<void> {
    const fileStream = fs.createReadStream(filePath);
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      Body: fileStream,
      ContentType: mimeType,
    });
    await s3Client.send(command);
  }

  /** Xóa một object theo Object Key, ví dụ video gốc sau khi HLS đã tạo thành công. */
  public async deleteFile(objectKey: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey });
    await s3Client.send(command);
  }

  /**
   * Liệt kê và xóa theo từng trang tất cả object có chung prefix.
   * R2 là object storage không có thư mục thật; prefix đóng vai trò như đường dẫn thư mục.
   */
  public async deleteFolder(prefix: string): Promise<void> {
    let continuationToken: string | undefined;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const listResult = await s3Client.send(listCommand);
      const objects = listResult.Contents;

      if (objects && objects.length > 0) {
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: BUCKET_NAME,
          Delete: {
            Objects: objects.map((obj) => ({ Key: obj.Key })),
            Quiet: true,
          },
        });
        await s3Client.send(deleteCommand);
      }

      continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  /**
   * Ghép URL truy cập trực tiếp từ domain/endpoint đã cấu hình và Object Key.
   * Hàm không ký URL và chỉ phù hợp với tài nguyên được phép truy cập công khai.
   */
  public getFileUrl(objectKey: string): string {
    if (process.env.S3_PUBLIC_DOMAIN) {
      return `${process.env.S3_PUBLIC_DOMAIN}/${objectKey}`;
    }
    if (process.env.S3_PUBLIC_ENDPOINT) {
      return `${process.env.S3_PUBLIC_ENDPOINT}/${BUCKET_NAME}/${objectKey}`;
    }
    if (process.env.S3_ENDPOINT) {
      return `${process.env.S3_ENDPOINT}/${BUCKET_NAME}/${objectKey}`;
    }
    return `https://${BUCKET_NAME}.s3.${process.env.S3_REGION}.amazonaws.com/${objectKey}`;
  }

  // ===== Multipart Upload =====

  /**
   * Khởi tạo Multipart Upload cho một object video gốc trên R2.
   * @returns UploadId liên kết tất cả part và bước complete/abort của cùng phiên tải.
   */
  public async createMultipartUpload(objectKey: string, mimeType: string): Promise<string> {
    const result = await s3Client.send(
      new CreateMultipartUploadCommand({ Bucket: BUCKET_NAME, Key: objectKey, ContentType: mimeType }),
    );
    if (!result.UploadId) throw new Error('Không nhận được UploadId từ storage.');
    return result.UploadId;
  }

  /**
   * Sinh Presigned URL để trình duyệt PUT một part trực tiếp lên R2 mà không lộ Secret Key.
   * URL được ràng buộc với Bucket, Object Key, UploadId, PartNumber và thời hạn sử dụng.
   *
   * @param objectKey Định danh object video gốc trên R2.
   * @param uploadId Mã Multipart Upload đã tạo trước đó.
   * @param partNumber Thứ tự part, bắt đầu từ 1.
   * @param expiresIn Thời gian URL có hiệu lực (giây).
   * Mặc định 3600 giây = 1 giờ, đủ cho đa số lượt upload video theo từng part.
   */
  public async getPartPresignedUrl(
    objectKey: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number = 3600,
  ): Promise<string> {

    // Command (lệnh/yêu cầu thao tác) là object mô tả "muốn gọi API nào của S3 và với tham số gì".
    // Ở đây command này mô tả thao tác UploadPart (upload một phần/chunk của file lớn)
    // trong Multipart Upload (upload nhiều phần rồi ghép lại).
    // Sau khi tạo command, ta đưa nó vào getSignedUrl để sinh presigned URL
    // (URL tạm thời đã được ký) cho browser upload đúng part này lên storage.
    const cmd = new UploadPartCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      UploadId: uploadId,
      PartNumber: partNumber,
      // Checksum (mã kiểm tra toàn vẹn dữ liệu) là giá trị hash/tổng kiểm giúp storage
      // biết dữ liệu nhận được có bị sai trong lúc truyền hay không.
      //
      // AWS SDK v3 đôi khi tự thêm checksum như CRC32 (một thuật toán checksum phổ biến)
      // vào chữ ký của presigned URL (URL tạm thời đã được backend ký để browser được phép upload).
      // Khi đó, browser cũng phải gửi đúng checksum header (header = metadata đi kèm HTTP request).
      //
      // Với flow hiện tại, browser chỉ PUT raw Blob (khối dữ liệu file thô từ input) lên MinIO.
      // Browser không tự tính và gửi đúng CRC32 header cho từng part, nên nếu URL bị ký kèm
      // checksum thì MinIO có thể từ chối request vì chữ ký không khớp.
      //
      // Vì vậy ta đặt undefined để UploadPartCommand không yêu cầu checksum riêng cho từng part.
      // Tính toàn vẹn vẫn được S3 multipart kiểm soát qua ETag (mã định danh part đã upload)
      // và bước CompleteMultipartUpload sau đó.
      ChecksumAlgorithm: undefined,
    });
    // presignClient dùng S3_PUBLIC_ENDPOINT nên URL chứa host public browser gọi được.
    // Host này phải khớp với request thật, nếu không S3 signature sẽ sai.
    const url = await getSignedUrl(presignClient, cmd, { expiresIn });
    return url;
  }

  /**
   * Sinh URL GET có chữ ký và thời hạn để tải một object mà không công khai bucket.
   * @param expiresIn Thời gian URL còn hiệu lực, mặc định một giờ.
   */
  public async getDownloadPresignedUrl(objectKey: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey });
    return getSignedUrl(presignClient, command, { expiresIn });
  }

  /** Đọc toàn bộ nội dung object dạng văn bản UTF-8, thường dùng cho playlist HLS. */
  public async getObjectText(objectKey: string): Promise<string> {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey }));
    if (!response.Body) throw new Error(`Không thể đọc object: ${objectKey}`);
    return response.Body.transformToString('utf-8');
  }

  /** Trả stream của object để Backend truyền dữ liệu mà không cần giữ toàn bộ file trong RAM. */
  public async getObjectStream(objectKey: string): Promise<Readable> {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey }));
    if (!response.Body) throw new Error(`Không thể đọc object: ${objectKey}`);
    return response.Body as Readable;
  }

  /**
   * Yêu cầu R2 ghép các part đã tải thành object hoàn chỉnh.
   * Danh sách PartNumber/ETag phải đúng với kết quả R2 trả về cho từng request PUT.
   */
  public async completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[],
  ): Promise<void> {
    await s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  }

  /** Hủy Multipart Upload chưa hoàn tất để giải phóng các part tạm khi người dùng hủy hoặc có lỗi. */
  public async abortMultipartUpload(objectKey: string, uploadId: string): Promise<void> {
    await s3Client.send(
      new AbortMultipartUploadCommand({ Bucket: BUCKET_NAME, Key: objectKey, UploadId: uploadId }),
    );
  }

  /** Kiểm tra object có tồn tại bằng HeadObject mà không tải nội dung của object. */
  public async objectExists(objectKey: string): Promise<boolean> {
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Tải object từ R2 về file cục bộ bằng stream pipeline.
   * Worker dùng hàm này để lấy video gốc về trước khi FFprobe và FFmpeg xử lý.
   * @param objectKey Định danh video gốc trên R2.
   * @param destPath Đường dẫn file tạm sẽ được ghi trên máy xử lý.
   */
  public async downloadFile(objectKey: string, destPath: string): Promise<void> {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey }),
    );
    if (!response.Body) throw new Error(`Không thể download object: ${objectKey}`);
    await pipeline(response.Body as Readable, fs.createWriteStream(destPath));
  }
}

export default new S3Service();
