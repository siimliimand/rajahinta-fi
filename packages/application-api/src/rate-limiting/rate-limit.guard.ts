/**
 * RateLimitGuard — NestJS guard that enforces rate limits on routes.
 *
 * Usage:
 * ```typescript
 * @UseGuards(RateLimitGuard)
 * @RateLimit('CALCULATOR')
 * @Post()
 * async expensiveEndpoint() { … }
 * ```
 *
 * Returns HTTP 429 with Retry-After header when limit is exceeded.
 *
 * @module RateLimitGuard
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitingService, RateLimitProfileName } from './rate-limiting.service';

// ---------------------------------------------------------------------------
// Metadata key and decorator
// ---------------------------------------------------------------------------

export const RATE_LIMIT_KEY = 'rate_limit_profile';

/**
 * Decorator that sets the rate-limit profile for a route.
 *
 * @example
 * ```typescript
 * @RateLimit('CALCULATOR')
 * @Post()
 * async calculate() { … }
 * ```
 */
export const RateLimit = (profile: RateLimitProfileName) =>
  SetMetadata(RATE_LIMIT_KEY, profile);

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Rate-limit guard that checks every incoming request against the
 * configured profile.
 *
 * When the route has no @RateLimit decorator, the guard defaults to
 * the DEFAULT profile (60 req/min).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimitingService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const profile =
      this.reflector.getAllAndOverride<RateLimitProfileName>(
        RATE_LIMIT_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? 'DEFAULT';

    const request = context.switchToHttp().getRequest();
    const key = this.rateLimiter.extractKey(request);

    if (!this.rateLimiter.isAllowed(key, profile)) {
      const retryAfter = Math.ceil(
        (this.rateLimiter.getResetAt(key, profile) - Date.now()) / 1000,
      );

      // Set Retry-After header on the response
      const res = context.switchToHttp().getResponse();
      if (res && typeof res.header === 'function') {
        res.header('Retry-After', String(retryAfter));
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
          error: 'TooManyRequests',
          retryAfterSeconds: retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}