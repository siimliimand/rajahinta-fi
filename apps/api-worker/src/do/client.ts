/**
 * Typed DO clients for the rate limiter, idempotency cache, and click
 * counter.
 *
 * One import away for middleware and route handlers (tasks 3.3–3.4):
 * resolve the stub, send a typed request, get a typed response. The rate
 * limiter uses one DO instance per client key (`idFromName`) so hot
 * clients never serialize against each other; the idempotency cache uses
 * a single instance so put-if-absent and version invalidation are
 * globally exact; the click counter uses a single instance so per-pair
 * increments are exact (sharding is a load-test-gated follow-up, not a
 * behavior change).
 *
 * @module DoClients
 */

import type { Env } from '../env';
import type {
  RateLimitDecision,
  RateLimiterRequest,
} from './rate-limiter.do';
import type {
  CacheKeyInput,
  IdempotencyEntry,
  IdempotencyRequest,
  JobClaimOutcome,
} from './idempotency.do';
import type { ClickCounterSnapshot } from './click-counter.do';

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

// ---------------------------------------------------------------------------
// Job claims — background-job dedupe keys (task 4.1, design D6)
// ---------------------------------------------------------------------------

/**
 * Atomically claim a background-job dedupe key (e.g.
 * `price-ingestion-<merchantId>-<hour>`). The Queue consumer runs the job
 * on `claimed`; `already-completed` and `in-flight` mean skip.
 */
export async function claimJob(
  env: Env,
  key: string,
  options?: { staleAfterMs?: number },
): Promise<JobClaimOutcome> {
  const { outcome } = await callIdempotency<{ outcome: JobClaimOutcome }>(env, {
    op: 'claimJob',
    key,
    ...options,
  });
  return outcome;
}

/** Mark a claimed key completed — subsequent deliveries skip it. */
export async function completeJob(
  env: Env,
  key: string,
  options?: { ttlSeconds?: number },
): Promise<void> {
  await callIdempotency(env, { op: 'completeJob', key, ...options });
}

/**
 * Release a claim after a failed run so the Queue redelivery can process
 * the key again (a failed run must never leave a marker that suppresses
 * its own retry).
 */
export async function releaseJob(env: Env, key: string): Promise<void> {
  await callIdempotency(env, { op: 'releaseJob', key });
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

// ---------------------------------------------------------------------------
// Click counter
// ---------------------------------------------------------------------------

/**
 * Resolve the (single) ClickCounterDO instance. Counters aggregate every
 * merchant's outbound links, so one global instance keeps increments
 * exact; per-pair keys inside the instance isolate the counters.
 */
export function clickCounterStub(env: Env): DurableObjectStub {
  const namespace = env.CLICK_COUNTER;
  if (!namespace) {
    throw new Error('CLICK_COUNTER Durable Object binding is not configured');
  }
  return namespace.get(namespace.idFromName('click-counter'));
}

/**
 * Record a click for a merchant link — the DO counterpart of
 * RedisClickAnalyticsService.recordClick (exact, persisted increment;
 * arms the flush alarm). Fire-and-forget belongs to the call site: lost
 * analytics must never break a redirect.
 */
export async function recordClick(
  env: Env,
  merchantId: string,
  url: string,
  options?: { by?: number; flushIntervalMs?: number },
): Promise<void> {
  await callClickCounter(env, { op: 'increment', merchantId, url, ...options });
}

/**
 * Cumulative counts per merchant per URL — getClickCounts parity with
 * the Redis-backed service (same `Record<merchantId, Record<url, n>>`).
 */
export async function getClickCounts(
  env: Env,
): Promise<Record<string, Record<string, number>>> {
  const { counts } = await callClickCounter<{
    counts: Record<string, Record<string, number>>;
  }>(env, { op: 'counts' });
  return counts;
}

/**
 * Hand the pending snapshot payload to the flusher (harvest + take).
 * Returns null when nothing was clicked since the last capture.
 */
export async function drainClickCounter(
  env: Env,
  nowMs?: number,
): Promise<ClickCounterSnapshot | null> {
  const { snapshot } = await callClickCounter<{ snapshot: ClickCounterSnapshot | null }>(
    env,
    { op: 'drain', nowMs },
  );
  return snapshot;
}

async function callClickCounter<T>(env: Env, request: unknown): Promise<T> {
  const response = await clickCounterStub(env).fetch(
    new Request(DO_URL, {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  );
  if (!response.ok) {
    throw new Error(`ClickCounterDO request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}
