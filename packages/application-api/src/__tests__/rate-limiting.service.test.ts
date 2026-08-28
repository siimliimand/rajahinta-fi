/**
 * Tests for RateLimitingService, InMemoryRateLimiter, and RedisRateLimiter.
 *
 * The Redis backend is tested against a scripted fake that pins the
 * commands and arguments the limiter issues (the Lua admission script is
 * atomic by construction; multi-replica behaviour is exercised by the
 * integration suite, task 4.4).
 *
 * @module RateLimitingServiceTest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  InMemoryRateLimiter,
  RateLimitingService,
  RATE_LIMIT_PROFILES,
} from '../rate-limiting/rate-limiting.service';
import { RedisRateLimiter } from '../rate-limiting/redis-rate-limiter';

// ---------------------------------------------------------------------------
// InMemoryRateLimiter
// ---------------------------------------------------------------------------

describe('InMemoryRateLimiter', () => {
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
  });

  afterEach(() => {
    // Cleanup the interval timer
    const timer = (limiter as any).cleanupTimer;
    if (timer) clearInterval(timer);
  });

  it('allows requests under the limit', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await limiter.check('user-1', 10, 60_000)).toBe(true);
    }
  });

  it('rejects requests exceeding the limit', async () => {
    for (let i = 0; i < 3; i++) {
      await limiter.check('user-1', 3, 60_000);
    }
    expect(await limiter.check('user-1', 3, 60_000)).toBe(false);
  });

  it('treats different keys independently', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check('user-over', 3, 60_000);
    }
    // Different key should still be allowed
    expect(await limiter.check('user-other', 3, 60_000)).toBe(true);
  });

  it('reports remaining count', async () => {
    await limiter.check('user-r', 10, 60_000);
    await limiter.check('user-r', 10, 60_000);
    expect(await limiter.remaining('user-r', 10, 60_000)).toBe(8);
  });

  it('reports zero remaining when exhausted', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check('user-z', 5, 60_000);
    }
    expect(await limiter.remaining('user-z', 5, 60_000)).toBe(0);
  });

  it('reports a future resetAt for an unknown key', async () => {
    const reset = await limiter.resetAt('unknown', 60_000);
    expect(reset).toBeGreaterThan(Date.now());
  });

  it('allows requests after the window passes (using mock timers)', async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 2; i++) {
      expect(await limiter.check('user-t', 2, 10_000)).toBe(true);
    }
    expect(await limiter.check('user-t', 2, 10_000)).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(10_001);

    expect(await limiter.check('user-t', 2, 10_000)).toBe(true);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// RateLimitingService — profiles
// ---------------------------------------------------------------------------

describe('RateLimitingService', () => {
  let service: RateLimitingService;

  beforeEach(() => {
    const limiter = new InMemoryRateLimiter();
    service = new RateLimitingService(limiter);
  });

  it('allows requests within the DEFAULT profile limit', async () => {
    const profile = 'DEFAULT' as const;
    const { limit } = RATE_LIMIT_PROFILES[profile];
    for (let i = 0; i < limit; i++) {
      expect(await service.isAllowed('test-user', profile)).toBe(true);
    }
    expect(await service.isAllowed('test-user', profile)).toBe(false);
  });

  it('allows requests within the CALCULATOR profile limit', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await service.isAllowed('calc-user', 'CALCULATOR')).toBe(true);
    }
    expect(await service.isAllowed('calc-user', 'CALCULATOR')).toBe(false);
  });

  it('treats different IPs independently', async () => {
    // Exhaust ip-a
    for (let i = 0; i < 10; i++) {
      await service.isAllowed('ip-a', 'CALCULATOR');
    }
    // ip-b should still be allowed
    expect(await service.isAllowed('ip-b', 'CALCULATOR')).toBe(true);
  });

  it('keeps profile windows separate — DEFAULT traffic never consumes CALCULATOR slots', async () => {
    // Regression (browser-e2e wave): the window was keyed by client only,
    // so DEFAULT-profile requests (searches, product reads) filled the
    // shared window and throttled the calculator far below its own
    // limit. Each profile is its own pool per client.
    for (let i = 0; i < 15; i++) {
      expect(await service.isAllowed('shared-user', 'DEFAULT')).toBe(true);
    }
    expect(await service.isAllowed('shared-user', 'CALCULATOR')).toBe(true);
    expect(await service.isAllowed('shared-user', 'SEARCH')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RateLimitingService.extractKey — X-Forwarded-For trust rule
// ---------------------------------------------------------------------------

describe('RateLimitingService.extractKey — proxy trust', () => {
  const ENV_VAR = 'RATE_LIMIT_TRUST_PROXY';
  let service: RateLimitingService;

  beforeEach(() => {
    service = new RateLimitingService(new InMemoryRateLimiter());
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it('ignores X-Forwarded-For when proxy trust is not configured (spoof-proof origin)', () => {
    const key = service.extractKey({
      ip: '192.168.1.1',
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
    });
    expect(key).toBe('192.168.1.1');
  });

  it('extracts key from X-Forwarded-For when RATE_LIMIT_TRUST_PROXY=true', () => {
    process.env[ENV_VAR] = 'true';
    const key = service.extractKey({
      ip: '10.0.0.7',
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
    });
    expect(key).toBe('203.0.113.1');
  });

  it('falls back to ip when X-Forwarded-For is missing', () => {
    process.env[ENV_VAR] = 'true';
    const key = service.extractKey({ ip: '192.168.1.1' });
    expect(key).toBe('192.168.1.1');
  });

  it('returns "unknown" when neither ip nor usable header exists', () => {
    const key = service.extractKey({});
    expect(key).toBe('unknown');
  });

  it('does not treat other truthy values as trust (explicit opt-in only)', () => {
    process.env[ENV_VAR] = '1';
    const key = service.extractKey({
      ip: '192.168.1.1',
      headers: { 'x-forwarded-for': '203.0.113.1' },
    });
    expect(key).toBe('192.168.1.1');
  });
});

// ---------------------------------------------------------------------------
// RedisRateLimiter — command contract against a scripted fake
// ---------------------------------------------------------------------------

/** Minimal ioredis surface the limiter uses, with call recording. */
function createFakeRedis(overrides?: {
  evalResult?: number;
  evalError?: Error;
  zrange?: unknown[];
}) {
  const calls: { cmd: string; args: unknown[] }[] = [];
  const record = (cmd: string) => (...args: unknown[]) => {
    calls.push({ cmd, args });
    return Promise.resolve(0);
  };
  return {
    calls,
    eval: vi.fn(async (...args: unknown[]) => {
      calls.push({ cmd: 'eval', args });
      if (overrides?.evalError) throw overrides.evalError;
      return overrides?.evalResult ?? 1;
    }),
    zremrangebyscore: record('zremrangebyscore'),
    zcard: vi.fn(async (...args: unknown[]) => {
      calls.push({ cmd: 'zcard', args });
      return 2;
    }),
    zrange: vi.fn(async (...args: unknown[]) => {
      calls.push({ cmd: 'zrange', args });
      return overrides?.zrange ?? ['1000:1', '1710000000000'];
    }),
  };
}

