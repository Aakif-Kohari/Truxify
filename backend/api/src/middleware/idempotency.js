/**
 * Idempotency Middleware
 * Ensures requests with an Idempotency-Key are processed only once.
 */
import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

export const idempotencyMiddleware = async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    return next();
  }

  const cacheKey = `idempotency:${idempotencyKey}`;
  let pendingCache = null; // Moved to outer scope so it's accessible in finalize and res.json

  try {
    if (redisClient) {
      const cachedResponse = await redisClient.get(cacheKey);
      if (cachedResponse) {
        const parsed = JSON.parse(cachedResponse);
        return res.status(parsed.status).json(parsed.body);
      }

      // Acquire lock / pending status
      pendingCache = { timestamp: Date.now() };
      await redisClient.set(cacheKey, JSON.stringify(pendingCache), 'EX', 60);
    }

    const originalJson = res.json.bind(res);
    res.json = async (body) => {
      const responseData = {
        status: res.statusCode,
        body: body,
      };

      if (redisClient) {
        try {
          await redisClient.set(cacheKey, JSON.stringify(responseData), 'EX', 86400);
        } catch (err) {
          logger.error(`Failed to cache idempotency response: ${err.message}`);
        }
      }

      return originalJson(body);
    };

    next();
  } catch (error) {
    logger.error(`Idempotency middleware error: ${error.message}`);
    next();
  }
};