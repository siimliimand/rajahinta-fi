/**
 * Price-alert watchlist CRUD route tests (task 2.3, change
 * product-roadmap-phases-1-4) over the FULL app composition
 * (createApp() + registerAlertsRoutes — the exact composition index.ts
 * wires, guards first) on the fake-D1 harness.
 *
 * Pinning here (beyond plain CRUD): the middleware ORDER of the chain
 * sessionAuth → requireFeatureFlag('PRICE_ALERTS') →
 * requireAccountRateLimit — an anonymous caller gets the 401 envelope
 * even with the flag off (flag state never leaks to unauthenticated
 * callers; the scenarios-route order from route-coverage), and the rate
 * limiter buckets per AUTHENTICATED ACCOUNT, not per edge IP.
 *
 * @module AlertsRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  createApp,
  expectEnvelope,
  issueSessionToken,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedProduct,
} from './harness';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';
import { registerAlertsRoutes } from '../alerts.routes';

/**
 * index.ts registers the alerts handlers behind the guards (same slot as
 * the other route ports); the test composition mirrors that exactly.
 */
function alertsApp(): ReturnType<typeof createApp> {
  const app = createApp();
  registerAlertsRoutes(app);
  return app;
}

/**
 * Flag-on env. `FF_PRICE_ALERTS` is read at runtime via the FF_<FLAG>
 * convention (feature-flags.ts); the typed Env var lands with the
 * index.ts/env.ts wiring outside this task's edit scope, hence the cast.
 */
function alertsEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, {
    ...overrides,
    FF_PRICE_ALERTS: 'true',
  } as Partial<Env>);
}

/** Canonical two-account fixture: 7 is the acting owner, 9 the foreigner. */
function seedAccounts(db: ReturnType<typeof openMigratedD1>['db']): void {
  seedAccount(db, { id: 7, userId: 'user-7', email: 'user-7@example.invalid', tier: 'FREE' });
  seedAccount(db, { id: 9, userId: 'user-9', email: 'user-9@placeholder.local', tier: 'FREE' });
}

const cookieOf = (token: string): string => `rajahinta_session=${token}`;

interface Setup {
  db: ReturnType<typeof openMigratedD1>['db'];
  app: ReturnType<typeof alertsApp>;
  env: Env;
  token7: string;
  token9: string;
}

async function setup(flagOn: boolean): Promise<Setup> {
  const { db, d1 } = openMigratedD1();
  seedAccounts(db);
  return {
    db,
    app: alertsApp(),
    env: flagOn ? alertsEnv(d1) : lockedEnv(d1),
    token7: await issueSessionToken(d1, 7),
    token9: await issueSessionToken(d1, 9),
  };
}

interface AlertJson {
  id: number;
  productId: number;
  thresholdCents: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function jsonInit(method: string, token: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', cookie: cookieOf(token) },
    body: JSON.stringify(body),
  };
}

async function createAlert(
  app: Setup['app'],
  env: Env,
  token: string,
  productId: number,
  thresholdCents: number,
): Promise<Response> {
  return request(app, env, '/api/v1/account/alerts', jsonInit('POST', token, { productId, thresholdCents }));
}

// ---------------------------------------------------------------------------
// Guard chain: session → flag (order pinned)
// ---------------------------------------------------------------------------

describe('alerts guard chain — session before flag', () => {
  it('rejects all four methods without a session with the standard 401 envelope', async () => {
    const { app, env } = await setup(false); // flag OFF — auth must still win
    for (const [method, path] of [
      ['GET', '/api/v1/account/alerts'],
      ['POST', '/api/v1/account/alerts'],
      ['PATCH', '/api/v1/account/alerts/1'],
      ['DELETE', '/api/v1/account/alerts/1'],
    ] as const) {
      const res = await request(app, env, path, { method });
      await expectEnvelope(res, 401, { error: 'SessionRequired' });
    }
  });

  it('rejects an authenticated caller with 403 while PRICE_ALERTS is off', async () => {
    const { app, env, token7 } = await setup(false);
    const res = await request(app, env, '/api/v1/account/alerts', {
      headers: { cookie: cookieOf(token7) },
    });
    await expectEnvelope(res, 403, {
      message: 'Feature "PRICE_ALERTS" is not enabled',
    });
  });
});

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------

