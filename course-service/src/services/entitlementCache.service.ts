import redisClient from '../config/redis';
import { EnrollmentSource } from '../models/enrollment.model';

export type EntitlementCacheSource = EnrollmentSource.PURCHASE | EnrollmentSource.SUBSCRIPTION;

export type EntitlementCacheValue = {
  allowed: boolean;
  source?: EntitlementCacheSource;
  reason?: string;
  termId?: string;
  accessEndsAt?: Date | null;
  cachedAt: string;
};

type EntitlementCacheStoredValue = Omit<EntitlementCacheValue, 'accessEndsAt'> & {
  accessEndsAt?: string | null;
};

const PURCHASE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SUBSCRIPTION_MAX_TTL_SECONDS = 15 * 60;
const NEGATIVE_TTL_SECONDS = 30;

const keyFor = (userId: string, courseId: string): string =>
  `entitlement:v1:user:${userId}:course:${courseId}`;

const secondsUntil = (date?: Date | null): number => {
  if (!date) return SUBSCRIPTION_MAX_TTL_SECONDS;
  return Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000));
};

class EntitlementCacheService {
  public key(userId: string, courseId: string): string {
    return keyFor(userId, courseId);
  }

  public async get(userId: string, courseId: string): Promise<EntitlementCacheValue | null> {
    const raw = await redisClient.get(this.key(userId, courseId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as EntitlementCacheStoredValue;
      const accessEndsAt = parsed.accessEndsAt ? new Date(parsed.accessEndsAt) : null;
      if (parsed.allowed && parsed.source === EnrollmentSource.SUBSCRIPTION && accessEndsAt && accessEndsAt <= new Date()) {
        await this.del(userId, courseId);
        return null;
      }
      return { ...parsed, accessEndsAt };
    } catch {
      await this.del(userId, courseId);
      return null;
    }
  }

  public async setAllowed(input: {
    userId: string;
    courseId: string;
    source: EntitlementCacheSource;
    termId?: string;
    accessEndsAt?: Date | null;
  }): Promise<void> {
    const ttl = input.source === EnrollmentSource.PURCHASE
      ? PURCHASE_TTL_SECONDS
      : Math.min(SUBSCRIPTION_MAX_TTL_SECONDS, secondsUntil(input.accessEndsAt));

    if (ttl <= 0) {
      await this.del(input.userId, input.courseId);
      return;
    }

    const value: EntitlementCacheStoredValue = {
      allowed: true,
      source: input.source,
      termId: input.termId || undefined,
      accessEndsAt: input.accessEndsAt ? input.accessEndsAt.toISOString() : null,
      cachedAt: new Date().toISOString(),
    };
    await redisClient.setex(this.key(input.userId, input.courseId), ttl, JSON.stringify(value));
  }

  public async setDenied(userId: string, courseId: string, reason: string): Promise<void> {
    const value: EntitlementCacheStoredValue = {
      allowed: false,
      reason,
      cachedAt: new Date().toISOString(),
    };
    await redisClient.setex(this.key(userId, courseId), NEGATIVE_TTL_SECONDS, JSON.stringify(value));
  }

  public async del(userId: string, courseId: string): Promise<void> {
    await redisClient.del(this.key(userId, courseId));
  }
}

export default new EntitlementCacheService();
