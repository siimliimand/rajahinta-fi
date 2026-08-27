/**
 * IdempotencyService — version-keyed cached calculator results.
 *
 * Generates a deterministic cache key from input parameters and stores
 * results alongside the dataset versions that produced them.  Cache
 * invalidation is driven by dataset version changes, not TTL.
 *
 * In-memory for Phase 1; implements {@link IIdempotencyCache} so the
 * backing store can be swapped for Redis in production.
 *
 * @module IdempotencyService
 */

import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CalculatorResult } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Injection token
// ---------------------------------------------------------------------------

/** Injection token for the idempotency cache backend. */
export const IDEMPOTENCY_CACHE = 'IDEMPOTENCY_CACHE';

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

/** A single cache entry keyed by input hash. */
export interface CacheEntry {
  /** The cached calculation result. */
  readonly result: CalculatorResult;
  /** Dataset versions that produced this result. */
  readonly datasetVersions: readonly string[];
  /** When the entry was created (ISO 8601). */
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Cache options
// ---------------------------------------------------------------------------

/** Options for configuring the idempotency cache. */
export interface IdempotencyOptions {
  /** Maximum number of entries before eviction (LRU). Default: 5000. */
  readonly maxEntries?: number;
}

// ---------------------------------------------------------------------------
// Cache interface — replaceable for production
// ---------------------------------------------------------------------------

/**
 * Pluggable cache backend for idempotency storage.
 *
 * Phase 1 provides an in-memory implementation; swap to Redis or
 * another distributed store by providing an alternative binding.
 */
export interface IIdempotencyCache {
  /** Retrieve a cached entry, or null on miss. */
  get(key: string): Promise<CacheEntry | null>;
  /** Store an entry. */
  set(key: string, entry: CacheEntry): Promise<void>;
  /** Delete entries whose datasetVersions contain any of the given versions. */
  invalidateVersions(versions: string[]): Promise<void>;
  /** Clear all entries. */
  clear(): Promise<void>;
  /** Current entry count. */
  readonly size: number;
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

/** Input parameters that uniquely identify a calculation request. */
export interface CacheKeyInput {
  readonly productId: number;
  readonly quantity: number;
  readonly destination: string;
  readonly transportMethod?: string;
  /**
   * Basket items — present only for basket optimization requests.
   *
   * When set, `productId` and `quantity` are ignored (the basket items
   * replace the single product dimension).  This field lets
   * `hashInput` produce a deterministic key for multi-item basket inputs
   * without breaking existing calculator-only callers who never set it.
   */
  readonly items?: readonly { productId: number; quantity: number }[];
  /**
   * Resolved dataset version labels (tax + transport) at the time of request.
   *
   * Tax: returned by `ITaxRuleRepositoryPort.findActiveVersionLabels()` —
   *      currently active version labels such as `["v1.0-2024","v2.0-2025","v3.0-2026"]`.
   * Transport: no explicit version identity exists yet.  Callers should supply
   *           `max(refreshedAt)` of all active transport offers as a stable proxy,
   *           formatted as ISO-8601 strings.  When omitted (empty or undefined),
   *           versioning is not included in the hash and the defence-in-depth
   *           lookup-time comparison remains the sole protection.
   *
   * The array is sorted before hashing so order does not affect the cache key.
   */
  readonly datasetVersions?: readonly string[];
}

/**
 * Deterministic SHA-256 hash of the input parameters and resolved dataset
 * versions.
 *
 * The hash is stable across process restarts — cache invalidation is
 * driven by dataset version changes, not TTL or redeployment.
 *
 * When `datasetVersions` is present, the hash differs after a dataset
 * version change, producing a different cache key and guaranteeing a
 * fresh calculation.  When absent (legacy callers, explicit idempotency
 * keys), the lookup-time comparison in {@link IdempotencyService.lookup}
 * remains the defence-in-depth.
 */
export function hashInput(input: CacheKeyInput): string {
  const h = createHash('sha256');

  // When basket items are provided, hash each item instead of the single
  // productId/quantity (basket replaces the single-product dimension).
  if (input.items !== undefined && input.items.length > 0) {
    for (const item of input.items) {
      h.update(String(item.productId));
      h.update('|');
      h.update(String(item.quantity));
      h.update('|');
    }
  } else {
    h.update(String(input.productId));
    h.update('|');
    h.update(String(input.quantity));
    h.update('|');
  }

  h.update(input.destination.toUpperCase());
  h.update('|');
  h.update(input.transportMethod ?? '__NONE__');

  // Include dataset versions (sorted for determinism) when provided.
  // The sentinel marker ensures the version section is unambiguous even
  // when all components happen to be empty.
  h.update('|V|');
  if (input.datasetVersions && input.datasetVersions.length > 0) {
    const sorted = [...input.datasetVersions].sort();
    for (const v of sorted) {
      h.update(v);
      h.update('|');
    }
  }

  return h.digest('hex');
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

/**
 * LRU-ish in-memory cache backed by a Map.
 *
 * Evicts the oldest entries when `maxEntries` is exceeded.  The Map
 * iteration order is insertion-order, so Map.keys().next() yields the
 * oldest entry.
 */
@Injectable()
export class InMemoryIdempotencyCache implements IIdempotencyCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly logger = new Logger(InMemoryIdempotencyCache.name);

  constructor(@Optional() options?: IdempotencyOptions) {
    this.maxEntries = options?.maxEntries ?? 5000;
  }

  async get(key: string): Promise<CacheEntry | null> {
    const entry = this.store.get(key);
    if (entry === undefined) return null;
    // Refresh — delete & re-insert to move to end (LRU-friendly)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    // Evict oldest entries when at capacity
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        this.logger.debug(`Evicted oldest cache entry: ${oldestKey}`);
      }
    }
    this.store.set(key, entry);
  }

