/**
 * E2E harness (task 3.9, change migrate-to-cloudflare).
 *
 * Boots the REAL createApp() — guards, rate limiting, routes, error
 * envelope — over the established fake-D1 harness (node:sqlite in-memory +
 * the committed drizzle migrations) and in-memory Durable Object
 * namespaces, then drives it with app.request() (Hono's HTTP-level entry:
 * the full middleware chain runs; only the workerd process boundary is
 * absent).
 *
 * The route-port parity harness (src/routes/__tests__/harness.ts) provides
 * the env/DO/fixture primitives; this module composes them for the e2e
 * suites so the parity suite and the e2e suite cannot drift apart.
 *
 * @module E2EHarness
 */

import type { DatabaseSync } from 'node:sqlite';
import type { AppEnv, Env } from '../../src/env';
import { createApp } from '../../src/index';
import {
  openMigratedD1,
  permissiveEnv,
  lockedEnv,
  expectEnvelope,
  request,
  createDoNamespace,
} from '../../src/routes/__tests__/harness';
import { RateLimiterDO } from '../../src/do/rate-limiter.do';
import { IdempotencyDO } from '../../src/do/idempotency.do';
import { ClickCounterDO } from '../../src/do/click-counter.do';

export { openMigratedD1, expectEnvelope, request, createApp };

/** The e2e app — the full createApp() composition, alias kept for readability. */
export const buildE2EApp = createApp;
export type { DatabaseSync, AppEnv, Env };

/** Fresh permissive env — gates open, flags on, NEW DO namespaces per call. */
export function e2eEnv(d1: Env['DB'], overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1 as never, {
    // Callers get their own DO instances unless explicitly overridden —
    // golden cases and the baseline runner each need an isolated rate
    // window (CALCULATOR ceiling is 10/min per client).
    ...overrides,
  }) as Env;
}

export { lockedEnv };

/** Fresh namespace triple, for tests that need to swap bindings mid-suite. */
export function freshDoNamespaces(): {
  RATE_LIMITER: unknown;
  IDEMPOTENCY: unknown;
  CLICK_COUNTER: unknown;
} {
  return {
    RATE_LIMITER: createDoNamespace((state) => new RateLimiterDO(state as never, {})),
    IDEMPOTENCY: createDoNamespace((state) => new IdempotencyDO(state as never, {})),
    CLICK_COUNTER: createDoNamespace((state) => new ClickCounterDO(state as never, {})),
  };
}

/** JSON POST helper carrying the age confirmation the guards require. */
export async function postJson(
  app: ReturnType<typeof createApp>,
  env: Env,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(app, env, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as Promise<Response>;
}

/** Percentile of a sample (nearest-rank, sorted copy). */
export function percentile(latenciesMs: number[], p: number): number {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const rank = Math.min(
    sorted.length,
    Math.max(1, Math.ceil((p / 100) * sorted.length)),
  );
  return sorted[rank - 1]!;
}
