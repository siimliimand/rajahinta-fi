/**
 * IdempotencyModule — provides version-keyed calculation caching.
 *
 * Registers the in-memory cache as the idempotency cache implementation.
 * Replace the provider binding to switch to Redis or another distributed store.
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
export { hashInput } from './idempotency.service';
export type { CacheKeyInput, IdempotencyOptions } from './idempotency.service';