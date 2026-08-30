/**
 * Worker idempotency facade — the IdempotencyService surface the Nest
 * calculator/basket controllers consume, re-hosted over IdempotencyDO
 * (task 3.5; design D5).
 *
 * Nest flow preserved exactly (calculator.controller.ts):
 *  1. resolve active dataset versions FIRST, then derive the cache key —
 *     the version-aware key guarantees a fresh calculation after a
 *     dataset bump;
 *  2. client-supplied `x-idempotency-key` values travel verbatim by
 *     contract (raw-key DO namespace);
 *  3. lookup compares the entry's dataset versions against the current
 *     ones (defense in depth — a stale entry is a miss even when a client
 *     key collides across a version change);
 *  4. store() records `result.metadata.datasetVersions`, and the
 *     X-Content-Hash header is the SHA-256 of the serialized result —
 *     stable across cache hits.
 *
 * Hashing uses WebCrypto (Workers-native); the byte stream is the
 * hashCacheKey stream pinned for cross-runtime parity by the DO tests.
 *
 * @module IdempotencyFacade
 */

import type { Env } from '../env';
import {
  hashCacheKey,
  type CacheKeyInput,
  type IdempotencyEntry,
} from '../do/idempotency.do';
import {
  idempotencyGetByKey,
  idempotencyPutByKey,
} from '../do/client';

/** SHA-256 hex digest of a string (WebCrypto — Workers-native). */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derive the deterministic cache key from the calculation inputs plus the
 * resolved dataset versions — `IdempotencyService.getCacheKey` parity.
 */
export const idempotencyCacheKey = hashCacheKey;

/** Order-independent version-array comparison (IdempotencyService parity). */
function versionsMatch(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((v) => setB.has(v));
}

/**
 * Look up a cached result by key. When `currentVersions` is non-empty the
 * entry must carry exactly those versions — a version mismatch is a miss.
 */
export async function idempotencyLookup(
  env: Env,
  key: string,
  currentVersions?: readonly string[],
): Promise<IdempotencyEntry | null> {
  const entry = await idempotencyGetByKey(env, key);
  if (entry === null) return null;

  if (
    currentVersions !== undefined &&
    currentVersions.length > 0 &&
    !versionsMatch(entry.datasetVersions, currentVersions)
  ) {
    return null;
  }
  return entry;
}

/**
 * Store a result under `key`. Versions default to
 * `result.metadata.datasetVersions` inside the DO (store() parity) and
 * may be overridden for results that carry none.
 */
export function idempotencyStore(
  env: Env,
  key: string,
  result: unknown,
  options?: { datasetVersions?: readonly string[] },
): Promise<void> {
  return idempotencyPutByKey(env, key, result, options);
}

/** Content hash for the X-Content-Hash header — getContentHash parity. */
export function idempotencyContentHash(result: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(result));
}

export type { CacheKeyInput };
