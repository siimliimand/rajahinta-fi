/**
 * Health endpoint tests (task 6.4) — readiness and liveness contract
 * parity against the Nest HealthController + ReadinessService
 * (packages/application-api/src/index.ts,
 * src/observability/readiness.service.ts).
 *
 * Driven through the full createApp() over the shared harness: real
 * migrated in-memory D1 + real in-memory RateLimiterDO namespace for the
 * healthy path; fakes that throw, reject, or never settle for the down
 * and timeout paths. The timeout cases pin the ported CHECK_TIMEOUT_MS
 * short-timeout enforcement with fake timers — a hung dependency must
 * fail the check at the budget, not hang the probe.
 *
 * @module HealthRoutesTest
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, openMigratedD1, permissiveEnv, request } from './harness';
import { CHECK_TIMEOUT_MS } from '../../services/readiness';
import type { ReadinessResponse } from '../../services/readiness';
import type { Env } from '../../env';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
} from '../../../../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fakes — D1 bindings
// ---------------------------------------------------------------------------

/** D1 fake whose roundtrip rejects — "dead database blocks readiness". */
function throwingD1(error: Error): D1DatabaseLike {
  return {
    prepare: () => {
      throw error;
    },
    batch: async () => {
      throw error;
    },
  };
}

/** D1 fake whose roundtrip never settles — the short timeout must cut it. */
function hangingD1(): D1DatabaseLike {
  const never = <T>(): Promise<T> => new Promise(() => undefined);
  // Drizzle's D1 driver always chains stmt.bind(...params).run() — bind
  // must return the statement for the terminal methods to hang.
  const statement: D1PreparedStatementLike = {
    bind: () => statement,
    first: never,
    run: never,
    all: never,
  };
  return {
    prepare: () => statement,
    batch: never,
  };
}

// ---------------------------------------------------------------------------
// Fakes — DO namespaces
// ---------------------------------------------------------------------------

/** Namespace whose stub fetch rejects — the binding resolves, the call fails. */
function rejectingDoNamespace(error: Error): Env['RATE_LIMITER'] {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      fetch: async () => {
        throw error;
      },
    }),
  } as unknown as Env['RATE_LIMITER'];
}

/** Namespace whose stub fetch never settles — the short timeout must cut it. */
function hangingDoNamespace(): Env['RATE_LIMITER'] {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({ fetch: () => new Promise<Response>(() => undefined) }),
  } as unknown as Env['RATE_LIMITER'];
}

async function getReady(env: Env): Promise<{ res: Response; body: ReadinessResponse }> {
  const res = await request(buildApp(), env, '/api/v1/health/ready');
  return { res, body: (await res.json()) as ReadinessResponse };
}

