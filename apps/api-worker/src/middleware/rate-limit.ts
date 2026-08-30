/**
 * Rate-limit middleware — Hono port of RateLimitGuard + the @RateLimit
 * profile decorator (packages/application-api/src/rate-limiting/, Worker
 * port task 3.5; the RateLimiterDO backend landed in task 3.3).
 *
 * Profiles, limits, and the 429 payload mirror the Nest guard exactly:
 * DEFAULT 60/min, CALCULATOR 10/min, BASKET 10/min, SEARCH 30/min,
 * DECLARATION 20/min, HISTORICAL 30/min. The client key is the edge-attested
 * `CF-Connecting-IP` (design D5 — RATE_LIMIT_TRUST_PROXY semantics were
 * removed with task 3.3; X-Forwarded-For is never read), windowed per
 * profile like the Nest service's `${profile}:${key}` composition.
 *
 * Admission runs through RateLimiterDO — the exact sliding window that
 * replaced the Redis limiter. When the RATE_LIMITER binding is absent the
 * middleware no-ops: the Worker unit-test harnesses (fake D1, no DO
 * bindings) exercise guard/route parity, and an unconfigured binding must
 * fail open HERE rather than 500ing every request (the deployment always
 * binds the DO — wrangler.jsonc).
 *
 * Registration order matters: Nest runs RateLimitGuard first in every
 * guard list, so the route ports register this middleware ahead of the
 * task-3.2 guard prefixes (see src/index.ts).
 *
 * @module rate-limit
 */

import type { MiddlewareHandler } from 'hono';
import { ApiHttpError } from '../errors';
import type { AppEnv } from '../env';
import { checkRateLimit, type RateLimitParams } from '../do/client';
import { resolveClientIdentity } from '../do/identity';

/** Named limits — RATE_LIMIT_PROFILES parity (rate-limiting.service.ts). */
export const RATE_LIMIT_PROFILES = {
  DEFAULT: { limit: 60, windowMs: 60_000 },
  CALCULATOR: { limit: 10, windowMs: 60_000 },
  BASKET: { limit: 10, windowMs: 60_000 },
  SEARCH: { limit: 30, windowMs: 60_000 },
  DECLARATION: { limit: 20, windowMs: 60_000 },
  HISTORICAL: { limit: 30, windowMs: 60_000 },
} as const;

export type RateLimitProfileName = keyof typeof RATE_LIMIT_PROFILES;

/**
 * One admission check per request against the client's DO instance.
 * Rejection carries the guard's exact 429 body (message, error label,
 * retryAfterSeconds) plus the Retry-After header.
 */
export function requireRateLimit(
  profile: RateLimitProfileName,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.env.RATE_LIMITER) {
      // No DO binding — see module doc. Dev harnesses and unit tests.
      await next();
      return;
    }

    const { limit, windowMs } = RATE_LIMIT_PROFILES[profile];
    const params: RateLimitParams = { profile, limit, windowMs };
    const clientKey = resolveClientIdentity(c.req.raw.headers);
    const decision = await checkRateLimit(c.env, clientKey, params);

    if (decision.allowed) {
      await next();
      return;
    }

    const retryAfter =
      decision.retryAfterSeconds ??
      Math.max(0, Math.ceil((decision.resetAtMs - Date.now()) / 1000));
    c.header('Retry-After', String(retryAfter));
    throw new ApiHttpError(429, {
      statusCode: 429,
      message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
      error: 'TooManyRequests',
      retryAfterSeconds: retryAfter,
    });
  };
}
