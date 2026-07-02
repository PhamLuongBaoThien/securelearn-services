import Redis from 'ioredis';
const redisClient = new Redis(process.env.REDIS_URI || 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 2 });
export default redisClient;
