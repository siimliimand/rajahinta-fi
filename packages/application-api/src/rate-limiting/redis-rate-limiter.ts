/**
 * RedisRateLimiter — sliding-window rate limiter backed by Redis sorted
 * sets.
 *
 * One sorted set per client key (`ratelimit:{key}`); members are request
 * timestamps, scored by their ms epoch time. Admission check and
 * registration run as a single Lua script so the window is atomic under
 * concurrency and the limit is shared across all replicas pointing at
 * the same Redis.
 *
 * Failure mode: if Redis is unreachable the limiter FAILS OPEN (allows
 * the request) and logs an error. Rate limiting protects the service;
 * a Redis outage must not turn into a self-inflicted outage — readiness
 * already stops traffic distribution to pods with a dead Redis.
 *
 * @module RedisRateLimiter
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis';
import type { IRateLimiter } from './rate-limiting.service';

/**
 * Atomic sliding-window admission.
 *
 * KEYS[1] — window set
 * ARGV[1] — now (ms)          ARGV[2] — window length (ms)
 * ARGV[3] — limit             ARGV[4] — unique member for this request
 *
 * Returns 1 when admitted (member recorded), 0 when rate-limited.
 */
const ADMIT_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  return 0
end
redis.call('ZADD', KEYS[1], tonumber(ARGV[1]), ARGV[4])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`;

/** Per-request unique member: timestamp plus counter plus random tail. */
let memberCounter = 0;
function uniqueMember(now: number): string {
  memberCounter = (memberCounter + 1) % 1_000_000;
  // Random tail — two replicas admitting in the same millisecond must not
  // produce identical members (ZADD would merge them and undercount).
  return `${now}:${memberCounter}:${Math.random().toString(36).slice(2, 10)}`;
}

function windowKey(key: string): string {
  return `ratelimit:${key}`;
}

@Injectable()
export class RedisRateLimiter implements IRateLimiter {
  private readonly logger = new Logger(RedisRateLimiter.name);
  private readonly redis: Redis;

  constructor(@Inject(REDIS_CLIENT) @Optional() redis: Redis | null) {
    if (redis === null) {
      throw new Error(
        'RedisRateLimiter requires a configured Redis client (REDIS_URL / REDIS_HOST)',
      );
    }
    this.redis = redis;
  }

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    try {
      const admitted = (await this.redis.eval(
        ADMIT_SCRIPT,
        1,
        windowKey(key),
        now,
        windowMs,
        limit,
        uniqueMember(now),
      )) as number;
      if (admitted === 0) {
        this.logger.warn(`Rate limit exceeded for key "${key}": ${limit}/${limit}`);
      }
      return admitted === 1;
    } catch (err) {
      // Fail open — see module docstring.
      this.logger.error(
        `Rate-limit check failed for key "${key}"; allowing (fail-open): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return true;
    }
  }

  async remaining(key: string, limit: number, windowMs: number): Promise<number> {
    try {
      const count = await this.pruneAndCount(key, windowMs);
      return Math.max(0, limit - count);
    } catch (err) {
      this.logger.error(
        `Rate-limit remaining failed for key "${key}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return limit;
    }
  }

  async resetAt(key: string, windowMs: number): Promise<number> {
    try {
      const oldest = await this.redis.zrange(windowKey(key), 0, 0, 'WITHSCORES');
      if (oldest.length < 2) return Date.now() + windowMs;
      const oldestScore = Number(oldest[1]);
      return Number.isFinite(oldestScore) && oldestScore > 0
        ? oldestScore + windowMs
        : Date.now() + windowMs;
    } catch (err) {
      this.logger.error(
        `Rate-limit resetAt failed for key "${key}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return Date.now() + windowMs;
    }
  }

  /** Prune expired members and return the active count (read maintenance). */
  private async pruneAndCount(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    await this.redis.zremrangebyscore(windowKey(key), 0, now - windowMs);
    return this.redis.zcard(windowKey(key));
  }
}