describe('GET /api/v1/health/ready (readiness)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers 200 all-up over real migrated D1 and the real RateLimiterDO', async () => {
    const { d1 } = openMigratedD1();
    const { res, body } = await getReady(permissiveEnv(d1));

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(body.checks.d1).toEqual({ status: 'up', latencyMs: expect.any(Number) });
    expect(body.checks.durableObjects).toEqual({
      status: 'up',
      latencyMs: expect.any(Number),
    });
  });

  it('dead database blocks readiness — D1 down reported in the body with 503', async () => {
    const env = permissiveEnv(throwingD1(new Error('D1 unavailable')));
    const { res, body } = await getReady(env);

    expect(res.status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.checks.d1).toMatchObject({
      status: 'down',
      error: 'D1 unavailable',
    });
    // The healthy dependency stays reported — the body says which one is down.
    expect(body.checks.durableObjects.status).toBe('up');
  });

  it('unconfigured DO binding is a down dependency, not a silent pass', async () => {
    const { d1 } = openMigratedD1();
    const { res, body } = await getReady(permissiveEnv(d1, { RATE_LIMITER: undefined }));

    expect(res.status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.checks.durableObjects).toEqual({
      status: 'down',
      latencyMs: null,
      error: 'RATE_LIMITER Durable Object binding is not configured',
    });
    expect(body.checks.d1.status).toBe('up');
  });

  it('DO stub failure is reported as down with the underlying error', async () => {
    const { d1 } = openMigratedD1();
    const env = permissiveEnv(d1, {
      RATE_LIMITER: rejectingDoNamespace(new Error('DO isolate crashed')),
    });
    const { res, body } = await getReady(env);

    expect(res.status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.checks.durableObjects).toMatchObject({
      status: 'down',
      error: 'DO isolate crashed',
    });
    expect(body.checks.d1.status).toBe('up');
  });

  it('enforces the short timeout on a hung D1 roundtrip', async () => {
    vi.useFakeTimers();
    const env = permissiveEnv(hangingD1());
    const pending = request(buildApp(), env, '/api/v1/health/ready');

    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    const res = (await pending) as Response;
    const body = (await res.json()) as ReadinessResponse;

    expect(res.status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.checks.d1).toEqual({
      status: 'down',
      latencyMs: expect.any(Number),
      error: `d1 SELECT 1 timed out after ${CHECK_TIMEOUT_MS}ms`,
    });
    // The DO check (fast) is unaffected by the hung dependency.
    expect(body.checks.durableObjects.status).toBe('up');
  });

  it('enforces the short timeout on a hung DO ping', async () => {
    vi.useFakeTimers();
    const { d1 } = openMigratedD1();
    const env = permissiveEnv(d1, { RATE_LIMITER: hangingDoNamespace() });
    const pending = request(buildApp(), env, '/api/v1/health/ready');

    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    const res = (await pending) as Response;
    const body = (await res.json()) as ReadinessResponse;

    expect(res.status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.checks.durableObjects).toEqual({
      status: 'down',
      latencyMs: expect.any(Number),
      error: `RateLimiterDO ping timed out after ${CHECK_TIMEOUT_MS}ms`,
    });
    expect(body.checks.d1.status).toBe('up');
  });

  it('body shape matches the Nest readiness controller output contract', async () => {
    // Healthy body: exactly { status, timestamp, checks: { d1,
    // durableObjects } }, and an up check carries exactly
    // { status, latencyMs } — the ReadinessResponse/DependencyCheck field
    // names of packages/application-api readiness.service.ts, with the
    // check keys renamed to the Worker's actual dependencies.
    const { d1 } = openMigratedD1();
    const healthy = await getReady(permissiveEnv(d1));
    expect(Object.keys(healthy.body).sort()).toEqual(['checks', 'status', 'timestamp']);
    expect(Object.keys(healthy.body.checks).sort()).toEqual(['d1', 'durableObjects']);
    expect(Object.keys(healthy.body.checks.d1).sort()).toEqual(['latencyMs', 'status']);
    expect(Object.keys(healthy.body.checks.durableObjects).sort()).toEqual([
      'latencyMs',
      'status',
    ]);

    // Down body: same document, the failed check gains only `error` —
    // never the unified envelope (dependency status must stay readable
    // from the probe response, Nest controller parity).
    const down = await getReady(
      permissiveEnv(throwingD1(new Error('D1 unavailable')), { RATE_LIMITER: undefined }),
    );
    expect(down.res.status).toBe(503);
    expect(Object.keys(down.body).sort()).toEqual(['checks', 'status', 'timestamp']);
    expect(Object.keys(down.body.checks.d1).sort()).toEqual(['error', 'latencyMs', 'status']);
    expect(Object.keys(down.body.checks.durableObjects).sort()).toEqual([
      'error',
      'latencyMs',
      'status',
    ]);
  });
});

describe('GET /api/v1/health (liveness)', () => {
  it('keeps the task-3.1 contract and performs no binding access', async () => {
    const accesses: string[] = [];
    const poisonedDb = new Proxy(
      {},
      {
        get(_target, prop) {
          accesses.push(String(prop));
          throw new Error(`liveness touched the D1 binding (${String(prop)})`);
        },
      },
    );
    const env = {
      DB: poisonedDb,
      LOG_LEVEL: 'error',
      RATE_LIMITER: undefined,
    } as unknown as Env;

    const res = await request(buildApp(), env, '/api/v1/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', timestamp: expect.any(String) });
    // Process-only: neither the D1 binding nor any DO namespace was touched.
    expect(accesses).toEqual([]);
  });
});
