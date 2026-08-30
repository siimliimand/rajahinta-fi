/**
 * Typed DO clients for the rate limiter and idempotency cache.
 *
 * One import away for middleware and route handlers (task 3.3): resolve
 * the stub, send a typed request, get a typed response. The rate limiter
 * uses one DO instance per client key (`idFromName`) so hot clients never
 * serialize against each other; the idempotency cache uses a single
 * instance so put-if-absent and version invalidation are globally exact
 * (sharding is a load-test-gated follow-up, not a behavior change).
 *
 * @module DoClients
 */

import type { Env } from '../env';
import type {
  RateLimitDecision,
  RateLimiterRequest,
} from './rate-limiter.do';
import type { CacheKeyInput, IdempotencyEntry, IdempotencyRequest } from './idempotency.do';

/** Base URL for internal DO fetch requests — host is irrelevant, kept https for realism. */
const DO_URL = 'https://do.internal/';

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

/** Resolve the per-client RateLimiterDO instance (one per client key). */
export function rateLimiterStub(env: Env, clientKey: string): DurableObjectStub {
  const namespace = env.RATE_LIMITER;
  if (!namespace) {
    throw new Error('RATE_LIMITER Durable Object binding is not configured');
  }
  return namespace.get(namespace.idFromName(clientKey));
}

/** Preflight-shaped profile params. */
export interface RateLimitParams {
  readonly profile: string;
  readonly limit: number;
  readonly windowMs: number;
}

/**
 * Admission check — one DO round trip returns the full decision
 * (allowed / remaining / resetAtMs / retryAfterSeconds), so a 429 with
 * Retry-After never needs a second fetch.
 */
export async function checkRateLimit(
  env: Env,
  clientKey: string,
  params: RateLimitParams,
): Promise<RateLimitDecision> {
  return callRateLimiter<RateLimitDecision>(env, clientKey, {
    op: 'check',
    ...params,
  });
}

/** Active count against the limit, without admitting a request. */
export async function rateLimitRemaining(
  env: Env,
  clientKey: string,
  params: RateLimitParams,
): Promise<number> {
  const { remaining } = await callRateLimiter<{ remaining: number }>(env, clientKey, {
    op: 'remaining',
    ...params,
  });
  return remaining;
}

/** Unix ms when the client's current window resets. */
export async function rateLimitResetAt(
  env: Env,
  clientKey: string,
  params: Omit<RateLimitParams, 'limit'>,
): Promise<number> {
  const { resetAtMs } = await callRateLimiter<{ resetAtMs: number }>(env, clientKey, {
    op: 'resetAt',
    ...params,
  });
  return resetAtMs;
}

async function callRateLimiter<T>(
  env: Env,
  clientKey: string,
  request: RateLimiterRequest,
): Promise<T> {
  const response = await rateLimiterStub(env, clientKey).fetch(
    new Request(DO_URL, {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  );
  if (!response.ok) {
    throw new Error(`RateLimiterDO request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Idempotency cache
// ---------------------------------------------------------------------------

/** Resolve the (single) IdempotencyDO instance. */
export function idempotencyStub(env: Env): DurableObjectStub {
  const namespace = env.IDEMPOTENCY;
  if (!namespace) {
    throw new Error('IDEMPOTENCY Durable Object binding is not configured');
  }
  return namespace.get(namespace.idFromName('idempotency'));
}

/** Look up a cached result by version-aware calculation inputs. */
export async function idempotencyGet(
  env: Env,
  input: CacheKeyInput,
): Promise<IdempotencyEntry | null> {
  const { found, entry } = await callIdempotency<{ found: boolean; entry?: IdempotencyEntry }>(
    env,
    { op: 'get', input },
  );
  return found && entry !== undefined ? entry : null;
}

/** Store a calculation result (overwrites any existing entry for the key). */
export async function idempotencyPut(
  env: Env,
  input: CacheKeyInput,
  result: unknown,
  options?: { datasetVersions?: readonly string[]; ttlSeconds?: number },
): Promise<void> {
  await callIdempotency(env, {
    op: 'put',
    input,
    result,
    ...options,
  });
}

/**
 * Atomic put-if-absent — true when this call stored the result, false
 * when a live entry already existed (the duplicate-calculation guard).
 */
export async function idempotencyPutIfAbsent(
  env: Env,
  input: CacheKeyInput,
  result: unknown,
  options?: { datasetVersions?: readonly string[]; ttlSeconds?: number },
): Promise<boolean> {
  const { stored } = await callIdempotency<{ stored: boolean }>(env, {
    op: 'putIfAbsent',
    input,
    result,
    ...options,
  });
  return stored;
}

/** Invalidate entries referencing any of the given dataset versions. */
export async function idempotencyInvalidateVersions(
  env: Env,
  versions: string[],
): Promise<number> {
  const { deleted } = await callIdempotency<{ deleted: number }>(env, {
    op: 'invalidateVersions',
    versions,
  });
  return deleted;
}

async function callIdempotency<T>(env: Env, request: IdempotencyRequest): Promise<T> {
  const response = await idempotencyStub(env).fetch(
    new Request(DO_URL, {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  );
  if (!response.ok) {
    throw new Error(`IdempotencyDO request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}
