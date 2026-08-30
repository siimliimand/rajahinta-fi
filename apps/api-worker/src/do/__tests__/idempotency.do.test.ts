/**
 * IdempotencyDO parity tests (task 3.3).
 *
 * Expectations are ported from
 * `packages/application-api/src/__tests__/idempotency.service.test.ts`
 * (hashInput key material, version-flip lifecycles, TTL/invalidation
 * behavior of the Redis cache). The DO runs against an in-memory storage
 * emulating DurableObjectStorage semantics; time is pinned per request
 * via `nowMs`.
 *
 * @module IdempotencyDoTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  DEFAULT_TTL_SECONDS,
  IdempotencyDO,
  hashCacheKey,
} from '../idempotency.do';
import type { CacheKeyInput, IdempotencyEntry } from '../idempotency.do';
import {
  callDo,
  callDoRaw,
  createMemoryDoState,
  createMemoryDoStorage,
  fireAlarm,
  type MemoryDoStorage,
} from './memory-do-storage';

/** Fixed epoch so TTL math reads as absolute times. */
const T0 = 1_710_000_000_000;

interface GetResponse {
  found: boolean;
  entry?: IdempotencyEntry;
}
interface PutIfAbsentResponse {
  stored: boolean;
}
interface InvalidateResponse {
  deleted: number;
}
interface SizeResponse {
  size: number;
}
interface ClearResponse {
  deleted: number;
}

function createDo(): { do: IdempotencyDO; storage: MemoryDoStorage } {
  const storage = createMemoryDoStorage();
  return { do: new IdempotencyDO(createMemoryDoState(storage), {}), storage };
}

/** Plain-JSON stand-in for a CalculatorResult (the DO treats it opaquely). */
function makeResult(datasetVersions: string[] = ['tax-v1', 'transport-v1']): unknown {
  return {
    totalCents: 1900,
    currency: 'EUR',
    metadata: {
      datasetVersions,
      calculationTimestamp: '2026-01-01T00:00:00.000Z',
      destination: 'FI',
    },
  };
}

const baseInput: CacheKeyInput = { productId: 42, quantity: 2, destination: 'FI' };

