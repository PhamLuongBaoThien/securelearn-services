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

// Helper để tạo key trong Redis
const keyFor = (userId: string, courseId: string): string =>
  `entitlement:v1:user:${userId}:course:${courseId}`;

// Tính toán thời gian sống (TTL) cho mỗi key để tránh cache stale
const ttlFor = (value: EntitlementCacheValue): number => {
  if (!value.allowed) return NEGATIVE_TTL_SECONDS;
  if (value.source === 'PURCHASE') return 7 * 24 * 60 * 60;
  if (!value.accessEndsAt) return SUBSCRIPTION_MAX_TTL_SECONDS;
  return Math.min(
    SUBSCRIPTION_MAX_TTL_SECONDS,
    Math.max(0, Math.floor((value.accessEndsAt.getTime() - Date.now()) / 1000)),
  ); // Lấy thời gian còn lại của subscription nhưng tối đa 15 phút để tránh cache lâu khi hết hạn đột ngột
};

class EntitlementCacheService {
  // Lấy quyền xem từ cache Redis
  public async get(userId: string, courseId: string): Promise<EntitlementCacheValue | null> {
    try {
      // Đọc từ Redis cache xem cặp (Học viên này + Khóa học này) đã được xác thực quyền xem chưa
      const raw = await redisClient.get(keyFor(userId, courseId));
      if (!raw) return null; // Không có cache (Cache Miss)
      const parsed = JSON.parse(raw) as StoredEntitlement;
      const accessEndsAt = parsed.accessEndsAt ? new Date(parsed.accessEndsAt) : null; // Chuyển đổi chuỗi ngày tháng sang Date object
      if (parsed.allowed && parsed.source === 'SUBSCRIPTION' && accessEndsAt && accessEndsAt <= new Date()) { // Kiểm tra subscription đã hết hạn chưa
        await redisClient.del(keyFor(userId, courseId)); // Xóa cache nếu subscription đã hết hạn
        return null; // Trả về null để buộc phải gọi gRPC kiểm tra lại
      }
      return { ...parsed, accessEndsAt }; // Cache Hit, trả về dữ liệu đã cache
    } catch (error) {
      console.warn('[MediaEntitlementCache] Không thể đọc Redis entitlement:', error);
      return null;
    }
  }

  // Lưu quyền xem vào cache Redis
  public async set(userId: string, courseId: string, value: EntitlementCacheValue): Promise<void> {
    const ttl = ttlFor(value); // Tính toán thời gian sống (TTL) cho mỗi key để tránh cache stale
    if (ttl <= 0) return; // Nếu TTL <= 0 thì không lưu vào cache
    // Tạo object để lưu vào cache
    const stored: StoredEntitlement = {
      ...value,
      accessEndsAt: value.accessEndsAt ? value.accessEndsAt.toISOString() : null,
    };
    await redisClient.setex(keyFor(userId, courseId), ttl, JSON.stringify(stored)); // Lưu vào cache Redis
  }
}

export default new EntitlementCacheService();