describe('RedisRateLimiter', () => {
  it('runs the atomic admission script against the namespaced key', async () => {
    const fake = createFakeRedis();
    const limiter = new RedisRateLimiter(fake as never);

    await limiter.check('client-a', 10, 60_000);

    expect(fake.calls).toHaveLength(1);
    const { cmd, args } = fake.calls[0];
    expect(cmd).toBe('eval');
    expect(args[1]).toBe(1); // numKeys
    expect(args[2]).toBe('ratelimit:client-a');
    expect(args[3]).toBeGreaterThan(0); // now ms
    expect(args[4]).toBe(60_000); // window
    expect(args[5]).toBe(10); // limit
  });

  it('admits when the script returns 1', async () => {
    const limiter = new RedisRateLimiter(createFakeRedis({ evalResult: 1 }) as never);
    expect(await limiter.check('client-a', 10, 60_000)).toBe(true);
  });

  it('rejects when the script returns 0', async () => {
    const limiter = new RedisRateLimiter(createFakeRedis({ evalResult: 0 }) as never);
    expect(await limiter.check('client-a', 10, 60_000)).toBe(false);
  });

  it('fails OPEN when Redis errors (protect availability, not the limit)', async () => {
    const limiter = new RedisRateLimiter(
      createFakeRedis({ evalError: new Error('connection lost') }) as never,
    );
    expect(await limiter.check('client-a', 10, 60_000)).toBe(true);
  });

  it('derives remaining from pruned set cardinality', async () => {
    const fake = createFakeRedis();
    const limiter = new RedisRateLimiter(fake as never);

    expect(await limiter.remaining('client-a', 10, 60_000)).toBe(8); // zcard stub returns 2

    const prune = fake.calls.find((c) => c.cmd === 'zremrangebyscore');
    expect(prune?.args[0]).toBe('ratelimit:client-a');
    expect(prune?.args[2]).toBeGreaterThan(0); // cutoff = now - window
  });

  it('derives resetAt from the oldest member score plus the window', async () => {
    const fake = createFakeRedis({ zrange: ['1710000000000:1', '1710000000000'] });
    const limiter = new RedisRateLimiter(fake as never);

    const resetAt = await limiter.resetAt('client-a', 60_000);
    expect(resetAt).toBe(1_710_000_000_000 + 60_000);
  });

  it('returns now + window when the set is empty', async () => {
    const fake = createFakeRedis({ zrange: [] });
    const limiter = new RedisRateLimiter(fake as never);

    const before = Date.now();
    const resetAt = await limiter.resetAt('client-a', 60_000);
    expect(resetAt).toBeGreaterThanOrEqual(before + 60_000);
  });

  it('rejects construction with a null client (misconfiguration is loud)', () => {
    expect(() => new RedisRateLimiter(null as never)).toThrow(/Redis/);
  });
});