describe('hashCacheKey — key material (hashInput parity)', () => {
  it('produces a deterministic hash for the same input', async () => {
    expect(await hashCacheKey(baseInput)).toBe(await hashCacheKey(baseInput));
  });

  it('produces different hashes when productId changes', async () => {
    expect(await hashCacheKey({ ...baseInput, productId: 1 }))
      .not.toBe(await hashCacheKey({ ...baseInput, productId: 2 }));
  });

  it('produces different hashes when quantity changes', async () => {
    expect(await hashCacheKey({ ...baseInput, quantity: 1 }))
      .not.toBe(await hashCacheKey({ ...baseInput, quantity: 3 }));
  });

  it('is case-insensitive on destination', async () => {
    expect(await hashCacheKey({ productId: 1, quantity: 1, destination: 'fi' }))
      .toBe(await hashCacheKey({ productId: 1, quantity: 1, destination: 'FI' }));
  });

  it('includes transportMethod in the hash', async () => {
    expect(await hashCacheKey({ ...baseInput, transportMethod: 'posti' }))
      .not.toBe(await hashCacheKey(baseInput));
  });

  it('returns a 64-character hex string (SHA-256)', async () => {
    expect(await hashCacheKey(baseInput)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the legacy node:crypto byte stream exactly (cross-runtime parity)', async () => {
    // The legacy hashInput stream: productId|quantity|DEST|method|V|sorted versions.
    const input: CacheKeyInput = {
      productId: 99,
      quantity: 3,
      destination: 'se',
      transportMethod: 'posti',
      datasetVersions: ['v2.0-2025', '2026-08-21T00:00:00.000Z'],
    };
    const legacy = createHash('sha256')
      .update('99')
      .update('|')
      .update('3')
      .update('|')
      .update('SE')
      .update('|')
      .update('posti')
      .update('|V|')
      .update('2026-08-21T00:00:00.000Z')
      .update('|')
      .update('v2.0-2025')
      .update('|')
      .digest('hex');
    expect(await hashCacheKey(input)).toBe(legacy);
  });

  it('is order-independent over datasetVersions', async () => {
    const a: CacheKeyInput = {
      ...baseInput,
      datasetVersions: ['v2.0-2025', 'v3.0-2026', 'v1.0-2024'],
    };
    const b: CacheKeyInput = {
      ...baseInput,
      datasetVersions: ['v1.0-2024', 'v3.0-2026', 'v2.0-2025'],
    };
    expect(await hashCacheKey(a)).toBe(await hashCacheKey(b));
  });

  it('changes when the tax version bumps (v2 → v3)', async () => {
    const v2: CacheKeyInput = { ...baseInput, datasetVersions: ['v2.0-2025', 'transport-v1'] };
    const v3: CacheKeyInput = { ...baseInput, datasetVersions: ['v3.0-2026', 'transport-v1'] };
    expect(await hashCacheKey(v2)).not.toBe(await hashCacheKey(v3));
  });

  it('hashes empty and omitted datasetVersions identically', async () => {
    expect(await hashCacheKey(baseInput))
      .toBe(await hashCacheKey({ ...baseInput, datasetVersions: [] }));
  });

  it('changes when the transport proxy version (max refreshedAt) changes', async () => {
    const before: CacheKeyInput = {
      ...baseInput,
      datasetVersions: ['v3.0-2026', '2026-08-21T12:00:00.000Z'],
    };
    const after: CacheKeyInput = {
      ...baseInput,
      datasetVersions: ['v3.0-2026', '2026-08-22T12:00:00.000Z'],
    };
    expect(await hashCacheKey(before)).not.toBe(await hashCacheKey(after));
  });

  it('hashes basket items per item, replacing the single-product dimension', async () => {
    const basket: CacheKeyInput = {
      ...baseInput,
      items: [{ productId: 1, quantity: 2 }, { productId: 3, quantity: 4 }],
    };
    expect(await hashCacheKey(basket))
      .not.toBe(await hashCacheKey(baseInput));
    // Item order matters (matches legacy per-item stream).
    const reversed: CacheKeyInput = {
      ...baseInput,
      items: [{ productId: 3, quantity: 4 }, { productId: 1, quantity: 2 }],
    };
    expect(await hashCacheKey(basket)).not.toBe(await hashCacheKey(reversed));
  });
});

describe('IdempotencyDO — get/put (IdempotencyService parity)', () => {
  let cache: IdempotencyDO;

  beforeEach(() => {
    cache = createDo().do;
  });

  it('stores and retrieves a result (replay of an identical version-keyed calculation)', async () => {
    const result = makeResult();
    await callDo(cache, { op: 'put', input: baseInput, result, nowMs: T0 });

    const { found, entry } = await callDo<GetResponse>(cache, {
      op: 'get',
      input: baseInput,
      nowMs: T0 + 1,
    });
    expect(found).toBe(true);
    expect(entry?.result).toEqual(result);
    expect(entry?.datasetVersions).toEqual(['tax-v1', 'transport-v1']);
    expect(entry?.createdAt).toBe(new Date(T0).toISOString());
  });

  it('returns found=false for a missing key', async () => {
    const { found } = await callDo<GetResponse>(cache, {
      op: 'get',
      input: { productId: 1, quantity: 1, destination: 'FI' },
      nowMs: T0,
    });
    expect(found).toBe(false);
  });

  it('derives datasetVersions from result.metadata when not passed explicitly', async () => {
    await callDo(cache, {
      op: 'put',
      input: baseInput,
      result: makeResult(['vX']),
      nowMs: T0,
    });
    const { entry } = await callDo<GetResponse>(cache, { op: 'get', input: baseInput, nowMs: T0 });
    expect(entry?.datasetVersions).toEqual(['vX']);
  });

  it('honors explicitly passed datasetVersions over the result metadata', async () => {
    await callDo(cache, {
      op: 'put',
      input: baseInput,
      result: makeResult(['not-these']),
      datasetVersions: ['explicit-v1'],
      nowMs: T0,
    });
    const { entry } = await callDo<GetResponse>(cache, { op: 'get', input: baseInput, nowMs: T0 });
    expect(entry?.datasetVersions).toEqual(['explicit-v1']);
  });
});

describe('IdempotencyDO — version-aware keys (dataset version change → miss)', () => {
  let cache: IdempotencyDO;

  beforeEach(() => {
    cache = createDo().do;
  });

  it('hits while versions match, then misses after the flip (v1 → v2 lifecycle)', async () => {
    const inputV1: CacheKeyInput = { ...baseInput, datasetVersions: ['v1.0'] };
    await callDo(cache, {
      op: 'put',
      input: inputV1,
      result: makeResult(['v1.0']),
      nowMs: T0,
    });

    // Same versions → HIT.
    const hit = await callDo<GetResponse>(cache, { op: 'get', input: inputV1, nowMs: T0 + 1 });
    expect(hit.found).toBe(true);

    // Tax bumped → different key → MISS (fresh calculation guaranteed).
    const inputV2: CacheKeyInput = { ...baseInput, datasetVersions: ['v2.0'] };
    const miss = await callDo<GetResponse>(cache, { op: 'get', input: inputV2, nowMs: T0 + 1 });
    expect(miss.found).toBe(false);
  });

  it('keeps the old version-keyed entry intact after a version bump (ported v2 → v3 test)', async () => {
    const inputV2: CacheKeyInput = {
      productId: 99, quantity: 1, destination: 'FI',
      datasetVersions: ['v2.0-2025', 'transport-v1'],
    };
    const resultV2 = makeResult(['v2.0-2025', 'transport-v1']);
    await callDo(cache, { op: 'put', input: inputV2, result: resultV2, nowMs: T0 });

    const inputV3: CacheKeyInput = {
      productId: 99, quantity: 1, destination: 'FI',
      datasetVersions: ['v3.0-2026', 'transport-v1'],
    };
    const miss = await callDo<GetResponse>(cache, { op: 'get', input: inputV3, nowMs: T0 + 1 });
    expect(miss.found).toBe(false);

    // The v2 entry is still replayable under its own key.
    const oldHit = await callDo<GetResponse>(cache, { op: 'get', input: inputV2, nowMs: T0 + 1 });
    expect(oldHit.found).toBe(true);
    expect(oldHit.entry?.result).toEqual(resultV2);
  });

  it('misses when the transport proxy version changes (observedAt bump)', async () => {
    const inputOld: CacheKeyInput = {
      productId: 55, quantity: 1, destination: 'SE',
      datasetVersions: ['v3.0-2026', '2026-08-21T00:00:00.000Z'],
    };
    await callDo(cache, {
      op: 'put',
      input: inputOld,
      result: makeResult(['v3.0-2026', '2026-08-21T00:00:00.000Z']),
      nowMs: T0,
    });

    const inputNew: CacheKeyInput = {
      productId: 55, quantity: 1, destination: 'SE',
      datasetVersions: ['v3.0-2026', '2026-08-22T00:00:00.000Z'],
    };
    const miss = await callDo<GetResponse>(cache, { op: 'get', input: inputNew, nowMs: T0 + 1 });
    expect(miss.found).toBe(false);
  });
});

describe('IdempotencyDO — TTL (RedisIdempotencyCache parity, default 3600s)', () => {
  let cache: IdempotencyDO;
  let storage: MemoryDoStorage;

  beforeEach(() => {
    ({ do: cache, storage } = createDo());
  });

  it('applies the default TTL of one hour', async () => {
    await callDo(cache, { op: 'put', input: baseInput, result: makeResult(), nowMs: T0 });

    const justBefore = await callDo<GetResponse>(cache, {
      op: 'get',
      input: baseInput,
      nowMs: T0 + DEFAULT_TTL_SECONDS * 1_000 - 1,
    });
    expect(justBefore.found).toBe(true);

    const atExpiry = await callDo<GetResponse>(cache, {
      op: 'get',
      input: baseInput,
      nowMs: T0 + DEFAULT_TTL_SECONDS * 1_000,
    });
    expect(atExpiry.found).toBe(false);
  });

  it('deletes an expired entry on read (lazy TTL enforcement)', async () => {
    await callDo(cache, { op: 'put', input: baseInput, result: makeResult(), nowMs: T0 });
    expect(storage.size).toBe(1);

    await callDo(cache, {
      op: 'get',
      input: baseInput,
      nowMs: T0 + DEFAULT_TTL_SECONDS * 1_000 + 1,
    });
    expect(storage.size).toBe(0);
  });

  it('honors explicit ttlSeconds', async () => {
    await callDo(cache, {
      op: 'put',
      input: baseInput,
      result: makeResult(),
      ttlSeconds: 60,
      nowMs: T0,
    });
    const within = await callDo<GetResponse>(cache, { op: 'get', input: baseInput, nowMs: T0 + 59_999 });
    const after = await callDo<GetResponse>(cache, { op: 'get', input: baseInput, nowMs: T0 + 60_000 });
    expect(within.found).toBe(true);
    expect(after.found).toBe(false);
  });
});

describe('IdempotencyDO — atomic put-if-absent', () => {
  let cache: IdempotencyDO;

  beforeEach(() => {
    cache = createDo().do;
  });

  it('stores the first writer only and preserves its entry', async () => {
    const first = await callDo<PutIfAbsentResponse>(cache, {
      op: 'putIfAbsent',
      input: baseInput,
      result: makeResult(['v1']),
      nowMs: T0,
    });
    const second = await callDo<PutIfAbsentResponse>(cache, {
      op: 'putIfAbsent',
      input: baseInput,
      result: makeResult(['v1']),
      nowMs: T0 + 1,
    });
    expect(first.stored).toBe(true);
    expect(second.stored).toBe(false);

    // The winner's entry — not the loser's — is what get returns.
    const { entry } = await callDo<GetResponse>(cache, { op: 'get', input: baseInput, nowMs: T0 + 2 });
    expect(entry?.createdAt).toBe(new Date(T0).toISOString());
  });

  it('allows put-if-absent once the previous entry expired', async () => {
    await callDo(cache, {
      op: 'putIfAbsent',
      input: baseInput,
      result: makeResult(),
      ttlSeconds: 60,
      nowMs: T0,
    });
    const afterExpiry = await callDo<PutIfAbsentResponse>(cache, {
      op: 'putIfAbsent',
      input: baseInput,
      result: makeResult(),
      ttlSeconds: 60,
      nowMs: T0 + 60_000,
    });
    expect(afterExpiry.stored).toBe(true);
  });
});

describe('IdempotencyDO — version invalidation (invalidateOnVersionChange parity)', () => {
  let cache: IdempotencyDO;

  beforeEach(() => {
    cache = createDo().do;
  });

  it('invalidates entries with partial version overlap only', async () => {
    const k1: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI', datasetVersions: ['v1', 'v2'] };
    const k2: CacheKeyInput = { productId: 2, quantity: 1, destination: 'FI', datasetVersions: ['v3'] };
    await callDo(cache, { op: 'put', input: k1, result: makeResult(['v1', 'v2']), nowMs: T0 });
    await callDo(cache, { op: 'put', input: k2, result: makeResult(['v3']), nowMs: T0 });

    // v2 matches k1; v99 matches nothing.
    const { deleted } = await callDo<InvalidateResponse>(cache, {
      op: 'invalidateVersions',
      versions: ['v2', 'v99'],
      nowMs: T0,
    });
    expect(deleted).toBe(1);
    expect((await callDo<GetResponse>(cache, { op: 'get', input: k1, nowMs: T0 })).found).toBe(false);
    expect((await callDo<GetResponse>(cache, { op: 'get', input: k2, nowMs: T0 })).found).toBe(true);
  });

  it('does nothing when versions are empty', async () => {
    await callDo(cache, { op: 'put', input: baseInput, result: makeResult(['v1']), nowMs: T0 });
    const { deleted } = await callDo<InvalidateResponse>(cache, {
      op: 'invalidateVersions',
      versions: [],
    });
    expect(deleted).toBe(0);
    expect((await callDo<GetResponse>(cache, { op: 'get', input: baseInput, nowMs: T0 })).found).toBe(true);
  });

  it('ignores already-expired entries during invalidation', async () => {
    await callDo(cache, {
      op: 'put',
      input: baseInput,
      result: makeResult(['v1']),
      ttlSeconds: 60,
      nowMs: T0,
    });
    const { deleted } = await callDo<InvalidateResponse>(cache, {
      op: 'invalidateVersions',
      versions: ['v1'],
      nowMs: T0 + 61_000,
    });
    expect(deleted).toBe(0);
  });
});

describe('IdempotencyDO — size, clear, expiry sweep (alarm)', () => {
  let cache: IdempotencyDO;
  let storage: MemoryDoStorage;

  beforeEach(() => {
    ({ do: cache, storage } = createDo());
  });

  it('reports the live entry count', async () => {
    expect((await callDo<SizeResponse>(cache, { op: 'size', nowMs: T0 })).size).toBe(0);
    await callDo(cache, { op: 'put', input: { ...baseInput, productId: 1 }, result: makeResult(), nowMs: T0 });
    await callDo(cache, { op: 'put', input: { ...baseInput, productId: 2 }, result: makeResult(), nowMs: T0 });
    expect((await callDo<SizeResponse>(cache, { op: 'size', nowMs: T0 })).size).toBe(2);

    // Expired entries are not live.
    expect((await callDo<SizeResponse>(cache, { op: 'size', nowMs: T0 + 3_600_000 })).size).toBe(0);
  });

  it('clear removes every entry', async () => {
    await callDo(cache, { op: 'put', input: { ...baseInput, productId: 1 }, result: makeResult(), nowMs: T0 });
    await callDo(cache, { op: 'put', input: { ...baseInput, productId: 2 }, result: makeResult(), nowMs: T0 });
    const { deleted } = await callDo<ClearResponse>(cache, { op: 'clear' });
    expect(deleted).toBe(2);
    expect(storage.size).toBe(0);
  });

  it('the alarm sweep deletes expired entries and reschedules for the next expiry', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      // A expires at T0+1000, B at T0+5000; the DO schedules its alarm at the soonest.
      await callDo(cache, {
        op: 'put',
        input: { ...baseInput, productId: 1 },
        result: makeResult(),
        ttlSeconds: 1,
      });
      await callDo(cache, {
        op: 'put',
        input: { ...baseInput, productId: 2 },
        result: makeResult(),
        ttlSeconds: 5,
      });
      expect(await storage.getAlarm()).toBe(T0 + 1_000);

      // Fire the alarm at T0+1000: A is swept, B survives, alarm moves to B's expiry.
      vi.setSystemTime(T0 + 1_000);
      await fireAlarm(storage, cache);
      expect(storage.size).toBe(1);
      expect(await storage.getAlarm()).toBe(T0 + 5_000);
      expect(
        (await callDo<GetResponse>(cache, { op: 'get', input: { ...baseInput, productId: 2 }, nowMs: T0 + 1_000 })).found,
      ).toBe(true);

      // Fire at T0+5000: everything gone, no further alarm.
      vi.setSystemTime(T0 + 5_000);
      await fireAlarm(storage, cache);
      expect(storage.size).toBe(0);
      expect(await storage.getAlarm()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('IdempotencyDO — protocol errors', () => {
  it('rejects invalid JSON with 400', async () => {
    const { do: cache } = createDo();
    const response = await cache.fetch(
      new Request('https://do.internal/', { method: 'POST', body: 'nope' }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects unknown ops and bad TTLs with 400', async () => {
    const { do: cache } = createDo();
    expect((await callDoRaw(cache, { op: 'explode' })).status).toBe(400);
    expect((
      await callDoRaw(cache, { op: 'put', input: baseInput, result: {}, ttlSeconds: 0, nowMs: T0 })
    ).status).toBe(400);
  });
});
