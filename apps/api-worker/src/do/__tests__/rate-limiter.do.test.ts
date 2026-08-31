/**
 * RateLimiterDO parity tests (task 3.3).
 *
 * Expectations are ported from the Redis limiter's suites:
 * `packages/application-api/src/__tests__/rate-limiting.service.test.ts`
 * (InMemory + Redis Lua contract). The DO runs against an in-memory
 * storage emulating DurableObjectStorage semantics, with the clock pinned
 * per request via `nowMs` so window boundaries are exact rather than
 * tick-dependent.
 *
 * @module RateLimiterDoTest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiterDO } from '../rate-limiter.do';
import type { RateLimitDecision } from '../rate-limiter.do';
import {
  callDo,
  callDoRaw,
  createMemoryDoState,
  createMemoryDoStorage,
} from './memory-do-storage';

/** Fixed epoch so boundary math reads as absolute times. */
const T0 = 1_710_000_000_000;

function createDo(): RateLimiterDO {
  return new RateLimiterDO(createMemoryDoState(createMemoryDoStorage()), {});
}

/** Response payload of the `remaining` op. */
interface RemainingResponse {
  remaining: number;
}

/** Response payload of the `resetAt` op. */
interface ResetAtResponse {
  resetAtMs: number;
}

describe('RateLimiterDO — admission (InMemory limiter parity)', () => {
  let limiter: RateLimiterDO;

  beforeEach(() => {
    limiter = createDo();
  });

  it('allows requests under the limit', async () => {
    for (let i = 0; i < 5; i++) {
      const decision = await callDo<RateLimitDecision>(limiter, {
        op: 'check',
        profile: 'CALCULATOR',
        limit: 10,
        windowMs: 60_000,
        nowMs: T0 + i,
      });
      expect(decision.allowed).toBe(true);
    }
  });

  it('rejects exactly at the limit — N admits, then the N+1th is denied', async () => {
    for (let i = 0; i < 3; i++) {
      const decision = await callDo<RateLimitDecision>(limiter, {
        op: 'check',
        profile: 'CALCULATOR',
        limit: 3,
        windowMs: 60_000,
        nowMs: T0 + i,
      });
      expect(decision.allowed).toBe(true);
    }
    const rejected = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'CALCULATOR',
      limit: 3,
      windowMs: 60_000,
      nowMs: T0 + 3,
    });
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
  });

  it('reports remaining count', async () => {
    await callDo(limiter, { op: 'check', profile: 'DEFAULT', limit: 10, windowMs: 60_000, nowMs: T0 });
    await callDo(limiter, { op: 'check', profile: 'DEFAULT', limit: 10, windowMs: 60_000, nowMs: T0 + 1 });
    const { remaining } = await callDo<RemainingResponse>(limiter, {
      op: 'remaining',
      profile: 'DEFAULT',
      limit: 10,
      windowMs: 60_000,
      nowMs: T0 + 2,
    });
    expect(remaining).toBe(8);
  });

  it('reports zero remaining when exhausted', async () => {
    for (let i = 0; i < 5; i++) {
      await callDo(limiter, { op: 'check', profile: 'DEFAULT', limit: 5, windowMs: 60_000, nowMs: T0 + i });
    }
    const { remaining } = await callDo<RemainingResponse>(limiter, {
      op: 'remaining',
      profile: 'DEFAULT',
      limit: 5,
      windowMs: 60_000,
      nowMs: T0 + 5,
    });
    expect(remaining).toBe(0);
  });

  it('reports a future resetAt for an unknown key (Redis parity)', async () => {
    const { resetAtMs } = await callDo<ResetAtResponse>(limiter, {
      op: 'resetAt',
      profile: 'nobody',
      windowMs: 60_000,
      nowMs: T0,
    });
    expect(resetAtMs).toBe(T0 + 60_000);
  });

  it('a rejected request consumes no slot (exact log, not a lease)', async () => {
    await callDo(limiter, { op: 'check', profile: 'P', limit: 2, windowMs: 10_000, nowMs: T0 });
    await callDo(limiter, { op: 'check', profile: 'P', limit: 2, windowMs: 10_000, nowMs: T0 + 1 });
    // Rejected — must NOT append a timestamp.
    const rejected = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'P',
      limit: 2,
      windowMs: 10_000,
      nowMs: T0 + 2,
    });
    expect(rejected.allowed).toBe(false);

    // One hit slides out; a slot is free again and the second hit is
    // still active — proves only the two admitted hits were recorded.
    const slid = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'P',
      limit: 2,
      windowMs: 10_000,
      nowMs: T0 + 10_001,
    });
    expect(slid.allowed).toBe(true);
    expect(slid.remaining).toBe(1);
  });
});

