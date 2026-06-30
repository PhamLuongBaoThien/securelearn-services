import crypto from 'crypto';
import redisClient from '../config/redis';
import learningLeaseService from './learningLease.service';

type PlaybackLeaseReference = {
  bypassLearningLease: boolean;
  learningSessionId?: string;
  learningTokenHash?: string;
  authSessionId?: string;
  clientInstanceId?: string;
};

type OneTimePlaybackValue = PlaybackLeaseReference & {
  userId: string;
  videoAssetId: string;
  courseId: string;
  lessonId: string;
  source?: string;
  createdAt: string;
};

type KeySessionValue = PlaybackLeaseReference & {
  userId: string;
  videoAssetId: string;
  courseId: string;
  lessonId: string;
  createdAt: string;
};

const PLAYBACK_TTL_SECONDS = 60;
const KEY_SESSION_TTL_SECONDS = 60 * 60;
const SEGMENT_TICKET_TTL_SECONDS = 60 * 60;
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const playbackKey = (token: string) => `playback:one-time:${hashToken(token)}`;
const keySessionKey = (token: string) => `playback:key-session:${hashToken(token)}`;
const segmentSecret = () => process.env.PLAYBACK_SEGMENT_SECRET || process.env.ACCESS_TOKEN || 'securelearn-segment-development-secret';

class PlaybackAccessService {
  async createOneTimePlayback(input: Omit<OneTimePlaybackValue, 'createdAt'>): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    const value = { ...input, createdAt: new Date().toISOString() };
    const result = await redisClient.set(playbackKey(token), JSON.stringify(value), 'EX', PLAYBACK_TTL_SECONDS, 'NX');
    return result === 'OK' ? token : this.createOneTimePlayback(input);
  }

  async consumeOneTimePlayback(token: string): Promise<OneTimePlaybackValue | null> {
    const script = `local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]) end; return value`;
    const raw = await redisClient.eval(script, 1, playbackKey(token));
    if (typeof raw !== 'string') return null;
    return JSON.parse(raw) as OneTimePlaybackValue;
  }

  async createKeySession(input: Omit<KeySessionValue, 'createdAt'>): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await redisClient.setex(keySessionKey(token), KEY_SESSION_TTL_SECONDS, JSON.stringify({ ...input, createdAt: new Date().toISOString() }));
    return token;
  }

  async validatePlaybackReference(value: PlaybackLeaseReference & { userId: string; videoAssetId: string; courseId: string; lessonId: string }) {
    if (value.bypassLearningLease) return true;
    if (!value.learningSessionId || !value.clientInstanceId) return false;
    const rawLease = await redisClient.get(`learning:active:${value.userId}`);
    if (!rawLease) return false;
    try {
      const lease = JSON.parse(rawLease) as { learningSessionId?: string; authSessionId?: string; clientInstanceId?: string; courseId?: string; courseVersionId?: string; lessonId?: string; videoAssetId?: string };
      return lease.learningSessionId === value.learningSessionId
        && lease.clientInstanceId === value.clientInstanceId
        && (lease.courseId === value.courseId || lease.courseVersionId === value.courseId)
        && lease.lessonId === value.lessonId
        && (!lease.videoAssetId || lease.videoAssetId === value.videoAssetId);
    } catch {
      return false;
    }
  }

  async validateKeySession(
    token: string,
    videoAssetId: string,
    userId: string,
    authSessionId?: string,
    clientInstanceId?: string,
    options: { requireClientInstance?: boolean } = {},
  ): Promise<KeySessionValue | null> {
    const raw = await redisClient.get(keySessionKey(token));
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as KeySessionValue;
      if (value.videoAssetId !== videoAssetId || value.userId !== userId) return null;
      if (value.bypassLearningLease) return value;
      if (!value.authSessionId || value.authSessionId !== authSessionId) return null;
      if (options.requireClientInstance !== false && (!value.clientInstanceId || value.clientInstanceId !== clientInstanceId)) return null;
      const currentLease = await redisClient.get(`learning:active:${value.userId}`);
      if (!currentLease) return null;
      const lease = JSON.parse(currentLease) as { learningSessionId?: string; authSessionId?: string; clientInstanceId?: string; courseId?: string; courseVersionId?: string; lessonId?: string; videoAssetId?: string };
      if (!value.learningSessionId || lease.learningSessionId !== value.learningSessionId || lease.authSessionId !== value.authSessionId || lease.clientInstanceId !== value.clientInstanceId || (lease.courseId !== value.courseId && lease.courseVersionId !== value.courseId) || lease.lessonId !== value.lessonId || (lease.videoAssetId && lease.videoAssetId !== value.videoAssetId)) return null;
      return value;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  createSegmentTicket(videoAssetId: string, objectKey: string): string {
    const payload = Buffer.from(JSON.stringify({ videoAssetId, objectKey, exp: Date.now() + SEGMENT_TICKET_TTL_SECONDS * 1000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', segmentSecret()).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  verifySegmentTicket(ticket: string, videoAssetId: string): string | null {
    const [payload, signature] = ticket.split('.');
    if (!payload || !signature) return null;
    const expected = crypto.createHmac('sha256', segmentSecret()).update(payload).digest('base64url');
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { videoAssetId: string; objectKey: string; exp: number };
      if (value.videoAssetId !== videoAssetId || value.exp < Date.now()) return null;
      return value.objectKey;
    } catch { return null; }
  }
}

export default new PlaybackAccessService();
