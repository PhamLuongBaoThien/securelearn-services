import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';

const redisClient = new Redis(REDIS_URI, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    console.warn(`[Redis] Retrying connection: attempt ${times}`);
    return Math.min(times * 50, 2000); // thời gian chờ giữa các lần thử lại, tăng dần theo số lần thử (tối đa 2 giây)
  },
});

redisClient.on('connect', () => {
  console.log('Redis Connected Successfully');
});

redisClient.on('error', (err) => {
  console.error('[Redis Error] ', err);
});

export default redisClient;
