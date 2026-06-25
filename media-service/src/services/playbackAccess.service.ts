import crypto from 'crypto';
import redisClient from '../config/redis';

type OneTimePlaybackValue = {
  userId: string;
  videoAssetId: string;
  courseId: string;
  source?: string;
  createdAt: string;
};

type KeySessionValue = {
  userId: string;
  videoAssetId: string;
  createdAt: string;
};

const PLAYBACK_TTL_SECONDS = 60;
const KEY_SESSION_TTL_SECONDS = 5 * 60;

const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const playbackKey = (token: string): string =>
  `playback:one-time:${hashToken(token)}`;

const keySessionKey = (token: string): string =>
  `playback:key-session:${hashToken(token)}`;

class PlaybackAccessService {
  public async createOneTimePlayback(input: Omit<OneTimePlaybackValue, 'createdAt'>): Promise<string> {
    // Tạo token xem manifest dùng một lần.
    const token = crypto.randomBytes(32).toString('base64url');
    const value: OneTimePlaybackValue = {
      ...input,
      createdAt: new Date().toISOString(),
    };
    const result = await redisClient.set(
      playbackKey(token),
      JSON.stringify(value),
      'EX',
      PLAYBACK_TTL_SECONDS,
      'NX',
    );
    if (result !== 'OK') return this.createOneTimePlayback(input);
    return token;
  }

  public async consumeOneTimePlayback(token: string): Promise<OneTimePlaybackValue | null> {
    // Đọc rồi xóa token ngay trong Redis để bảo đảm playbackUrl chỉ dùng được một lần.
    const script = `
      local value = redis.call("GET", KEYS[1])
      if value then
        redis.call("DEL", KEYS[1])
      end
      return value
    `;
    const raw = await redisClient.eval(script, 1, playbackKey(token));
    if (typeof raw !== 'string') return null;
    return JSON.parse(raw) as OneTimePlaybackValue;
  }

  public async createKeySession(input: Omit<KeySessionValue, 'createdAt'>): Promise<string> {
    // Sau khi playback token hợp lệ được consume, hệ thống tạo key session riêng để player được phép gọi API lấy AES key.
    const token = crypto.randomBytes(32).toString('base64url');
    const value: KeySessionValue = {
      ...input,
      createdAt: new Date().toISOString(),
    };
    await redisClient.setex(keySessionKey(token), KEY_SESSION_TTL_SECONDS, JSON.stringify(value));
    return token;
  }

  public async validateKeySession(token: string, videoAssetId: string, userId: string): Promise<boolean> {
    // Key session chỉ hợp lệ khi đồng thời đúng video và đúng user từ access token.
    const raw = await redisClient.get(keySessionKey(token));
    if (!raw) return false;
    try {
      const value = JSON.parse(raw) as KeySessionValue;
      return value.videoAssetId === videoAssetId && value.userId === userId;
    } catch {
      return false;
    }
  }
}

export default new PlaybackAccessService();
