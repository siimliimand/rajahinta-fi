/**
 * RedisModule — optional shared Redis client for production caching.
 *
 * Reads connection configuration from environment variables:
 *   - `REDIS_URL`          (full connection URL, e.g. `redis://localhost:6379`)
 *   - `REDIS_HOST`         (host, default `localhost`)
 *   - `REDIS_PORT`         (port, default `6379`)
 *
 * When `REDIS_URL` is set it takes precedence.  If neither `REDIS_URL` nor
 * `REDIS_HOST` is set, the module provides `null` — consumers should fall
 * back to in-memory implementations.
 *
 * The module is `@Global()` so a single Redis connection is shared across
 * all feature modules without explicit imports.
 *
 * @module RedisModule
 */

import { Global, Module, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/** Build a Redis connection URL from host/port env vars. */
function resolveRedisUrl(): string | null {
  // 1. Explicit URL wins
  const url = process.env.REDIS_URL?.trim();
  if (url) return url;

  // 2. Build from host + port
  const host = process.env.REDIS_HOST?.trim();
  if (!host) return null; // Nothing configured — Redis is unavailable

  const port = process.env.REDIS_PORT?.trim() ?? '6379';
  return `redis://${host}:${port}`;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis | null => {
        const redisUrl = resolveRedisUrl();
        if (!redisUrl) {
          Logger.log('Redis not configured — using in-memory fallbacks', 'RedisModule');
          return null;
        }
        Logger.log(`Connecting to Redis at ${redisUrl}`, 'RedisModule');
        return new Redis(redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: null,
          enableOfflineQueue: true,
          retryStrategy(times) {
            // Exponential backoff capped at 30 seconds
            return Math.min(times * 200, 30_000);
          },
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(private readonly redisClient: Redis | null) {}

  /** Gracefully disconnect from Redis on application shutdown. */
  async onModuleDestroy(): Promise<void> {
    if (this.redisClient) {
      this.logger.log('Disconnecting from Redis');
      await this.redisClient.quit();
    }
  }
}

export { REDIS_CLIENT } from './redis.constants';