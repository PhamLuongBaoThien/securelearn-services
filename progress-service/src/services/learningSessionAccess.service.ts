import crypto from 'crypto';
import redisClient from '../config/redis';
import { LearningSession, LearningSessionStatus } from '../models/learningSession.model';
import courseContextService from './courseContext.service';

export const LEARNING_LEASE_TTL_SECONDS = 30;

export type LearningLease = {
  learningSessionId: string;
  tokenHash: string;
  userId: string;
  authSessionId: string;
  clientInstanceId: string;
  courseId: string;
  courseVersionId: string;
  lessonId: string;
  videoAssetId: string;
  deviceName: string;
  startedAt: string;
  lastActiveAt: string;
  leaseVersion: number;
};

export class LearningSessionAccessError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public data?: unknown) {
    super(message);
  }
}

const activeKey = (userId: string) => `learning:active:${userId}`;
const generationKey = (userId: string) => `learning:generation:${userId}`;
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const parseLease = (raw?: string | null): LearningLease | null => {
  try { return raw ? JSON.parse(raw) as LearningLease : null; } catch { return null; }
};

const deviceNameFromUserAgent = (value?: string) => {
  const ua = String(value || '').slice(0, 512);
  const browser = /Edg\//.test(ua) ? 'Microsoft Edge' : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
      : /Version\/.*Safari/.test(ua) ? 'Safari' : '';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android'
    : /iPhone OS|CPU OS|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS'
      : /Linux/.test(ua) ? 'Linux' : '';
  return browser && os ? `${browser} trên ${os}` : 'Thiết bị không xác định';
};

const acquireScript = `
local raw = redis.call('GET', KEYS[1])
local current = nil
if raw then current = cjson.decode(raw) end
local candidate = cjson.decode(ARGV[1])
local force = ARGV[2] == '1'
if current then
  local same = current.authSessionId == candidate.authSessionId and current.clientInstanceId == candidate.clientInstanceId
  if not same and not force then return {'CONFLICT', raw} end
  if not same and force and (ARGV[3] == '' or current.learningSessionId ~= ARGV[3]) then return {'CONFLICT', raw} end
end
candidate.leaseVersion = redis.call('INCR', KEYS[2])
local nextRaw = cjson.encode(candidate)
redis.call('SET', KEYS[1], nextRaw, 'EX', ARGV[4])
if current then return {'REPLACED', raw, nextRaw} end
return {'ACQUIRED', '', nextRaw}
`;

// MongoDB chỉ lưu audit, còn Redis là nguồn quyết định quyền phát. Sau khi ghi
// audit xong, chốt lại TTL ngay trước lúc trả response. Nếu một thiết bị khác đã
// chiếm lease trong lúc chờ MongoDB thì request cũ không được ghi đè lease mới.
const finalizeAcquireScript = `
local raw = redis.call('GET', KEYS[1])
local candidate = cjson.decode(ARGV[1])
if raw then
  local current = cjson.decode(raw)
  if current.learningSessionId ~= candidate.learningSessionId
    or current.tokenHash ~= candidate.tokenHash
    or current.authSessionId ~= candidate.authSessionId
    or current.clientInstanceId ~= candidate.clientInstanceId then
    return {'STALE', raw}
  end
  candidate.leaseVersion = current.leaseVersion
else
  candidate.leaseVersion = redis.call('INCR', KEYS[2])
end
candidate.lastActiveAt = ARGV[2]
local nextRaw = cjson.encode(candidate)
redis.call('SET', KEYS[1], nextRaw, 'EX', ARGV[3])
return {'ACTIVE', nextRaw}
`;

const renewScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'EXPIRED'} end
local current = cjson.decode(raw)
if current.learningSessionId ~= ARGV[1] or current.tokenHash ~= ARGV[2] or current.authSessionId ~= ARGV[3] then
  return {'REPLACED', raw}