describe('RateLimiterDO — sliding window boundary (Redis Lua parity)', () => {
  let limiter: RateLimiterDO;

  beforeEach(() => {
    limiter = createDo();
  });

  it('admits again once hits age out of the window (ported: advance 10_001)', async () => {
    for (let i = 0; i < 2; i++) {
      const decision = await callDo<RateLimitDecision>(limiter, {
        op: 'check',
        profile: 'P',
        limit: 2,
        windowMs: 10_000,
        nowMs: T0 + i,
      });
      expect(decision.allowed).toBe(true);
    }
    const rejected = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'P',
      limit: 2,
      windowMs: 10_000,
      nowMs: T0 + 2,
    });
    expect(rejected.allowed).toBe(false);

    // Past the window — the log has fully slid.
    const admitted = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'P',
      limit: 2,
      windowMs: 10_000,
      nowMs: T0 + 10_001,
    });
    expect(admitted.allowed).toBe(true);
  });

  it('keeps a hit at exactly (now − windowMs) OUT — half-open window', async () => {
    // Lua: ZREMRANGEBYSCORE 0 .. now-window removes score == now-window,
    // so a hit expires at exactly t + windowMs. Limit 1, window 1000.
    await callDo(limiter, { op: 'check', profile: 'P', limit: 1, windowMs: 1_000, nowMs: T0 });

    // 1 ms before expiry: still counted → rejected.
    const before = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'P',
      limit: 1,
      windowMs: 1_000,
      nowMs: T0 + 999,
    });
    expect(before.allowed).toBe(false);

    // Exactly at expiry: pruned → admitted.
    const atExpiry = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'P',
      limit: 1,
      windowMs: 1_000,
      nowMs: T0 + 1_000,
    });
    expect(atExpiry.allowed).toBe(true);
  });

  it('slides hit-by-hit — not a fixed window', async () => {
    // Hits at 0 and 5000 (limit 2, window 10_000).
    await callDo(limiter, { op: 'check', profile: 'P', limit: 2, windowMs: 10_000, nowMs: T0 });
    await callDo(limiter, { op: 'check', profile: 'P', limit: 2, windowMs: 10_000, nowMs: T0 + 5_000 });

    // t = 9999: both hits active → full.
    const full = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'P',
      limit: 2,
      windowMs: 10_000,
      nowMs: T0 + 9_999,
    });
    expect(full.allowed).toBe(false);

    // t = 10_000: first hit expired, second active → one slot.
    // A fixed window would reset both at once here.
    const slid = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'P',
      limit: 2,
      windowMs: 10_000,
      nowMs: T0 + 10_000,
    });
    expect(slid.allowed).toBe(true);
    expect(slid.remaining).toBe(0);
  });

  it('derives resetAt from the oldest active hit plus the window (Redis zrange parity)', async () => {
    await callDo(limiter, { op: 'check', profile: 'P', limit: 5, windowMs: 60_000, nowMs: T0 });
    await callDo(limiter, { op: 'check', profile: 'P', limit: 5, windowMs: 60_000, nowMs: T0 + 5_000 });

    const { resetAtMs } = await callDo<ResetAtResponse>(limiter, {
      op: 'resetAt',
      profile: 'P',
      windowMs: 60_000,
      nowMs: T0 + 6_000,
    });
    expect(resetAtMs).toBe(T0 + 60_000);
  });

  it('moves resetAt forward as the oldest hit slides out', async () => {
    await callDo(limiter, { op: 'check', profile: 'P', limit: 5, windowMs: 10_000, nowMs: T0 });
    await callDo(limiter, { op: 'check', profile: 'P', limit: 5, windowMs: 10_000, nowMs: T0 + 5_000 });

    // After t0 slides out, the hit at t0+5000 anchors the window.
    const { resetAtMs } = await callDo<ResetAtResponse>(limiter, {
      op: 'resetAt',
      profile: 'P',
      windowMs: 10_000,
      nowMs: T0 + 10_000,
    });
    expect(resetAtMs).toBe(T0 + 15_000);
  });
});

describe('RateLimiterDO — per-key isolation', () => {
  let limiter: RateLimiterDO;

  beforeEach(() => {
    limiter = createDo();
  });

  it('treats different clients independently (separate DO instances)', async () => {
    const clientA = createDo();
    const clientB = createDo();
    for (let i = 0; i < 3; i++) {
      await callDo(clientA, { op: 'check', profile: 'CALCULATOR', limit: 3, windowMs: 60_000, nowMs: T0 + i });
    }
    const otherClient = await callDo<RateLimitDecision>(clientB, {
      op: 'check',
      profile: 'CALCULATOR',
      limit: 3,
      windowMs: 60_000,
      nowMs: T0,
    });
    expect(otherClient.allowed).toBe(true);
  });

  it('keeps profile windows separate — DEFAULT traffic never consumes CALCULATOR slots', async () => {
    // Ported regression: window keyed by client only once throttled the
    // calculator via unrelated DEFAULT traffic.
    for (let i = 0; i < 15; i++) {
      const decision = await callDo<RateLimitDecision>(limiter, {
        op: 'check',
        profile: 'DEFAULT',
        limit: 15,
        windowMs: 60_000,
        nowMs: T0 + i,
      });
      expect(decision.allowed).toBe(true);
    }
    const calculator = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'CALCULATOR',
      limit: 10,
      windowMs: 60_000,
      nowMs: T0 + 100,
    });
    const search = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'SEARCH',
      limit: 30,
      windowMs: 60_000,
      nowMs: T0 + 100,
    });
    expect(calculator.allowed).toBe(true);
    expect(search.allowed).toBe(true);
  });

  it('applies profile limits independently for the same client', async () => {
    for (let i = 0; i < 3; i++) {
      await callDo(limiter, { op: 'check', profile: 'CALCULATOR', limit: 3, windowMs: 60_000, nowMs: T0 + i });
    }
    const calculatorFull = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'CALCULATOR',
      limit: 3,
      windowMs: 60_000,
      nowMs: T0 + 10,
    });
    expect(calculatorFull.allowed).toBe(false);
    // ip-b parity: a different client's pool is untouched (fresh DO).
    const fresh = createDo();
    const stillAllowed = await callDo<RateLimitDecision>(fresh, {
      op: 'check',
      profile: 'CALCULATOR',
      limit: 3,
      windowMs: 60_000,
      nowMs: T0,
    });
    expect(stillAllowed.allowed).toBe(true);
  });
});

