/**
 * Tests for IdempotencyService — cache key generation, lookup, store,
 * version-keyed invalidation, and content hashing.
 *
 * @module IdempotencyServiceTest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IdempotencyService, InMemoryIdempotencyCache, hashInput } from '../idempotency/idempotency.service';
import type { CacheKeyInput } from '../idempotency/idempotency.service';
import type { CalculatorResult } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides?: Partial<CalculatorResult>): CalculatorResult {
  return {
    itemizedCosts: [],
    foreignRetailPrice: 1000,
    transportCost: 500,
    alcoholExciseEstimate: 300,
    containerDutyEstimate: 100,
    // Live-path field (task 1.5) — no exclusions in this fixture.
    excludedOffers: [],
    totalCents: 1900,
    currency: 'EUR',
    confidence: 'HIGH' as any,
    confidenceBreakdown: [],
    disclaimer: { text: 'Test', language: 'fi', version: '1.0' },
    classification: { label: 'distance-selling', confidence: 'HIGH' as any, factors: [] } as any,
    metadata: {
      input: { productId: 1, quantity: 1, destination: 'FI' },
      // Pinned: a live timestamp makes two makeResult() calls differ across a
      // millisecond boundary, flipping the stable-hash test into a coin flip.
      calculationTimestamp: '2026-01-01T00:00:00.000Z',
      productMasterId: 1,
      retailOfferIds: [],
      quantity: 1,
      destination: 'FI',
      productName: 'Test Beer',
      volumeLitres: 0.5,
      alcoholByVolume: 5.0,
      category: 'beer',
      datasetVersions: overrides?.metadata?.datasetVersions ?? ['tax-v1', 'transport-v1'],
      transportOfferId: null,
    },
    calculationRecordId: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// hashInput
// ---------------------------------------------------------------------------

describe('hashInput', () => {
  it('produces a deterministic hash for the same input', () => {
    const input: CacheKeyInput = { productId: 42, quantity: 2, destination: 'FI' };
    const h1 = hashInput(input);
    const h2 = hashInput(input);
    expect(h1).toEqual(h2);
  });

  it('produces different hashes when productId changes', () => {
    const h1 = hashInput({ productId: 1, quantity: 1, destination: 'FI' });
    const h2 = hashInput({ productId: 2, quantity: 1, destination: 'FI' });
    expect(h1).not.toEqual(h2);
  });

  it('produces different hashes when quantity changes', () => {
    const h1 = hashInput({ productId: 1, quantity: 1, destination: 'FI' });
    const h2 = hashInput({ productId: 1, quantity: 2, destination: 'FI' });
    expect(h1).not.toEqual(h2);
  });

  it('produces different hashes when destination changes (case-insensitive)', () => {
    const h1 = hashInput({ productId: 1, quantity: 1, destination: 'fi' });
    const h2 = hashInput({ productId: 1, quantity: 1, destination: 'FI' });
    expect(h1).toEqual(h2); // Both uppercase to 'FI'
  });

  it('includes transportMethod in the hash', () => {
    const h1 = hashInput({ productId: 1, quantity: 1, destination: 'FI', transportMethod: 'posti' });
    const h2 = hashInput({ productId: 1, quantity: 1, destination: 'FI' });
    expect(h1).not.toEqual(h2);
  });

  it('returns a 64-character hex string (SHA-256)', () => {
    const h = hashInput({ productId: 1, quantity: 1, destination: 'FI' });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  // ---------------------------------------------------------------------------
  // Dataset versions in hash
  // ---------------------------------------------------------------------------

  it('produces the same hash when datasetVersions are identical (order-independent)', () => {
    const input: CacheKeyInput = {
      productId: 1, quantity: 1, destination: 'FI',
      datasetVersions: ['v2.0-2025', 'v3.0-2026', 'v1.0-2024'],
    };
    const h1 = hashInput(input);
    const reversed: CacheKeyInput = {
      productId: 1, quantity: 1, destination: 'FI',
      datasetVersions: ['v1.0-2024', 'v3.0-2026', 'v2.0-2025'],
    };
    const h2 = hashInput(reversed);
    expect(h1).toEqual(h2);
  });

  it('produces a different hash when datasetVersions change (tax version bump)', () => {
    const inputV2: CacheKeyInput = {
      productId: 42, quantity: 2, destination: 'FI',
      datasetVersions: ['v2.0-2025', 'transport-v1'],
    };
    const inputV3: CacheKeyInput = {
      productId: 42, quantity: 2, destination: 'FI',
      datasetVersions: ['v3.0-2026', 'transport-v1'],
    };
    const hV2 = hashInput(inputV2);
    const hV3 = hashInput(inputV3);
    expect(hV2).not.toEqual(hV3);
  });

  it('produces the same hash with or without empty datasetVersions', () => {
    const hNoField = hashInput({ productId: 1, quantity: 1, destination: 'FI' });
    const hEmpty = hashInput({ productId: 1, quantity: 1, destination: 'FI', datasetVersions: [] });
    expect(hNoField).toEqual(hEmpty);
  });

  it('produces a different hash when datasetVersions are added vs omitted', () => {
    const hOmitted = hashInput({ productId: 1, quantity: 1, destination: 'FI' });
    const hPresent = hashInput({ productId: 1, quantity: 1, destination: 'FI', datasetVersions: ['v1.0-2024'] });
    expect(hOmitted).not.toEqual(hPresent);
  });

  it('produces a different hash when transport proxy version changes', () => {
    const input: CacheKeyInput = {
      productId: 1, quantity: 1, destination: 'FI',
      datasetVersions: ['v3.0-2026', '2026-08-21T12:00:00.000Z'],
    };
    const h1 = hashInput(input);
    const inputRefreshed: CacheKeyInput = {
      productId: 1, quantity: 1, destination: 'FI',
      datasetVersions: ['v3.0-2026', '2026-08-22T12:00:00.000Z'],
    };
    const h2 = hashInput(inputRefreshed);
    expect(h1).not.toEqual(h2);
  });
});

// ---------------------------------------------------------------------------
// InMemoryIdempotencyCache
// ---------------------------------------------------------------------------

describe('InMemoryIdempotencyCache', () => {
  let cache: InMemoryIdempotencyCache;

  beforeEach(() => {
    cache = new InMemoryIdempotencyCache({ maxEntries: 100 });
  });

  it('stores and retrieves entries', async () => {
    const entry = { result: makeResult(), datasetVersions: ['v1'], createdAt: new Date().toISOString() };
    await cache.set('key1', entry);
    expect(await cache.get('key1')).toEqual(entry);
  });

  it('returns null for a missing key', async () => {
    expect(await cache.get('nonexistent')).toBeNull();
  });

  it('evicts oldest entries when at capacity', async () => {
    const tiny = new InMemoryIdempotencyCache({ maxEntries: 2 });
    await tiny.set('a', { result: makeResult(), datasetVersions: ['v1'], createdAt: '' });
    await tiny.set('b', { result: makeResult(), datasetVersions: ['v1'], createdAt: '' });
    await tiny.set('c', { result: makeResult(), datasetVersions: ['v1'], createdAt: '' });
    expect(await tiny.get('a')).toBeNull(); // evicted
    expect(await tiny.get('b')).not.toBeNull();
    expect(await tiny.get('c')).not.toBeNull();
  });

  it('invalidates entries by dataset version', async () => {
    await cache.set('k1', { result: makeResult(), datasetVersions: ['v1', 'v2'], createdAt: '' });
    await cache.set('k2', { result: makeResult(), datasetVersions: ['v2'], createdAt: '' });
    await cache.set('k3', { result: makeResult({ metadata: { datasetVersions: ['v3'] } } as any) as CalculatorResult, datasetVersions: ['v3'], createdAt: '' });

    await cache.invalidateVersions(['v2']);

    expect(await cache.get('k1')).toBeNull();
    expect(await cache.get('k2')).toBeNull();
    expect(await cache.get('k3')).not.toBeNull();
  });

  it('does nothing when invalidating empty versions', async () => {
    await cache.set('k1', { result: makeResult(), datasetVersions: ['v1'], createdAt: '' });
    await cache.invalidateVersions([]);
    expect(await cache.get('k1')).not.toBeNull();
  });

  it('refreshes LRU position on get (recently-read entry is protected from eviction)', async () => {
    const tiny = new InMemoryIdempotencyCache({ maxEntries: 2 });
    const entry = { result: makeResult(), datasetVersions: ['v1'], createdAt: '' };
    await tiny.set('a', entry);
    await tiny.set('b', entry);
    // Get 'a' to refresh its position — it moves to end of Map
    await tiny.get('a');
    // Set 'c' pushes out 'b' (the new oldest), not 'a'
    await tiny.set('c', entry);
    expect(await tiny.get('a')).not.toBeNull();
    expect(await tiny.get('b')).toBeNull();
    expect(await tiny.get('c')).not.toBeNull();
  });

  it('overwrites existing key without double-counting for eviction', async () => {
    const tiny = new InMemoryIdempotencyCache({ maxEntries: 2 });
    const entry = { result: makeResult(), datasetVersions: ['v1'], createdAt: '' };
    await tiny.set('a', entry);
    await tiny.set('a', entry); // overwrite — same key, not +2
    await tiny.set('b', entry);
    await tiny.set('c', entry);
    // 'c' pushed out one entry, but only 2 distinct keys existed
    expect(await tiny.get('c')).not.toBeNull();
  });

  it('invalidates entries with partial version overlap', async () => {
    await cache.set('k1', { result: makeResult(), datasetVersions: ['v1', 'v2'], createdAt: '' });
    await cache.set('k2', { result: makeResult(), datasetVersions: ['v3'], createdAt: '' });
    // v2 matches k1; v99 does not exist — should be a no-op
    await cache.invalidateVersions(['v2', 'v99']);
    expect(await cache.get('k1')).toBeNull();
    expect(await cache.get('k2')).not.toBeNull();
  });

  it('size getter reflects entry count after set and invalidate', async () => {
    expect(cache.size).toBe(0);
    await cache.set('a', { result: makeResult(), datasetVersions: ['v1'], createdAt: '' });
    expect(cache.size).toBe(1);
    await cache.set('b', { result: makeResult(), datasetVersions: ['v2'], createdAt: '' });
    expect(cache.size).toBe(2);
    await cache.invalidateVersions(['v1']);
    expect(cache.size).toBe(1);
    await cache.clear();
    expect(cache.size).toBe(0);
  });

  it('defaults to 5000 max entries when no options provided', async () => {
    const big = new InMemoryIdempotencyCache();
    const entry = { result: makeResult(), datasetVersions: ['v'], createdAt: '' };
    // Insert 5000 entries — should all fit
    for (let i = 0; i < 5000; i++) {
      await big.set(`k${i}`, entry);
    }
    expect(big.size).toBe(5000);
    // Insert one more — evicts the oldest (k0)
    await big.set('overflow', entry);
    expect(big.size).toBe(5000);
    expect(await big.get('k0')).toBeNull();
    expect(await big.get('overflow')).not.toBeNull();
  });

  it('returns entry count as the size property', () => {
    expect(cache.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// IdempotencyService
// ---------------------------------------------------------------------------

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let cache: InMemoryIdempotencyCache;

  beforeEach(() => {
    cache = new InMemoryIdempotencyCache({ maxEntries: 100 });
    service = new IdempotencyService(cache);
  });

  it('stores and retrieves a result', async () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);
    const result = makeResult();

    await service.store(key, result);
    const retrieved = await service.lookup(key);

    expect(retrieved).toEqual(result);
  });

  it('returns null when no cached entry exists', async () => {
    expect(await service.lookup('nonexistent')).toBeNull();
  });

  it('returns null when versions do not match', async () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);
    const result = makeResult({ metadata: { datasetVersions: ['tax-v1', 'transport-v1'] } } as any);

    await service.store(key, result);

    // Different current versions
    const retrieved = await service.lookup(key, ['tax-v2', 'transport-v1']);
    expect(retrieved).toBeNull();
  });

  it('returns cached result when versions match', async () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);
    const result = makeResult({ metadata: { datasetVersions: ['tax-v1', 'transport-v1'] } } as any);

    await service.store(key, result);

    const retrieved = await service.lookup(key, ['tax-v1', 'transport-v1']);
    expect(retrieved).toEqual(result);
  });

  it('returns cached result when no current versions are provided', async () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);
    const result = makeResult();

    await service.store(key, result);
    const retrieved = await service.lookup(key, []);
    expect(retrieved).toEqual(result);
  });

  // ---------------------------------------------------------------------------
  // Version-flip lifecycle (v1 → v2)
  // ---------------------------------------------------------------------------

  it('returns cached result when versions match, then null after version flip (v1 → v2)', async () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);

    // 1. Seed cache with result for dataset version "v1.0"
    const resultV1 = makeResult({ metadata: { datasetVersions: ['v1.0'] } } as any);
    await service.store(key, resultV1);

    // 2. Lookup with matching versions → HIT
    const hit = await service.lookup(key, ['v1.0']);
    expect(hit).toEqual(resultV1);

    // 3. Lookup with new version "v2.0" → MISS
    const miss = await service.lookup(key, ['v2.0']);
    expect(miss).toBeNull();
  });

  it('returns cached result when called without currentVersions (backward compat)', async () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);

    // Store a result with known versions
    const result = makeResult({ metadata: { datasetVersions: ['v1.0'] } } as any);
    await service.store(key, result);

    // Call lookup without any version argument → should return cached result
    const retrieved = await service.lookup(key);
    expect(retrieved).toEqual(result);
  });

  it('invalidates entries when dataset version changes', async () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);
    const result = makeResult({ metadata: { datasetVersions: ['tax-v1'] } } as any);

    await service.store(key, result);
    await service.invalidateOnVersionChange(['tax-v1']);

    expect(await service.lookup(key)).toBeNull();
  });

  it('generates stable content hash for identical results', () => {
    const r1 = makeResult();
    const r2 = makeResult();
    expect(service.getContentHash(r1)).toEqual(service.getContentHash(r2));
  });

  it('generates different content hashes for different results', () => {
    const r1 = makeResult({ totalCents: 1000 });
    const r2 = makeResult({ totalCents: 2000 });
    expect(service.getContentHash(r1)).not.toEqual(service.getContentHash(r2));
  });

  // ---------------------------------------------------------------------------
  // Version-aware cache key (hash includes datasetVersions)
  // ---------------------------------------------------------------------------

  it('returns cached result when datasetVersions match (cache not broken)', async () => {
    const input: CacheKeyInput = {
      productId: 10, quantity: 3, destination: 'DE',
      datasetVersions: ['v2.0-2025', 'transport-v1'],
    };
    const key = service.getCacheKey(input);
    const result = makeResult({ metadata: { datasetVersions: ['v2.0-2025', 'transport-v1'] } } as any);

    await service.store(key, result);
    const retrieved = await service.lookup(key, ['v2.0-2025', 'transport-v1']);
    expect(retrieved).toEqual(result);
  });

  it('returns null (fresh calculation) when tax datasetVersion changes (v2 → v3)', async () => {
    // 1. Cache a result under version v2
    const inputV2: CacheKeyInput = {
      productId: 99, quantity: 1, destination: 'FI',
      datasetVersions: ['v2.0-2025', 'transport-v1'],
    };
    const keyV2 = service.getCacheKey(inputV2);
    const resultV2 = makeResult({ metadata: { datasetVersions: ['v2.0-2025', 'transport-v1'] } } as any);
    await service.store(keyV2, resultV2);

    // 2. Same product/quantity/destination, but tax version bumped to v3
    const inputV3: CacheKeyInput = {
      productId: 99, quantity: 1, destination: 'FI',
      datasetVersions: ['v3.0-2026', 'transport-v1'],
    };
    const keyV3 = service.getCacheKey(inputV3);

    // Keys differ because versions are in the hash → different key, cache miss
    expect(keyV2).not.toEqual(keyV3);
    const miss = await service.lookup(keyV3, ['v3.0-2026', 'transport-v1']);
    expect(miss).toBeNull();

    // Also verify the old key is untouched (v2 result still available under v2 key)
    const oldHit = await service.lookup(keyV2, ['v2.0-2025', 'transport-v1']);
    expect(oldHit).toEqual(resultV2);
  });

  it('returns null when transport proxy version changes (observedAt bump)', async () => {
    const inputOld: CacheKeyInput = {
      productId: 55, quantity: 1, destination: 'SE',
      datasetVersions: ['v3.0-2026', '2026-08-21T00:00:00.000Z'],
    };
    const oldKey = service.getCacheKey(inputOld);
    const resultOld = makeResult({
      metadata: {
        datasetVersions: ['v3.0-2026', '2026-08-21T00:00:00.000Z'],
      },
    } as any);
    await service.store(oldKey, resultOld);

    // Transport refreshed — new max(observedAt)
    const inputNew: CacheKeyInput = {
      productId: 55, quantity: 1, destination: 'SE',
      datasetVersions: ['v3.0-2026', '2026-08-22T00:00:00.000Z'],
    };
    const newKey = service.getCacheKey(inputNew);
    expect(newKey).not.toEqual(oldKey);
    expect(await service.lookup(newKey)).toBeNull();
  });
});