end
current.lastActiveAt = ARGV[4]
local nextRaw = cjson.encode(current)
redis.call('SET', KEYS[1], nextRaw, 'EX', ARGV[5])
return {'ACTIVE', nextRaw}
`;

const releaseScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.learningSessionId ~= ARGV[1] or current.tokenHash ~= ARGV[2] or current.authSessionId ~= ARGV[3] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

class LearningSessionAccessService {
  async acquire(input: {
    userId: string; userRole: string; authSessionId: string; clientInstanceId: string;
    courseId: string; lessonId: string; videoAssetId?: string; force?: boolean;
    expectedActiveSessionId?: string; userAgent?: string;
  }) {
    this.validateAcquire(input);
    await LearningSession.updateMany(
      { userId: input.userId, status: LearningSessionStatus.ACTIVE, lastHeartbeatAt: { $lt: new Date(Date.now() - LEARNING_LEASE_TTL_SECONDS * 1000) } },
      { $set: { status: LearningSessionStatus.EXPIRED, endedAt: new Date(), revokeReason: 'LEASE_EXPIRED' } },
    );
    const context = await courseContextService.getContext({ userId: input.userId, userRole: input.userRole, courseId: input.courseId });
    if (input.userRole === 'INSTRUCTOR' && context.instructorId === input.userId) {
      return { bypass: true as const, leaseExpiresIn: 0 };
    }
    if (!context.allowed) throw new LearningSessionAccessError(403, 'LEARNING_ACCESS_DENIED', context.reason || 'Bạn không có quyền học khóa học này.');
    const lesson = context.lessons.find((item) => item.lessonId === input.lessonId);
    if (!lesson || lesson.type !== 'VIDEO') throw new LearningSessionAccessError(400, 'INVALID_VIDEO_LESSON', 'Bài học video không hợp lệ.');

    const previous = parseLease(await redisClient.get(activeKey(input.userId)));
    const sameClient = previous?.authSessionId === input.authSessionId && previous.clientInstanceId === input.clientInstanceId;
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const candidate: LearningLease = {
      learningSessionId: sameClient ? previous!.learningSessionId : crypto.randomUUID(),
      tokenHash: hashToken(token), userId: input.userId, authSessionId: input.authSessionId,
      clientInstanceId: input.clientInstanceId, courseId: context.courseId,
      courseVersionId: context.courseVersionId, lessonId: input.lessonId,
      videoAssetId: String(input.videoAssetId || '').slice(0, 128),
      deviceName: deviceNameFromUserAgent(input.userAgent),
      startedAt: sameClient ? previous!.startedAt : now, lastActiveAt: now, leaseVersion: 0,
    };
    const result = await redisClient.eval(
      acquireScript, 2, activeKey(input.userId), generationKey(input.userId), JSON.stringify(candidate),
      input.force ? '1' : '0', String(input.expectedActiveSessionId || ''), String(LEARNING_LEASE_TTL_SECONDS),
    ) as string[];
    const current = parseLease(result[1]);
    if (result[0] === 'CONFLICT' && current) {
      throw new LearningSessionAccessError(409, 'LEARNING_SESSION_CONFLICT', 'Tài khoản đang phát video ở một thiết bị hoặc tab khác.', {
        activeSessionId: current.learningSessionId, deviceName: current.deviceName,
        lastActiveAt: current.lastActiveAt, sameAuthSession: current.authSessionId === input.authSessionId,
      });
    }
    const lease = parseLease(result[2] || result[1]) || candidate;
    if (current && current.learningSessionId !== lease.learningSessionId) {
      await this.markEnded(current.learningSessionId, LearningSessionStatus.REVOKED, 'REPLACED_BY_ANOTHER_SESSION');
    }
    await LearningSession.findOneAndUpdate({ sessionId: lease.learningSessionId }, {
      $set: {
        userId: input.userId, courseId: context.courseId, courseVersionId: context.courseVersionId,
        lessonId: input.lessonId, lessonType: 'VIDEO', authSessionId: input.authSessionId,
        clientInstanceId: input.clientInstanceId, videoAssetId: lease.videoAssetId,
        deviceInfo: lease.deviceName, lastHeartbeatAt: new Date(), leaseVersion: lease.leaseVersion,
        status: LearningSessionStatus.ACTIVE, endedAt: null, revokedAt: null, revokeReason: '',
      },
      $setOnInsert: { sessionId: lease.learningSessionId, startedAt: new Date() },
    }, { upsert: true, new: true });
    const finalizedResult = await redisClient.eval(
      finalizeAcquireScript, 2, activeKey(input.userId), generationKey(input.userId),
      JSON.stringify(lease), new Date().toISOString(), String(LEARNING_LEASE_TTL_SECONDS),
    ) as string[];
    const finalizedLease = parseLease(finalizedResult[1]);
    if (finalizedResult[0] !== 'ACTIVE' || !finalizedLease) {
      throw new LearningSessionAccessError(409, 'LEARNING_SESSION_CONFLICT', 'Tài khoản đang phát video ở một thiết bị hoặc tab khác.', finalizedLease ? {
        activeSessionId: finalizedLease.learningSessionId, deviceName: finalizedLease.deviceName,
        lastActiveAt: finalizedLease.lastActiveAt, sameAuthSession: finalizedLease.authSessionId === input.authSessionId,
      } : undefined);
    }
    if (finalizedLease.leaseVersion !== lease.leaseVersion) {
      void LearningSession.updateOne(
        { sessionId: finalizedLease.learningSessionId },
        { $set: { leaseVersion: finalizedLease.leaseVersion, lastHeartbeatAt: new Date() } },
      ).catch((error) => console.error('[LearningSession] Không thể đồng bộ leaseVersion:', error));
    }
    return {
      bypass: false as const, learningSessionId: finalizedLease.learningSessionId, learningSessionToken: token,
      leaseVersion: finalizedLease.leaseVersion, leaseExpiresIn: LEARNING_LEASE_TTL_SECONDS,
      replacedPreviousSession: result[0] === 'REPLACED' && !sameClient,
    };
  }

  async renew(userId: string, authSessionId: string, sessionId: string, token: string) {
    if (sessionId.length > 128 || token.length > 256) throw new LearningSessionAccessError(400, 'INVALID_LEARNING_SESSION_INPUT', 'Thông tin phiên học không hợp lệ.');
    if (!sessionId || !token) throw new LearningSessionAccessError(409, 'LEARNING_SESSION_EXPIRED', 'Phiên học đã hết hạn. Vui lòng phát lại video.');
    const result = await redisClient.eval(
      renewScript, 1, activeKey(userId), sessionId, hashToken(token), authSessionId,
      new Date().toISOString(), String(LEARNING_LEASE_TTL_SECONDS),
    ) as string[];
    if (result[0] === 'EXPIRED') {
      await this.markEnded(sessionId, LearningSessionStatus.EXPIRED, 'LEASE_EXPIRED');
      throw new LearningSessionAccessError(409, 'LEARNING_SESSION_EXPIRED', 'Phiên học đã hết hạn. Vui lòng phát lại video.');
    }
    if (result[0] !== 'ACTIVE') {
      await this.markEnded(sessionId, LearningSessionStatus.REVOKED, 'REPLACED_BY_ANOTHER_SESSION');
      throw new LearningSessionAccessError(409, 'LEARNING_SESSION_REPLACED', 'Phiên học đã được chuyển sang thiết bị hoặc tab khác.');
    }
    return parseLease(result[1])!;
  }

  async release(userId: string, authSessionId: string, sessionId: string, token: string) {
    if (!sessionId || !token || sessionId.length > 128 || token.length > 256) return false;
    const released = Number(await redisClient.eval(releaseScript, 1, activeKey(userId), sessionId, hashToken(token), authSessionId)) === 1;
    if (released) await this.markEnded(sessionId, LearningSessionStatus.ENDED, 'USER_LEFT_PLAYER');
    return released;
  }

  private async markEnded(sessionId: string, status: LearningSessionStatus, reason: string) {
    await LearningSession.findOneAndUpdate({ sessionId, status: LearningSessionStatus.ACTIVE }, {
      $set: { status, endedAt: new Date(), ...(status === LearningSessionStatus.REVOKED ? { revokedAt: new Date() } : {}), revokeReason: reason },
    });
  }

  private validateAcquire(input: { authSessionId: string; clientInstanceId: string; courseId: string; lessonId: string; videoAssetId?: string; expectedActiveSessionId?: string }) {
    if (!input.authSessionId) throw new LearningSessionAccessError(401, 'AUTH_SESSION_REQUIRED', 'Phiên đăng nhập không hợp lệ.');
    for (const [name, value] of Object.entries({ clientInstanceId: input.clientInstanceId, courseId: input.courseId, lessonId: input.lessonId, videoAssetId: input.videoAssetId || 'video', expectedActiveSessionId: input.expectedActiveSessionId || 'expected' })) {
      if (!value || value.length > 128) throw new LearningSessionAccessError(400, 'INVALID_LEARNING_SESSION_INPUT', `${name} không hợp lệ.`);
    }
  }
}

export default new LearningSessionAccessService();