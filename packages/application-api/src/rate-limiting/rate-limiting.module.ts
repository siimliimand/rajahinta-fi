/**
 * RateLimitingModule — provides rate-limiting infrastructure.
 *
 * Binds the RATE_LIMITER backend to the Redis sorted-set implementation
 * when the shared Redis client is configured (limits shared across
 * replicas), and to the in-memory implementation otherwise (tests,
 * Redis-less local runs). The REDIS_CLIENT injection is optional so
 * test modules that never register RedisModule still instantiate.
 *
 * @module RateLimitingModule
 */

import { Module, Global } from '@nestjs/common';
import { RateLimitingService, InMemoryRateLimiter, RATE_LIMITER } from './rate-limiting.service';
import { RedisRateLimiter } from './redis-rate-limiter';
import { RateLimitGuard } from './rate-limit.guard';
import { REDIS_CLIENT } from '../redis';
import type Redis from 'ioredis';

@Global()
@Module({
  providers: [
    RateLimitingService,
    RateLimitGuard,
    {
      // Backend selected by Redis availability. RedisRateLimiter is
      // constructed here (not as a plain provider) because it rejects a
      // null client — registering it unconditionally would break
      // Redis-less bootstrap.
      provide: RATE_LIMITER,
      useFactory: (redis: Redis | null): IRateLimiterBackend =>
        redis === null || redis === undefined
          ? new InMemoryRateLimiter()
          : new RedisRateLimiter(redis),
      inject: [{ token: REDIS_CLIENT, optional: true }],
    },
  ],
  exports: [RateLimitingService, RateLimitGuard],
})
export class RateLimitingModule {}

type IRateLimiterBackend = InstanceType<typeof RedisRateLimiter> | InstanceType<typeof InMemoryRateLimiter>;

export { RateLimitingService, InMemoryRateLimiter, RATE_LIMITER, RATE_LIMIT_PROFILES } from './rate-limiting.service';
export { RedisRateLimiter } from './redis-rate-limiter';
export { RateLimitGuard, RateLimit } from './rate-limit.guard';
export type { RateLimitProfileName, IRateLimiter } from './rate-limiting.service';
