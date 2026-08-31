/**
 * Readiness service (task 6.4, design D8) — port of
 * packages/application-api/src/observability/readiness.service.ts.
 *
 * Verifies the two shared dependencies the API Worker cannot serve
 * traffic without: D1 (a `SELECT 1` roundtrip through the drizzle D1
 * provider, task 2.4) and the Durable Object layer (a cheap `ping`
 * against a dedicated RateLimiterDO instance). Each check runs under a
 * short timeout so the readiness endpoint answers within the uptime-probe
 * budget even when a dependency hangs, and the response body carries the
 * per-dependency status — a Worker with a dead dependency must not be
 * reported ready (spec: deployment-observability, "Dependency-aware
 * health checks").
 *
 * Response shape is the Nest ReadinessResponse contract with the check
 * keys renamed to the actual dependencies (`postgres` → `d1`,
 * `redis` → `durableObjects`); every field name and the `up`/`down`
 * semantics are preserved exactly. "Not configured" is a down
 * dependency, not a silent pass — the Nest Redis-null parity.
 *
 * Liveness is intentionally NOT implemented here — liveness stays cheap
 * and process-only (see routes/health.routes.ts).
 *
 * @module ReadinessService
 */

import { getDrizzleD1 } from '../../../../packages/data-platform/src/db/d1.module';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/db/d1.provider';
import type { Env } from '../env';
import { pingRateLimiter } from '../do/client';

/** Result of a single dependency probe (Nest DependencyCheck parity). */
export interface DependencyCheck {
  readonly status: 'up' | 'down';
  readonly latencyMs: number | null;
  readonly error?: string;
}

/** Readiness response body — overall status plus per-dependency detail. */
export interface ReadinessResponse {
  readonly status: 'ok' | 'error';
  readonly timestamp: string;
  readonly checks: {
    readonly d1: DependencyCheck;
    readonly durableObjects: DependencyCheck;
  };
}

/**
 * Per-dependency budget, ported unchanged from the Nest ReadinessService
 * (CHECK_TIMEOUT_MS = 1500): both checks combined still answer far inside
 * the 3 s budget the Kubernetes probe used — the same headroom now
 * benefits external uptime monitors keying off `/api/v1/health/ready`.
 */
export const CHECK_TIMEOUT_MS = 1_500;

/**
 * Reject with a timeout error when `promise` exceeds `ms`. Ported from
 * the Nest service minus `timer.unref()` — a Node-only API (workerd
 * timers are plain numbers with no unref), and its purpose (letting the
 * process exit with a live timer) has no Worker-runtime equivalent.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function errorMessage(err: unknown): string {
  // Walk to the root cause: drizzle wraps driver failures in a generic
  // "Failed to run the query" error, and the cause chain is where the
  // operator-meaningful detail lives — the whole point of carrying
  // `error` in the readiness body.
  let current = err;
  while (current instanceof Error && current.cause instanceof Error) {
    current = current.cause;
  }
  return current instanceof Error ? current.message : String(current);
}

/** Probe both dependencies and assemble the readiness body. */
export async function checkReadiness(env: Env): Promise<ReadinessResponse> {
  const [d1, durableObjects] = await Promise.all([
    checkD1(env),
    checkDurableObjects(env),
  ]);

  return {
    status: d1.status === 'up' && durableObjects.status === 'up' ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    checks: { d1, durableObjects },
  };
}

async function checkD1(env: Env): Promise<DependencyCheck> {
  const start = Date.now();
  if (!env.DB) {
    // A deployment that expects D1 readiness must bind it (wrangler
    // d1_databases) — "not configured" is a down dependency, matching
    // the Nest service's unconfigured-Redis treatment.
    return { status: 'down', latencyMs: null, error: 'D1 binding not configured' };
  }
  try {
    // Plain-string raw query (Nest ported `db.execute('SELECT 1')`) —
    // drizzle-orm is data-platform's dependency, never imported directly
    // from Worker code. The cast crosses the workers-types → provider
    // `D1DatabaseLike` boundary only (the binding's declare-shape differs
    // from the driver surface getDrizzleD1 types against); the same
    // crossing every harness and repository call site already makes.
    await withTimeout(
      getDrizzleD1(env.DB as unknown as D1DatabaseLike).run('SELECT 1'),
      CHECK_TIMEOUT_MS,
      'd1 SELECT 1',
    );
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: errorMessage(err),
    };
  }
}

async function checkDurableObjects(env: Env): Promise<DependencyCheck> {
  const start = Date.now();
  if (!env.RATE_LIMITER) {
    // Nest checkRedis parity: an unconfigured dependency is down with no
    // latency measured — the probe never ran. Same message the DO
    // client's stub guard throws, kept stable in the readiness body.
    return {
      status: 'down',
      latencyMs: null,
      error: 'RATE_LIMITER Durable Object binding is not configured',
    };
  }
  try {
    await withTimeout(pingRateLimiter(env), CHECK_TIMEOUT_MS, 'RateLimiterDO ping');
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: errorMessage(err),
    };
  }
}
