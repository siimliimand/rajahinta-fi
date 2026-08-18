/**
 * IdempotencyModule — provides version-keyed calculation caching.
 *
 * Uses `RedisIdempotencyCache` when a Redis client is available (provided
 * by `RedisModule`), falling back to `InMemoryIdempotencyCache` otherwise.
 *
 * @module IdempotencyModule
 */

import { Module } from '@nestjs/common';
import { IdempotencyService, InMemoryIdempotencyCache, IDEMPOTENCY_CACHE } from './idempotency.service';
import { RedisIdempotencyCache } from './redis-idempotency-cache';
import { RedisModule, REDIS_CLIENT } from '../redis';
import type Redis from 'ioredis';

@Module({
  imports: [RedisModule],
  providers: [
    IdempotencyService,
    {
      provide: IDEMPOTENCY_CACHE,
      useFactory: (redisClient: Redis | null) => {
        if (redisClient) {
          return new RedisIdempotencyCache({ client: redisClient });
        }
        return new InMemoryIdempotencyCache();
      },
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}

export { IdempotencyService, InMemoryIdempotencyCache, IDEMPOTENCY_CACHE } from './idempotency.service';
export { RedisIdempotencyCache } from './redis-idempotency-cache';
export type { RedisIdempotencyOptions } from './redis-idempotency-cache';
export { hashInput } from './idempotency.service';
export type { CacheKeyInput, IdempotencyOptions } from './idempotency.service';