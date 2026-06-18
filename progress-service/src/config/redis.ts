import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = new Redis(process.env.REDIS_URI || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
});

redisClient.on('connect', () => console.log('Redis connected (Progress Service)'));
redisClient.on('error', (error) => console.error('Redis error (Progress Service):', error));

export default redisClient;
