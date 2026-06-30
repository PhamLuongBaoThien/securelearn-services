import Redis from 'ioredis';
const redisClient = new Redis(process.env.REDIS_URI || 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
redisClient.on('error', (error) => console.error('[Notification Redis]', error.message));
export default redisClient;