  async invalidateVersions(versions: string[]): Promise<void> {
    if (versions.length === 0) return;
    const versionSet = new Set(versions);
    let evicted = 0;

    for (const [key, entry] of this.store) {
      if (entry.datasetVersions.some((v) => versionSet.has(v))) {
        this.store.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      this.logger.log(
        `Invalidated ${evicted} cache entries referencing dataset versions: ${versions.join(', ')}`,
      );
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Facade over the idempotency cache.
 *
 * Generates cache keys, stores/retrieves results, and exposes
 * version-aware invalidation.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @Inject(IDEMPOTENCY_CACHE) private readonly cache: IIdempotencyCache,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Generate a deterministic cache key from calculation inputs.
   */
  getCacheKey(input: CacheKeyInput): string {
    return hashInput(input);
  }

  /**
   * Look up a cached result by key.
   *
   * Returns the result only when the cached dataset versions match the
   * currently expected versions (passed via `currentVersions`).  If the
   * caller does not supply current versions, any cached result is returned.
   *
   * @param key — cache key from {@link getCacheKey}
   * @param currentVersions — dataset versions the caller expects; when
   *        provided, the result is only returned if versions match.
   *        Pass an empty array to skip version checking.
   */
  async lookup(
    key: string,
    currentVersions?: readonly string[],
  ): Promise<CalculatorResult | null> {
    const entry = await this.cache.get(key);
    if (entry === null) return null;

    // Version check: if caller provides expected versions and they differ
    // from the cached versions, treat as miss.
    if (
      currentVersions !== undefined &&
      currentVersions.length > 0 &&
      !this.versionsMatch(entry.datasetVersions, currentVersions)
    ) {
      this.logger.debug(
        `Cache miss for ${key}: dataset versions changed (cached=${entry.datasetVersions.join(',')}, current=${currentVersions.join(',')})`,
      );
      return null;
    }

    return entry.result;
  }

  /**
   * Store a calculation result in the cache.
   *
   * @param key — cache key from {@link getCacheKey}
   * @param result — the calculator result
   */
  async store(key: string, result: CalculatorResult): Promise<void> {
    const entry: CacheEntry = {
      result,
      datasetVersions: result.metadata.datasetVersions,
      createdAt: new Date().toISOString(),
    };
    await this.cache.set(key, entry);
    this.logger.debug(
      `Cached result for ${key} (versions: ${entry.datasetVersions.join(',')})`,
    );
  }

  /**
   * Invalidate all cache entries that reference any of the given dataset
   * versions.  Called when a new dataset version is detected.
   */
  async invalidateOnVersionChange(versions: string[]): Promise<void> {
    await this.cache.invalidateVersions(versions);
  }

  /**
   * Get the content hash for a calculation result — stable across
   * identical results, changes when any field changes.
   */
  getContentHash(result: CalculatorResult): string {
    const h = createHash('sha256');
    h.update(JSON.stringify(result));
    return h.digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Compare two version arrays for equality (order-independent).
   */
  private versionsMatch(
    a: readonly string[],
    b: readonly string[],
  ): boolean {
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every((v) => setB.has(v));
  }
}