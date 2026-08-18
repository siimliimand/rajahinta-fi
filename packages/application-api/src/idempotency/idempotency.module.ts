/**
 * IdempotencyModule — provides version-keyed calculation caching.
 *
 * Registers the in-memory cache as the default idempotency cache backend.
 * Replace the provider binding to switch to RedisIdempotencyCache or another
 * distributed store (see `redis-idempotency-cache.ts`).
 *
 * ```typescript
 * // To use Redis instead:
 * {
 *   provide: IDEMPOTENCY_CACHE,
 *   useFactory: () => new RedisIdempotencyCache({ url: process.env.REDIS_URL }),
 * }
 * ```
 *
 * @module IdempotencyModule
 */

import { Module } from '@nestjs/common';
import { IdempotencyService, InMemoryIdempotencyCache, IDEMPOTENCY_CACHE } from './idempotency.service';

@Module({
  providers: [
    IdempotencyService,
    { provide: IDEMPOTENCY_CACHE, useClass: InMemoryIdempotencyCache },
  ],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}

export { IdempotencyService, InMemoryIdempotencyCache, IDEMPOTENCY_CACHE } from './idempotency.service';
export { RedisIdempotencyCache } from './redis-idempotency-cache';
export type { RedisIdempotencyOptions } from './redis-idempotency-cache';
export { hashInput } from './idempotency.service';
export type { CacheKeyInput, IdempotencyOptions } from './idempotency.service';