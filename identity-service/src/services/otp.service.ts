/**
 * Quản lý OTP dùng chung cho đăng ký, đổi và khôi phục mật khẩu qua email.
 * Mã được tạo bằng crypto, chỉ lưu bản băm trong Redis, có thời hạn, giới hạn gửi
 * và giới hạn số lần nhập sai. Mã hợp lệ bị xoá sau khi sử dụng thành công.
 * Service này không xử lý OTP qua SMS và không hỗ trợ đổi email tài khoản.
 */
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import redisClient from '../config/redis';
type OtpRecord<T> = { digest: string; attempts: number; payload: T };
class OtpService {
  private digest(scope: string, target: string, otp: string): string {
    const secret = process.env.OTP_SECRET || process.env.ACCESS_TOKEN || 'securelearn-development-otp-secret';
    return createHmac('sha256', secret).update(`${scope}:${target}:${otp}`).digest('hex');
  }
  private key(scope: string, target: string): string { return `otp:${scope}:${target}`; }
  // Tạo OTP mới, lưu bản băm trong Redis và trả về mã gốc (dùng cho bước gửi OTP).
  public async issue<T>(scope: string, target: string, payload: T, ttlSeconds = 300): Promise<string> {
    const cooldownKey = `otp:cooldown:${scope}:${target}`;
    const allowed = await redisClient.set(cooldownKey, '1', 'EX', 60, 'NX');
    if (!allowed) throw new Error('Vui lòng chờ 60 giây trước khi yêu cầu mã mới.');
    const rateKey = `otp:rate:${scope}:${target}`;
    const sends = await redisClient.incr(rateKey);
    if (sends === 1) await redisClient.expire(rateKey, 3600);
    if (sends > 5) { await redisClient.del(cooldownKey); throw new Error('Bạn đã yêu cầu quá nhiều mã OTP. Vui lòng thử lại sau.'); }
    const otp = randomInt(100000, 1000000).toString();
    await redisClient.setex(this.key(scope, target), ttlSeconds, JSON.stringify({ digest: this.digest(scope, target, otp), attempts: 0, payload }));
    if (process.env.NODE_ENV !== 'production') console.log(`[OTP:${scope}] ${target}: ${otp}`);
    return otp;
  }
  /** Kiểm tra OTP mà không xoá khỏi Redis (dùng cho bước verify trung gian). */
  public async check<T>(scope: string, target: string, otp: string): Promise<T> {
    const key = this.key(scope, target);
    const raw = await redisClient.get(key);
    if (!raw) throw new Error('Mã OTP đã hết hạn hoặc không tồn tại. Vui lòng yêu cầu lại.');
    const record = JSON.parse(raw) as OtpRecord<T>;
    const expected = Buffer.from(record.digest, 'hex');
    const received = Buffer.from(this.digest(scope, target, otp), 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      record.attempts += 1;
      if (record.attempts >= 5) { await redisClient.del(key); throw new Error('Bạn đã nhập sai OTP quá số lần cho phép. Vui lòng yêu cầu mã mới.'); }
      const ttl = await redisClient.ttl(key);
      if (ttl > 0) await redisClient.setex(key, ttl, JSON.stringify(record));
      throw new Error('Mã OTP không chính xác.');
    }
    return record.payload;
  }
  /** Xác thực OTP và xoá khỏi Redis (consume — dùng cho bước cuối cùng). */
  public async verify<T>(scope: string, target: string, otp: string): Promise<T> {
    const key = this.key(scope, target);
    const raw = await redisClient.get(key);
    if (!raw) throw new Error('Mã OTP đã hết hạn hoặc không tồn tại. Vui lòng yêu cầu lại.');
    const record = JSON.parse(raw) as OtpRecord<T>;
    const expected = Buffer.from(record.digest, 'hex');
    const received = Buffer.from(this.digest(scope, target, otp), 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      record.attempts += 1;
      if (record.attempts >= 5) { await redisClient.del(key); throw new Error('Bạn đã nhập sai OTP quá số lần cho phép. Vui lòng yêu cầu mã mới.'); }
      const ttl = await redisClient.ttl(key);
      if (ttl > 0) await redisClient.setex(key, ttl, JSON.stringify(record));
      throw new Error('Mã OTP không chính xác.');
    }
    await redisClient.del(key);
    return record.payload;
  }
}
export default new OtpService();
