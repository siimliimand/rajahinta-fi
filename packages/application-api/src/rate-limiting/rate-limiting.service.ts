/**
 * RateLimitingService — named-profile facade over a pluggable rate limiter.
 *
 * Backends implementing {@link IRateLimiter}: {@link InMemoryRateLimiter}
 * (tests / Redis-less deployments) and {@link RedisRateLimiter} (production —
 * sliding window via Redis sorted sets, shared across replicas). The
 * module selects the backend from Redis availability.
 *
 * @module RateLimitingService
 */

import { Injectable, Logger, Inject } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Window entry
// ---------------------------------------------------------------------------

/** A single request timestamp in a sliding window. */
interface WindowEntry {
  readonly timestamp: number; // ms since epoch
}

// ---------------------------------------------------------------------------
// Injection token
// ---------------------------------------------------------------------------

/** Injection token for the rate-limiter backend. */
export const RATE_LIMITER = 'RATE_LIMITER';

// ---------------------------------------------------------------------------
// Interface — replaceable
// ---------------------------------------------------------------------------

/**
 * Pluggable rate-limiter backend.
 *
 * Methods are async because the production backend is Redis; the
 * in-memory implementation (kept for tests) resolves immediately.
 */
export interface IRateLimiter {
  /**
   * Check if a request from `key` (IP / user ID) is within the allowed
   * limit for the given window configuration.
   *
   * @returns `true` if allowed, `false` if rate-limited.
   */
  check(key: string, limit: number, windowMs: number): Promise<boolean>;

  /**
   * Return the number of remaining requests for this key within the
   * current window.
   */
  remaining(key: string, limit: number, windowMs: number): Promise<number>;

  /**
   * Return the Unix timestamp (ms) when the current window resets.
   */
  resetAt(key: string, windowMs: number): Promise<number>;
}

// ---------------------------------------------------------------------------
// Named limits
// ---------------------------------------------------------------------------

/**
 * Named rate-limit profiles keyed by route purpose.
 */
export const RATE_LIMIT_PROFILES = {
  /** Default: 60 requests/min per IP/user. */
  DEFAULT: { limit: 60, windowMs: 60_000 },
  /** Calculator: 10 requests/min (higher cost per request). */
  CALCULATOR: { limit: 10, windowMs: 60_000 },
  /** Basket optimization: 10 requests/min (computationally expensive). */
  BASKET: { limit: 10, windowMs: 60_000 },
  /** Search: 30 requests/min. */
  SEARCH: { limit: 30, windowMs: 60_000 },
  /** Declaration: 20 requests/min. */
  DECLARATION: { limit: 20, windowMs: 60_000 },
  /** Historical price series: 30 requests/min (cheap materialized-summary reads). */
  HISTORICAL: { limit: 30, windowMs: 60_000 },
} as const;

export type RateLimitProfileName = keyof typeof RATE_LIMIT_PROFILES;

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limiter using an in-memory Map.
 *
 * Tracks request timestamps per key.  On each check, prunes timestamps
 * outside the current window, then rejects if the count exceeds the limit.
 * Kept for tests and for deployments without Redis — limits are
 * per-process and NOT shared across replicas.
 */
@Injectable()
export class InMemoryRateLimiter implements IRateLimiter {
  private readonly windows = new Map<string, WindowEntry[]>();
  private readonly logger = new Logger(InMemoryRateLimiter.name);

  /** Interval handle for periodic cleanup. */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Prune stale entries every 60 seconds
    this.cleanupTimer = setInterval(() => this.prune(), 60_000);
    this.cleanupTimer.unref();
  }

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    let entries = this.windows.get(key);

    if (entries === undefined) {
      entries = [];
      this.windows.set(key, entries);
    }

    // Prune expired entries
    const cutoff = now - windowMs;
    const active = entries.filter((e) => e.timestamp > cutoff);
    this.windows.set(key, active);

    if (active.length >= limit) {
      this.logger.warn(`Rate limit exceeded for key "${key}": ${active.length}/${limit}`);
      return false;
    }

    active.push({ timestamp: now });
    return true;
  }

  async remaining(key: string, limit: number, windowMs: number): Promise<number> {
    const now = Date.now();
    const cutoff = now - windowMs;
    const entries = this.windows.get(key) ?? [];
    const active = entries.filter((e) => e.timestamp > cutoff);
    return Math.max(0, limit - active.length);
  }

  async resetAt(key: string, windowMs: number): Promise<number> {
    const entries = this.windows.get(key);
    if (entries === undefined || entries.length === 0) return Date.now() + windowMs;
    const oldest = entries[0].timestamp;
    return oldest + windowMs;
  }

  /** Remove keys with no active entries from the map. */
  private prune(): void {
    for (const [key, entries] of this.windows) {
      if (entries.length === 0) {
        this.windows.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Facade over the rate-limiter backend with named profiles.
 *
 * Callers can use a named profile (e.g. `'CALCULATOR'`) or pass
 * explicit limit/windowMs for custom scenarios.
 */
@Injectable()
export class RateLimitingService {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: IRateLimiter) {}

  /**
   * Check if a request from `key` (IP / user ID) is allowed.
   *
   * @param key — client identifier (IP address, user ID, or API key)
   * @param profile — named limit profile, or `'DEFAULT'`
   * @returns `true` if allowed
   */
  async isAllowed(key: string, profile: RateLimitProfileName = 'DEFAULT'): Promise<boolean> {
    const { limit, windowMs } = RATE_LIMIT_PROFILES[profile];
    return this.limiter.check(key, limit, windowMs);
  }

  /**
   * Return the number of remaining requests for `key` within the
   * current window of the given profile.
   */
  async getRemaining(key: string, profile: RateLimitProfileName = 'DEFAULT'): Promise<number> {
    const { limit, windowMs } = RATE_LIMIT_PROFILES[profile];
    return this.limiter.remaining(key, limit, windowMs);
  }

  /**
   * Return the Unix timestamp (ms) when the rate-limit window resets.
   */
  async getResetAt(key: string, profile: RateLimitProfileName = 'DEFAULT'): Promise<number> {
    const { windowMs } = RATE_LIMIT_PROFILES[profile];
    return this.limiter.resetAt(key, windowMs);
  }

  /**
   * Extract a client key from the request context.
   *
   * `X-Forwarded-For` is trusted ONLY when the deployment is explicitly
   * configured behind a known proxy (`RATE_LIMIT_TRUST_PROXY=true`).
   * At an origin that is not so configured the header is client-controlled
   * — honouring it would let anyone bypass limits by rotating the header.
   */
  extractKey(request: { ip?: string; headers?: Record<string, string | string[] | undefined> }): string {
    if (trustForwardedFor()) {
      const forwarded = request.headers?.['x-forwarded-for'];
      if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
      }
    }
    return request.ip ?? 'unknown';
  }

  /** Configure rate-limit parameters — for testing. */
  readonly profiles = RATE_LIMIT_PROFILES;
}

/** Whether X-Forwarded-For may be trusted for client identification. */
function trustForwardedFor(): boolean {
  return process.env.RATE_LIMIT_TRUST_PROXY === 'true';
}