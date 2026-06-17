import redisClient from '../config/redis';

export type EntitlementCacheValue = {
  allowed: boolean;
  source?: 'PURCHASE' | 'SUBSCRIPTION';
  reason?: string;
  termId?: string;
  accessEndsAt?: Date | null;
  cachedAt: string;
};

type StoredEntitlement = Omit<EntitlementCacheValue, 'accessEndsAt'> & {
  accessEndsAt?: string | null;
};

const SUBSCRIPTION_MAX_TTL_SECONDS = 15 * 60;
const NEGATIVE_TTL_SECONDS = 30;

const keyFor = (userId: string, courseId: string): string =>
  `entitlement:v1:user:${userId}:course:${courseId}`;

const ttlFor = (value: EntitlementCacheValue): number => {
  if (!value.allowed) return NEGATIVE_TTL_SECONDS;
  if (value.source === 'PURCHASE') return 7 * 24 * 60 * 60;
  if (!value.accessEndsAt) return SUBSCRIPTION_MAX_TTL_SECONDS;
  return Math.min(
    SUBSCRIPTION_MAX_TTL_SECONDS,
    Math.max(0, Math.floor((value.accessEndsAt.getTime() - Date.now()) / 1000)),
  );
};

class EntitlementCacheService {
  public async get(userId: string, courseId: string): Promise<EntitlementCacheValue | null> {
    try {
      const raw = await redisClient.get(keyFor(userId, courseId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredEntitlement;
      const accessEndsAt = parsed.accessEndsAt ? new Date(parsed.accessEndsAt) : null;
      if (parsed.allowed && parsed.source === 'SUBSCRIPTION' && accessEndsAt && accessEndsAt <= new Date()) {
        await redisClient.del(keyFor(userId, courseId));
        return null;
      }
      return { ...parsed, accessEndsAt };
    } catch (error) {
      console.warn('[MediaEntitlementCache] Không thể đọc Redis entitlement:', error);
      return null;
    }
  }

  public async set(userId: string, courseId: string, value: EntitlementCacheValue): Promise<void> {
    const ttl = ttlFor(value);
    if (ttl <= 0) return;
    const stored: StoredEntitlement = {
      ...value,
      accessEndsAt: value.accessEndsAt ? value.accessEndsAt.toISOString() : null,
    };
    await redisClient.setex(keyFor(userId, courseId), ttl, JSON.stringify(stored));
  }
}

export default new EntitlementCacheService();
