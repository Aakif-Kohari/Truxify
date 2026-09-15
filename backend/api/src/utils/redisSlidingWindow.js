import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: redisUrl });

redisClient.on('error', (err) => console.error('Redis Client Error in RateLimiter', err));

const connectRedis = async () => {
    if (!redisClient.isOpen) {
        try {
            await redisClient.connect();
        } catch (err) {
            console.error('Failed to connect to Redis for rate limiting:', err.message);
            throw err;
        }
    }
};

const SLIDING_WINDOW_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  
  redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
  local count = redis.call('ZCARD', key)
  
  if count < limit then
    redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
    redis.call('PEXPIRE', key, window)
    return 1
  else
    return 0
  end
`;

let scriptSha = null;

const loadScript = async () => {
    await connectRedis();
    if (!scriptSha) {
        scriptSha = await redisClient.scriptLoad(SLIDING_WINDOW_SCRIPT);
    }
    return scriptSha;
};

export const checkRateLimit = async (key, windowMs, maxRequests) => {
    try {
        await connectRedis();
        const sha = await loadScript();
        const now = Date.now();

        const result = await redisClient.evalSha(sha, {
            keys: [key],
            arguments: [now.toString(), windowMs.toString(), maxRequests.toString()],
        });

        return result === 1;
    } catch (err) {
        console.warn('Redis rate limit check failed, falling back to memory/allow:', err.message);
        return true;
    }
};

export { redisClient };

export default {
    checkRateLimit,
    redisClient,
};