describe('POST /api/v1/account/alerts', () => {
  it('creates an active alert bound to the session account and returns it', async () => {
    const { db, app, env, token7 } = await setup(true);
    seedProduct(db, { id: 1 });

    const res = await createAlert(app, env, token7, 1, 2499);
    expect(res.status).toBe(201);
    const body = (await res.json()) as AlertJson;
    expect(body.id).toBeGreaterThan(0);
    expect(body.productId).toBe(1);
    expect(body.thresholdCents).toBe(2499);
    expect(body.status).toBe('active');
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
  });

  it('accepts the threshold boundary of 1000000 cents (€10,000)', async () => {
    const { db, app, env, token7 } = await setup(true);
    seedProduct(db, { id: 1 });
    const res = await createAlert(app, env, token7, 1, 1_000_000);
    expect(res.status).toBe(201);
  });

  it.each([0, -100, 1.5, 1_000_001])('rejects thresholdCents %s with 400', async (threshold) => {
    const { db, app, env, token7 } = await setup(true);
    seedProduct(db, { id: 1 });
    const res = await createAlert(app, env, token7, 1, threshold);
    await expectEnvelope(res, 400, { error: 'ValidationError' });
  });

  it('rejects a missing or invalid productId with 400', async () => {
    const { db, app, env, token7 } = await setup(true);
    seedProduct(db, { id: 1 });
    for (const productId of [undefined, 0, -1, 2.5]) {
      const res = await request(app, env, '/api/v1/account/alerts', jsonInit('POST', token7, { productId, thresholdCents: 500 }));
      await expectEnvelope(res, 400, { error: 'ValidationError' });
    }
  });

  it('rejects an unknown product with 404', async () => {
    const { app, env, token7 } = await setup(true);
    const res = await createAlert(app, env, token7, 999_999, 500);
    await expectEnvelope(res, 404, { error: 'ProductNotFound' });
  });

  it('rejects a duplicate (account, product) with 409', async () => {
    const { db, app, env, token7 } = await setup(true);
    seedProduct(db, { id: 1 });
    await createAlert(app, env, token7, 1, 1000);
    const again = await createAlert(app, env, token7, 1, 2000);
    await expectEnvelope(again, 409, { error: 'AlertAlreadyExists' });
  });

  it('scopes the uniqueness to the account: another account may watch the same product', async () => {
    const { db, app, env, token7, token9 } = await setup(true);
    seedProduct(db, { id: 1 });
    await createAlert(app, env, token7, 1, 1000);
    const res = await createAlert(app, env, token9, 1, 1000);
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// GET — list
// ---------------------------------------------------------------------------

describe('GET /api/v1/account/alerts', () => {
  it('lists only the session account’s own alerts', async () => {
    const { db, app, env, token7, token9 } = await setup(true);
    seedProduct(db, { id: 1 });
    seedProduct(db, { id: 2 });
    await createAlert(app, env, token7, 1, 1000);
    await createAlert(app, env, token7, 2, 1500);
    await createAlert(app, env, token9, 1, 999);

    const res = await request(app, env, '/api/v1/account/alerts', {
      headers: { cookie: cookieOf(token7) },
    });
    expect(res.status).toBe(200);
    const alerts = (await res.json()) as AlertJson[];
    expect(alerts.map((a) => a.productId).sort()).toEqual([1, 2]);
    expect(alerts.every((a) => a.thresholdCents !== 999)).toBe(true);
  });

  it('returns an empty array for an account without alerts', async () => {
    const { app, env, token7 } = await setup(true);
    const res = await request(app, env, '/api/v1/account/alerts', {
      headers: { cookie: cookieOf(token7) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PATCH — threshold / status
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/account/alerts/:alertId', () => {
  async function seedOwnAlert(setup_: Setup): Promise<AlertJson> {
    seedProduct(setup_.db, { id: 1 });
    const res = await createAlert(setup_.app, setup_.env, setup_.token7, 1, 1000);
    expect(res.status).toBe(201);
    return (await res.json()) as AlertJson;
  }

  it('updates the threshold and keeps the status', async () => {
    const s = await setup(true);
    const alert = await seedOwnAlert(s);
    const res = await request(s.app, s.env, `/api/v1/account/alerts/${alert.id}`, jsonInit('PATCH', s.token7, { thresholdCents: 4321 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AlertJson;
    expect(body.thresholdCents).toBe(4321);
    expect(body.status).toBe('active');
    expect(new Date(body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(alert.createdAt).getTime());
  });

  it('pauses via status and keeps the threshold', async () => {
    const s = await setup(true);
    const alert = await seedOwnAlert(s);
    const res = await request(s.app, s.env, `/api/v1/account/alerts/${alert.id}`, jsonInit('PATCH', s.token7, { status: 'paused' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AlertJson;
    expect(body.status).toBe('paused');
    expect(body.thresholdCents).toBe(1000);
  });

  it('updates threshold and status together', async () => {
    const s = await setup(true);
    const alert = await seedOwnAlert(s);
    const res = await request(s.app, s.env, `/api/v1/account/alerts/${alert.id}`, jsonInit('PATCH', s.token7, { thresholdCents: 500, status: 'active' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AlertJson;
    expect(body.thresholdCents).toBe(500);
    expect(body.status).toBe('active');
  });

  it('rejects an empty patch, an invalid status, and an over-max threshold with 400', async () => {
    const s = await setup(true);
    const alert = await seedOwnAlert(s);
    for (const body of [{}, { status: 'retired' }, { thresholdCents: 1_000_001 }]) {
      const res = await request(s.app, s.env, `/api/v1/account/alerts/${alert.id}`, jsonInit('PATCH', s.token7, body));
      await expectEnvelope(res, 400, { error: 'ValidationError' });
    }
  });

  it('reports a foreign alert as 404 and leaves it untouched', async () => {
    const s = await setup(true);
    const alert = await seedOwnAlert(s);
    const res = await request(s.app, s.env, `/api/v1/account/alerts/${alert.id}`, jsonInit('PATCH', s.token9, { thresholdCents: 1 }));
    await expectEnvelope(res, 404, { error: 'AlertNotFound' });

    const own = await request(s.app, s.env, '/api/v1/account/alerts', {
      headers: { cookie: cookieOf(s.token7) },
    });
    const alerts = (await own.json()) as AlertJson[];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.thresholdCents).toBe(1000);
  });

  it('reports an absent alert id as 404', async () => {
    const s = await setup(true);
    const res = await request(s.app, s.env, '/api/v1/account/alerts/999999', jsonInit('PATCH', s.token7, { status: 'paused' }));
    await expectEnvelope(res, 404, { error: 'AlertNotFound' });
  });

  it('rejects a non-numeric alert id with the ParseIntPipe 400', async () => {
    const s = await setup(true);
    const res = await request(s.app, s.env, '/api/v1/account/alerts/abc', jsonInit('PATCH', s.token7, { status: 'paused' }));
    await expectEnvelope(res, 400, {
      message: 'Validation failed (numeric string is expected)',
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/account/alerts/:alertId', () => {
  it('removes the owned alert; a repeat reports 404', async () => {
    const s = await setup(true);
    seedProduct(s.db, { id: 1 });
    const created = await createAlert(s.app, s.env, s.token7, 1, 1000);
    const { id } = (await created.json()) as AlertJson;

    const removed = await request(s.app, s.env, `/api/v1/account/alerts/${id}`, { method: 'DELETE', headers: { cookie: cookieOf(s.token7) } });
    expect(removed.status).toBe(200);

    const listed = await request(s.app, s.env, '/api/v1/account/alerts', {
      headers: { cookie: cookieOf(s.token7) },
    });
    expect(await listed.json()).toEqual([]);

    const again = await request(s.app, s.env, `/api/v1/account/alerts/${id}`, { method: 'DELETE', headers: { cookie: cookieOf(s.token7) } });
    await expectEnvelope(again, 404, { error: 'AlertNotFound' });
  });

  it('reports a foreign alert as 404 and leaves it for its owner', async () => {
    const s = await setup(true);
    seedProduct(s.db, { id: 1 });
    const created = await createAlert(s.app, s.env, s.token7, 1, 1000);
    const { id } = (await created.json()) as AlertJson;

    const foreign = await request(s.app, s.env, `/api/v1/account/alerts/${id}`, { method: 'DELETE', headers: { cookie: cookieOf(s.token9) } });
    await expectEnvelope(foreign, 404, { error: 'AlertNotFound' });

    const owner = await request(s.app, s.env, '/api/v1/account/alerts', {
      headers: { cookie: cookieOf(s.token7) },
    });
    expect(((await owner.json()) as AlertJson[])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rate limit — per authenticated account
// ---------------------------------------------------------------------------

describe('alerts rate limit (per authenticated account)', () => {
  it('admits 60 requests per minute per account, 429s the 61st, and leaves another account unaffected', async () => {
    const s = await setup(true);
    for (let i = 0; i < 60; i++) {
      const res = await request(s.app, s.env, '/api/v1/account/alerts', {
        headers: { cookie: cookieOf(s.token7) },
      });
      expect(res.status, `request #${i + 1}`).toBe(200);
    }

    const rejected = await request(s.app, s.env, '/api/v1/account/alerts', {
      headers: { cookie: cookieOf(s.token7) },
    });
    await expectEnvelope(rejected, 429, { error: 'TooManyRequests' });
    expect(rejected.headers.get('Retry-After')).not.toBeNull();

    // The bucket key is the account, not the (shared) edge IP the test
    // requests carry — account 9 has its own window.
    const other = await request(s.app, s.env, '/api/v1/account/alerts', {
      headers: { cookie: cookieOf(s.token9) },
    });
    expect(other.status).toBe(200);
  });
});
