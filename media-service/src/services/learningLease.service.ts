import crypto from 'crypto';
import redisClient from '../config/redis';

export type MediaLearningLease = {
  learningSessionId: string;
  tokenHash: string;
  userId: string;
  authSessionId: string;
  clientInstanceId: string;
  courseId: string;
  courseVersionId?: string;
  lessonId: string;
  videoAssetId: string;
  leaseVersion: number;
};

export class MediaLearningLeaseError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

class LearningLeaseService {
  /**
   * [FLOW HỌC VIDEO - MEDIA.2: XÁC MINH LEARNING LEASE]
   * Đối chiếu session id/token/user/auth session/video với lease do Progress Service lưu trong Redis.
   * Mục đích: Media Service không tin trực tiếp dữ liệu header do FE gửi lên.
   */
  async validate(input: {
    userId: string; authSessionId: string; learningSessionId: string; learningSessionToken?: string;
    tokenHash?: string; videoAssetId: string;
  }): Promise<MediaLearningLease> {
    if (!input.learningSessionId || input.learningSessionId.length > 128 || (input.learningSessionToken?.length || 0) > 256 || (input.tokenHash?.length || 0) > 128) {
      throw new MediaLearningLeaseError(400, 'INVALID_LEARNING_SESSION_INPUT', 'Thông tin phiên học không hợp lệ.');
    }
    const raw = await redisClient.get(`learning:active:${input.userId}`);
    if (!raw) throw new MediaLearningLeaseError(409, 'LEARNING_SESSION_EXPIRED', 'Phiên học đã hết hạn. Vui lòng phát lại video.');
    let lease: MediaLearningLease;
    try { lease = JSON.parse(raw) as MediaLearningLease; } catch {
      throw new MediaLearningLeaseError(409, 'LEARNING_SESSION_EXPIRED', 'Phiên học không hợp lệ.');
    }
    const suppliedHash = input.tokenHash || hashToken(String(input.learningSessionToken || ''));
    const matches = lease.learningSessionId === input.learningSessionId
      && lease.tokenHash === suppliedHash
      && lease.userId === input.userId
      && lease.authSessionId === input.authSessionId
      && lease.videoAssetId === input.videoAssetId;
    if (!matches) throw new MediaLearningLeaseError(409, 'LEARNING_SESSION_REPLACED', 'Phiên học đã được chuyển sang thiết bị hoặc tab khác.');
    return lease;
  }

  tokenHash(token: string) { return hashToken(token); }
}

export default new LearningLeaseService();
