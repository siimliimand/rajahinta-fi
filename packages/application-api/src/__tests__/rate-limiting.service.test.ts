/**
 * Tests for RateLimitingService and InMemoryRateLimiter.
 *
 * @module RateLimitingServiceTest
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  InMemoryRateLimiter,
  RateLimitingService,
  RATE_LIMIT_PROFILES,
} from '../rate-limiting/rate-limiting.service';

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
    (limiter as any).cleanupTimer && clearInterval((limiter as any).cleanupTimer);
  });

  it('allows requests under the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('user-1', 10, 60_000)).toBe(true);
    }
  });

  it('rejects requests exceeding the limit', () => {
    for (let i = 0; i < 3; i++) {
      limiter.check('user-1', 3, 60_000);
    }
    expect(limiter.check('user-1', 3, 60_000)).toBe(false);
  });

  it('treats different keys independently', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('user-over', 3, 60_000);
    }
    // Different key should still be allowed
    expect(limiter.check('user-other', 3, 60_000)).toBe(true);
  });

  it('reports remaining count', () => {
    limiter.check('user-r', 10, 60_000);
    limiter.check('user-r', 10, 60_000);
    expect(limiter.remaining('user-r', 10, 60_000)).toBe(8);
  });

  it('reports zero remaining when exhausted', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('user-z', 5, 60_000);
    }
    expect(limiter.remaining('user-z', 5, 60_000)).toBe(0);
  });

  it('reports a future resetAt for an unknown key', () => {
    const reset = limiter.resetAt('unknown', 60_000);
    expect(reset).toBeGreaterThan(Date.now());
  });

  it('allows requests after the window passes (using mock timers)', () => {
    vi.useFakeTimers();

    for (let i = 0; i < 2; i++) {
      expect(limiter.check('user-t', 2, 10_000)).toBe(true);
    }
    expect(limiter.check('user-t', 2, 10_000)).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(10_001);

    expect(limiter.check('user-t', 2, 10_000)).toBe(true);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// RateLimitingService
// ---------------------------------------------------------------------------

describe('RateLimitingService', () => {
  let service: RateLimitingService;

  beforeEach(() => {
    const limiter = new InMemoryRateLimiter();
    service = new RateLimitingService(limiter);
  });

  it('allows requests within the DEFAULT profile limit', () => {
    const profile = 'DEFAULT' as const;
    const { limit } = RATE_LIMIT_PROFILES[profile];
    for (let i = 0; i < limit; i++) {
      expect(service.isAllowed('test-user', profile)).toBe(true);
    }
    expect(service.isAllowed('test-user', profile)).toBe(false);
  });

  it('allows requests within the CALCULATOR profile limit', () => {
    for (let i = 0; i < 10; i++) {
      expect(service.isAllowed('calc-user', 'CALCULATOR')).toBe(true);
    }
    expect(service.isAllowed('calc-user', 'CALCULATOR')).toBe(false);
  });

  it('treats different IPs independently', () => {
    // Exhaust ip-a
    for (let i = 0; i < 10; i++) {
      service.isAllowed('ip-a', 'CALCULATOR');
    }
    // ip-b should still be allowed
    expect(service.isAllowed('ip-b', 'CALCULATOR')).toBe(true);
  });

  it('extracts key from X-Forwarded-For header', () => {
    const key = service.extractKey({
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
    });
    expect(key).toBe('203.0.113.1');
  });

  it('falls back to ip when X-Forwarded-For is missing', () => {
    const key = service.extractKey({ ip: '192.168.1.1' });
    expect(key).toBe('192.168.1.1');
  });

  it('returns "unknown" when neither ip nor header exists', () => {
    const key = service.extractKey({});
    expect(key).toBe('unknown');
  });
});