describe('RateLimiterDO — 429 + Retry-After decision data (RateLimitGuard parity)', () => {
  it('produces the guard math: retryAfterSeconds = ceil((resetAt − now)/1000)', async () => {
    const limiter = createDo();
    await callDo(limiter, { op: 'check', profile: 'CALCULATOR', limit: 1, windowMs: 60_000, nowMs: T0 });

    // Rejected 500 ms into the window — guard rounded up to whole seconds.
    const decision = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'CALCULATOR',
      limit: 1,
      windowMs: 60_000,
      nowMs: T0 + 500,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.resetAtMs).toBe(T0 + 60_000);
    expect(decision.retryAfterSeconds).toBe(60);
    expect(decision.retryAfterSeconds).toBe(
      Math.ceil((decision.resetAtMs - (T0 + 500)) / 1000),
    );
  });

  it('maps a rejected decision onto the legacy 429 envelope + Retry-After header', async () => {
    const limiter = createDo();
    // Exactly 10 admits (CALCULATOR limit), the 11th is rejected.
    for (let i = 0; i < 10; i++) {
      const admitted = await callDo<RateLimitDecision>(limiter, {
        op: 'check',
        profile: 'CALCULATOR',
        limit: 10,
        windowMs: 60_000,
        nowMs: T0 + i,
      });
      expect(admitted.allowed).toBe(true);
    }
    const decision = await callDo<RateLimitDecision>(limiter, {
      op: 'check',
      profile: 'CALCULATOR',
      limit: 10,
      windowMs: 60_000,
      nowMs: T0 + 20,
    });

    // Exactly what the ported middleware will do with the decision —
    // pinned here so the contract survives until task 3.5 lands it.
    expect(decision.allowed).toBe(false);
    const response = new Response(JSON.stringify({
      statusCode: 429,
      message: `Rate limit exceeded. Try again in ${decision.retryAfterSeconds}s.`,
      error: 'TooManyRequests',
      retryAfterSeconds: decision.retryAfterSeconds,
    }), {
      status: 429,
      headers: { 'Retry-After': String(decision.retryAfterSeconds) },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe(String(decision.retryAfterSeconds));
    const body = (await response.json()) as {
      statusCode: number;
      message: string;
      error: string;
      retryAfterSeconds: number;
    };
    expect(body.statusCode).toBe(429);
    expect(body.error).toBe('TooManyRequests');
    expect(body.message).toMatch(/^Rate limit exceeded\. Try again in \d+s\.$/);
  });
});

describe('RateLimiterDO — protocol errors', () => {
  it('rejects invalid JSON with 400', async () => {
    const limiter = createDo();
    const response = await limiter.fetch(
      new Request('https://do.internal/', { method: 'POST', body: 'not json' }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects unknown ops with 400', async () => {
    const limiter = createDo();
    const response = await callDoRaw(limiter, { op: 'explode' });
    expect(response.status).toBe(400);
  });

  it('rejects non-positive limits and windows with 400', async () => {
    const limiter = createDo();
    expect((await callDoRaw(limiter, { op: 'check', profile: 'P', limit: 0, windowMs: 60_000 })).status).toBe(400);
    expect((await callDoRaw(limiter, { op: 'check', profile: 'P', limit: 10, windowMs: -1 })).status).toBe(400);
    expect((await callDoRaw(limiter, { op: 'resetAt', profile: 'P', windowMs: 0 })).status).toBe(400);
  });
});

describe('RateLimiterDO — ping (readiness probe, task 6.4)', () => {
  it('answers pong without touching storage', async () => {
    const storage = createMemoryDoStorage();
    const limiter = new RateLimiterDO(createMemoryDoState(storage), {});

    const response = await callDoRaw(limiter, { op: 'ping' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pong: true });
    // The probe is a pure identity/status call: no window keys created,
    // no pruning — it cannot contend with live rate-limit state.
    expect(storage.size).toBe(0);
  });
});
