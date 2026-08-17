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
    otherCharges: 0,
    totalCents: 1900,
    currency: 'EUR',
    confidence: 'HIGH' as any,
    confidenceBreakdown: [],
    disclaimer: { text: 'Test', language: 'fi', version: '1.0' },
    classification: { label: 'distance-selling', confidence: 'HIGH' as any, factors: [] } as any,
    metadata: {
      input: { productId: 1, quantity: 1, destination: 'FI' },
      calculationTimestamp: '2026-08-17T08:00:00.000Z',
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
});

// ---------------------------------------------------------------------------
// InMemoryIdempotencyCache
// ---------------------------------------------------------------------------

describe('InMemoryIdempotencyCache', () => {
  let cache: InMemoryIdempotencyCache;

  beforeEach(() => {
    cache = new InMemoryIdempotencyCache({ maxEntries: 100 });
  });

  it('stores and retrieves entries', () => {
    const entry = { result: makeResult(), datasetVersions: ['v1'], createdAt: new Date().toISOString() };
    cache.set('key1', entry);
    expect(cache.get('key1')).toEqual(entry);
  });

  it('returns null for a missing key', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('evicts oldest entries when at capacity', () => {
    const tiny = new InMemoryIdempotencyCache({ maxEntries: 2 });
    tiny.set('a', { result: makeResult(), datasetVersions: ['v1'], createdAt: '' });
    tiny.set('b', { result: makeResult(), datasetVersions: ['v1'], createdAt: '' });
    tiny.set('c', { result: makeResult(), datasetVersions: ['v1'], createdAt: '' });
    expect(tiny.get('a')).toBeNull(); // evicted
    expect(tiny.get('b')).not.toBeNull();
    expect(tiny.get('c')).not.toBeNull();
  });

  it('invalidates entries by dataset version', () => {
    cache.set('k1', { result: makeResult(), datasetVersions: ['v1', 'v2'], createdAt: '' });
    cache.set('k2', { result: makeResult(), datasetVersions: ['v2'], createdAt: '' });
    cache.set('k3', { result: makeResult({ metadata: { datasetVersions: ['v3'] } } as any) as CalculatorResult, datasetVersions: ['v3'], createdAt: '' });

    cache.invalidateVersions(['v2']);

    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k2')).toBeNull();
    expect(cache.get('k3')).not.toBeNull();
  });

  it('does nothing when invalidating empty versions', () => {
    cache.set('k1', { result: makeResult(), datasetVersions: ['v1'], createdAt: '' });
    cache.invalidateVersions([]);
    expect(cache.get('k1')).not.toBeNull();
  });

  it('clears all entries', () => {
    cache.set('a', { result: makeResult(), datasetVersions: ['v1'], createdAt: '' });
    cache.clear();
    expect(cache.get('a')).toBeNull();
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

  it('stores and retrieves a result', () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);
    const result = makeResult();

    service.store(key, result);
    const retrieved = service.lookup(key);

    expect(retrieved).toEqual(result);
  });

  it('returns null when no cached entry exists', () => {
    expect(service.lookup('nonexistent')).toBeNull();
  });

  it('returns null when versions do not match', () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);
    const result = makeResult({ metadata: { datasetVersions: ['tax-v1', 'transport-v1'] } } as any);

    service.store(key, result);

    // Different current versions
    const retrieved = service.lookup(key, ['tax-v2', 'transport-v1']);
    expect(retrieved).toBeNull();
  });

  it('returns cached result when versions match', () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);
    const result = makeResult({ metadata: { datasetVersions: ['tax-v1', 'transport-v1'] } } as any);

    service.store(key, result);

    const retrieved = service.lookup(key, ['tax-v1', 'transport-v1']);
    expect(retrieved).toEqual(result);
  });

  it('returns cached result when no current versions are provided', () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);
    const result = makeResult();

    service.store(key, result);
    const retrieved = service.lookup(key, []);
    expect(retrieved).toEqual(result);
  });

  it('invalidates entries when dataset version changes', () => {
    const input: CacheKeyInput = { productId: 1, quantity: 1, destination: 'FI' };
    const key = service.getCacheKey(input);
    const result = makeResult({ metadata: { datasetVersions: ['tax-v1'] } } as any);

    service.store(key, result);
    service.invalidateOnVersionChange(['tax-v1']);

    expect(service.lookup(key)).toBeNull();
  });

  it('generates a stable content hash for identical results', () => {
    const r1 = makeResult();
    const r2 = makeResult();
    expect(service.getContentHash(r1)).toEqual(service.getContentHash(r2));
  });

  it('generates different content hashes for different results', () => {
    const r1 = makeResult({ totalCents: 1000 });
    const r2 = makeResult({ totalCents: 2000 });
    expect(service.getContentHash(r1)).not.toEqual(service.getContentHash(r2));
  });
});