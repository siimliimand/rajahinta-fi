/**
 * RedisIdempotencyCache — Redis-backed idempotency store keyed by input hash.
 *
 * Cache entries are stored as `idemp:{hash}` with JSON-serialized values.
 * A secondary index (`idemp:ver:{datasetVersion}`) tracks which cache keys
 * reference each dataset version, enabling efficient version-driven invalidation
 * without scanning the entire keyspace.
 *
 * @module RedisIdempotencyCache
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import type { IIdempotencyCache, CacheEntry } from './idempotency.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default TTL for cache entries (seconds).  Default: 1 hour. */
const DEFAULT_TTL_SECONDS = 3_600;

/** Default TTL for stale version-index cleanup (seconds).  24 hours. */
const VERSION_INDEX_TTL_SECONDS = 86_400;

const KEY_PREFIX = 'idemp:';
const VERSION_INDEX_PREFIX = 'idemp:ver:';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Configuration for {@link RedisIdempotencyCache}. */
export interface RedisIdempotencyOptions {
  /** Redis connection URL (e.g. `redis://localhost:6379`). */
  readonly url?: string;
  /** Pre-configured Redis client (alternative to `url`). */
  readonly client?: Redis;
  /** TTL for cache entries in seconds.  Default: 3600. */
  readonly ttlSeconds?: number;
}

// ---------------------------------------------------------------------------
// Redis-backed implementation
// ---------------------------------------------------------------------------

/**
 * Redis-backed idempotency cache.
 *
 * Key format:
 * - Data: `idemp:{sha256-hex}` → JSON `{ result, datasetVersions, createdAt }`
 * - Version index: `idemp:ver:{version}` → Redis Set of hash keys
 *
 * Invalidation clears version-index Sets and their referenced data keys.
 * TTL is applied on every write so stale entries self-evict.
 */
@Injectable()
export class RedisIdempotencyCache implements IIdempotencyCache {
  private readonly redis: Redis;
  private readonly ttl: number;
  private readonly logger = new Logger(RedisIdempotencyCache.name);

  /** Approximate entry count, tracked in-memory (not authoritative). */
  private _size = 0;

  constructor(@Optional() options?: RedisIdempotencyOptions) {
    if (options?.client) {
      this.redis = options.client;
    } else {
      this.redis = new Redis(options?.url ?? 'redis://localhost:6379', {
        lazyConnect: true,
        maxRetriesPerRequest: null,
        enableOfflineQueue: true,
      });
    }
    this.ttl = options?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  // ---------------------------------------------------------------------------
  // IIdempotencyCache
  // ---------------------------------------------------------------------------

  async get(key: string): Promise<CacheEntry | null> {
    const raw = await this.redis.get(KEY_PREFIX + key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as CacheEntry;
    } catch {
      this.logger.warn(`Corrupt cache entry for key "${key}", deleting`);
      await this.redis.del(KEY_PREFIX + key);
      return null;
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const redisKey = KEY_PREFIX + key;
    const pipeline = this.redis.pipeline();

    // Store the cache entry with TTL
    pipeline.setex(redisKey, this.ttl, JSON.stringify(entry));

    // Update version index — each version gets a Set containing this key
    for (const version of entry.datasetVersions) {
      const verIndexKey = VERSION_INDEX_PREFIX + version;
      pipeline.sadd(verIndexKey, key);
      // Set a generous TTL on the index so orphaned entries don't accumulate
      pipeline.expire(verIndexKey, VERSION_INDEX_TTL_SECONDS);
    }

    await pipeline.exec();
    this._size++;
    this.logger.debug(`Cached result for ${redisKey} (TTL: ${this.ttl}s)`);
  }

  async invalidateVersions(versions: string[]): Promise<void> {
    if (versions.length === 0) return;

    const pipeline = this.redis.pipeline();
    let totalKeys = 0;

    for (const version of versions) {
      const verIndexKey = VERSION_INDEX_PREFIX + version;

      // Retrieve all cache keys that reference this version
      const members = await this.redis.smembers(verIndexKey);

      if (members.length === 0) continue;

      // Delete the cache entries
      for (const member of members) {
        pipeline.del(KEY_PREFIX + member);
        this._size = Math.max(0, this._size - 1);
      }

      // Delete the version index Set
      pipeline.del(verIndexKey);

      totalKeys += members.length;
    }

    if (totalKeys > 0) {
      await pipeline.exec();
      this.logger.log(
        `Invalidated ${totalKeys} cache entries across versions: ${versions.join(', ')}`,
      );
    }
  }

  async clear(): Promise<void> {
    // Scan all idemp:* and idemp:ver:* keys and delete them in batches
    let cursor = '0';
    let totalDeleted = 0;
    const pipeline = this.redis.pipeline();

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${KEY_PREFIX}*`,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        pipeline.del(...keys);
        totalDeleted += keys.length;
      }
    } while (cursor !== '0');

    // Also clear version-index keys
    let vcursor = '0';
    do {
      const [nextVcursor, vkeys] = await this.redis.scan(
        vcursor,
        'MATCH',
        `${VERSION_INDEX_PREFIX}*`,
        'COUNT',
        100,
      );
      vcursor = nextVcursor;

      if (vkeys.length > 0) {
        pipeline.del(...vkeys);
        totalDeleted += vkeys.length;
      }
    } while (vcursor !== '0');

    if (totalDeleted > 0) {
      await pipeline.exec();
    }

    this._size = 0;
    this.logger.log(`Cleared ${totalDeleted} cache entries from Redis`);
  }

  get size(): number {
    return this._size;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle helper
  // ---------------------------------------------------------------------------

  /** Gracefully disconnect from Redis. */
  async quit(): Promise<void> {
    await this.redis.quit();
  }
}