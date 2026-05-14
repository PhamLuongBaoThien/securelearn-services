import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import fs from 'fs';

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'securelearn-media';

export const s3Client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: !!process.env.S3_ENDPOINT,
});

class S3Service {
  /** Upload file vật lý từ disk lên storage. */
  public async uploadFile(
    filePath: string,
    objectKey: string,
    mimeType: string,
    isPublic: boolean = true,
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

  /** Upload buffer từ bộ nhớ lên storage. */
  public async uploadBuffer(buffer: Buffer, objectKey: string, mimeType: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      Body: buffer,
      ContentType: mimeType,
    });
    await s3Client.send(command);
  }

  /** Xóa 1 file. */
  public async deleteFile(objectKey: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey });
    await s3Client.send(command);
  }

  /** Xoá toàn bộ file có chung prefix (tương đương xoá folder). */
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

  /** Sinh URL public để truy cập file. */
  public getFileUrl(objectKey: string): string {
    if (process.env.S3_PUBLIC_DOMAIN) {
      return `${process.env.S3_PUBLIC_DOMAIN}/${objectKey}`;
    }
    if (process.env.S3_ENDPOINT) {
      return `${process.env.S3_ENDPOINT}/${BUCKET_NAME}/${objectKey}`;
    }
    return `https://${BUCKET_NAME}.s3.${process.env.S3_REGION}.amazonaws.com/${objectKey}`;
  }
}

export default new S3Service();
