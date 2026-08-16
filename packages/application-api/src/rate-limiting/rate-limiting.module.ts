/**
 * RateLimitingModule — provides rate-limiting infrastructure.
 *
 * Registers the in-memory rate limiter as rate-limiter backend.
 * Replace the provider binding to switch to Redis in production.
 *
 * @module RateLimitingModule
 */

import { Module, Global } from '@nestjs/common';
import { RateLimitingService, InMemoryRateLimiter, RATE_LIMITER } from './rate-limiting.service';
import { RateLimitGuard } from './rate-limit.guard';

@Global()
@Module({
  providers: [
    RateLimitingService,
    RateLimitGuard,
    { provide: RATE_LIMITER, useClass: InMemoryRateLimiter },
  ],
  exports: [RateLimitingService, RateLimitGuard],
})
export class RateLimitingModule {}

export { RateLimitingService, InMemoryRateLimiter, RATE_LIMITER, RATE_LIMIT_PROFILES } from './rate-limiting.service';
export { RateLimitGuard, RateLimit } from './rate-limit.guard';
export type { RateLimitProfileName } from './rate-limiting.service';