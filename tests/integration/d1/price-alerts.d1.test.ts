/**
 * Price-alerts integration suite (task 2.5, change
 * product-roadmap-phases-1-4) — the whole feature against the real stack:
 * the FULL worker app composition (createApp + guards + alerts routes) and
 * the real cron handler, both over a real migrated D1 (node:sqlite through
 * the structural shim).
 *
 * Scope note — this file deliberately does NOT repeat the unit suites'
 * bindings: threshold semantics, cooldown boundary math, and intent-log
 * ordering are pinned with dependency stubs by the task-2.2 cron tests,
 * and route validation/ownership by the task-2.3 route tests. What only an
 * integration run can prove:
 *
 * 1. flag-off: every alerts method returns the standard feature-disabled
 *    403 even for an authenticated session (flag gate, not auth gate);
 * 2. the one-notification-per-day invariant ACROSS REPEATED handler runs
 *    on real persisted rows — cooldown enforcement reads back what earlier
 *    runs wrote, suppression is counted, and the window's expiry allows
 *    exactly one more notification (time advances via the handler's
 *    documented `now` seam — never sleeps);
 * 3. evaluation is never invoked from request paths — source-level (no
 *    route module references the cron handler) and behaviorally (CRUD
 *    traffic over trigger-ready state produces zero notification rows and
 *    zero evaluation counters);
 * 4. end-to-end: API-created alert → evaluation → the exact HTTP request
 *    the email Worker would receive (URL, shared-secret header, payload).
 *
 * The route/env helpers are imported from the api-worker route harness
 * (not duplicated): the composition they build IS the code under test.
 *
 * @module PriceAlertsD1IntegrationTest
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

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
} from '../../../apps/api-worker/src/routes/__tests__/harness';
import type { Env } from '../../../apps/api-worker/src/env';
import { createLogger } from '../../../apps/api-worker/src/logger';
import { registerAlertsRoutes } from '../../../apps/api-worker/src/routes/alerts.routes';
import {
  handlePriceAlertEvaluation,
  PRICE_ALERT_COOLDOWN_MS,
} from '../../../apps/api-worker/src/cron/price-alert-evaluation';
import {
  PRICE_ALERT_EVALUATED_COUNTER,
  PRICE_ALERT_MATCHED_COUNTER,
  PRICE_ALERT_NOTIFIED_COUNTER,
  PRICE_ALERT_FAILED_COUNTER,
  PRICE_ALERT_SUPPRESSED_COUNTER,
} from '../../../apps/api-worker/src/observability/metrics';
import { D1PriceAlertRepository } from '../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import { D1PriceHistorySummaryRepository } from '../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const API_WORKER_SRC = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'api-worker',
  'src',
);

const ACCOUNT_ID = 7;
const ACCOUNT_EMAIL = 'watcher@example.invalid';
const PRODUCT_ID = 1;
const PRODUCT_NAME = 'Keitele Senorita';
const EMAIL_WORKER_URL = 'https://rajahinta-email-worker.example.workers.dev';
const EMAIL_SEND_SECRET = 'test-shared-secret';

/** Session cookie the session-auth middleware resolves. */
const cookieOf = (token: string): string => `rajahinta_session=${token}`;

/** Structurally-typed AE data point (the real binding's write shape). */
interface AePoint {
  readonly indexes?: unknown[];
  readonly blobs?: unknown[];
  readonly doubles?: unknown[];
}

/** Fake Analytics Engine binding — records every written data point. */
function fakeMetricsBinding(): {
  points: AePoint[];
  binding: { writeDataPoint(point?: AePoint): void };
} {
  const points: AePoint[] = [];
  return {
    points,
    binding: {
      writeDataPoint(point?: AePoint): void {
        points.push(point ?? {});
      },
    },
  };
}

const PRICE_ALERT_COUNTER_NAMES = [
  PRICE_ALERT_EVALUATED_COUNTER,
  PRICE_ALERT_MATCHED_COUNTER,
  PRICE_ALERT_NOTIFIED_COUNTER,
  PRICE_ALERT_FAILED_COUNTER,
  PRICE_ALERT_SUPPRESSED_COUNTER,
];

/** `double1` of the counter's data point in one run's export batch. */
function counterValue(points: AePoint[], name: string): number | undefined {
  const point = points.find((p) => p.indexes?.[0] === name);
  return point?.doubles?.[0] as number | undefined;
}

/** Capture the fetches the real send seam issues (email Worker contract). */
function stubEmailWorker(): Array<{ url: string; init: RequestInit }> {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return new Response(null, { status: 202 });
    }),
  );
  return calls;
}

/** Flag-on, email-configured env over the given D1 + metrics binding. */
function alertsEnv(
  d1: ReturnType<typeof openMigratedD1>['d1'],
  metrics: ReturnType<typeof fakeMetricsBinding>,
): Env {
  return permissiveEnv(d1, {
    FF_PRICE_ALERTS: 'true',
    EMAIL_WORKER_URL,
    EMAIL_SEND_SECRET,
    METRICS: metrics.binding,
  } as Partial<Env>);
}

/** Full production composition (index.ts wiring: guards first, then routes). */
function alertsApp(): ReturnType<typeof createApp> {
  const app = createApp();
  registerAlertsRoutes(app);
  return app;
}

/** Seed the product-wide daily summary the handler's lookback read finds. */
async function seedDailySummary(
  d1: ReturnType<typeof openMigratedD1>['d1'],
  day: string,
  closeCents: number,
): Promise<void> {
  await new D1PriceHistorySummaryRepository(d1).upsertBucket({
    granularity: 'daily',
    periodStart: day,
    productId: PRODUCT_ID,
    merchant: null,
    priceOpenCents: closeCents,
    priceCloseCents: closeCents,
    priceMinCents: closeCents,
    priceMaxCents: closeCents,
    priceAvgCents: closeCents,
    landedCostOpenCents: closeCents + 100,
    landedCostCloseCents: closeCents + 100,
    landedCostMinCents: closeCents + 100,
    landedCostMaxCents: closeCents + 100,
    landedCostAvgCents: closeCents + 100,
    observationCount: 1,
    strictestReliability: 'VERIFIED',
  });
}

/** Raw ground truth — the intent log's rows, in insertion order. */
function notificationRows(db: DatabaseSync): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT id, alert_id, observed_price_cents, channel, delivery_status,
              created_at, marked_at
         FROM alert_notifications ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// 1. Flag-off — the whole CRUD surface is dark, even authenticated
// ---------------------------------------------------------------------------

describe('flag-off: /api/v1/account/alerts returns 403 for every method', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof alertsApp>;
  let env: Env;
  let token: string;

  beforeEach(async () => {
    const opened = openMigratedD1();
    db = opened.db;
    seedAccount(opened.db, {
      id: ACCOUNT_ID,
      userId: 'user-7',
      email: ACCOUNT_EMAIL,
      tier: 'FREE',
    });
    token = await issueSessionToken(opened.d1, ACCOUNT_ID);
    app = alertsApp();
    // lockedEnv leaves FF_PRICE_ALERTS unset → FeatureFlagService default off.
    env = lockedEnv(opened.d1);
  });

  afterEach(() => {
    db.close();
  });

  it('rejects an AUTHENTICATED session with the standard feature-disabled body', async () => {
    // The session proves the 403 is the flag gate firing BEHIND successful
    // authentication — not the 401 the missing session would produce.
    for (const [method, path] of [
      ['GET', '/api/v1/account/alerts'],
      ['POST', '/api/v1/account/alerts'],
      ['PATCH', '/api/v1/account/alerts/1'],
      ['DELETE', '/api/v1/account/alerts/1'],
    ] as const) {
      const res = await request(app, env, path, {
        method,
        headers: { cookie: cookieOf(token) },
      });
      await expectEnvelope(res, 403, {
        message: 'Feature "PRICE_ALERTS" is not enabled',
        error: 'Forbidden',
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. One-notification-per-day invariant across repeated evaluation runs
// ---------------------------------------------------------------------------

describe('one-notification-per-day invariant across repeated runs', () => {
  let db: DatabaseSync;
  let d1: ReturnType<typeof openMigratedD1>['d1'];
  let metrics: ReturnType<typeof fakeMetricsBinding>;
  let emails: Array<{ url: string; init: RequestInit }>;
  let alertId: number;
  /** T0 anchors the controlled clock; delivered rows carry the real clock
   * (T0 + ε), so every offset below is measured from the same base. */
  const T0 = new Date();
  const at = (msFromT0: number): Date => new Date(T0.getTime() + msFromT0);

  beforeEach(async () => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    seedAccount(db, {
      id: ACCOUNT_ID,
      userId: 'user-7',
      email: ACCOUNT_EMAIL,
      tier: 'FREE',
    });
    seedProduct(db, { id: PRODUCT_ID, name: PRODUCT_NAME });
    // Threshold == close (equality triggers) — the summary is also the
    // product's newest bucket, dated today so the 7-day lookback finds it.
    await new D1PriceAlertRepository(d1).create({
      accountId: ACCOUNT_ID,
      productId: PRODUCT_ID,
      thresholdCents: 2000,
    });
    alertId = (
      db.prepare('SELECT id FROM price_alerts LIMIT 1').get() as {
        id: number;
      }
    ).id;
    await seedDailySummary(d1, T0.toISOString().slice(0, 10), 2000);

    metrics = fakeMetricsBinding();
    emails = stubEmailWorker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  it('delivers once, suppresses every in-window repeat, re-notifies once the 24h window elapses', async () => {
    const log = createLogger('error');

    // Run 1 — first trigger: exactly one delivered row, one dispatch.
    const run1 = await handlePriceAlertEvaluation(
      alertsEnv(d1, metrics),
      log,
      { now: () => T0 },
    );
    expect(run1).toMatchObject({
      evaluated: 1,
      matched: 1,
      notified: 1,
      suppressed: 0,
      failed: 0,
    });
    expect(emails).toHaveLength(1);
    let rows = notificationRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      alert_id: alertId,
      observed_price_cents: 2000,
      channel: 'email',
      delivery_status: 'delivered',
    });
    expect(rows[0]?.marked_at).not.toBeNull();

    // Run 2 — one hour later, still inside the cooldown: the delivered row
    // run 1 PERSISTED routes the repeat into suppression. One email, one
    // row, total — and the suppression counted, never silent.
    metrics.points.length = 0;
    const run2 = await handlePriceAlertEvaluation(
      alertsEnv(d1, metrics),
      log,
      { now: () => at(3_600_000) },
    );
    expect(run2).toMatchObject({ matched: 1, notified: 0, suppressed: 1 });
    expect(emails).toHaveLength(1);
    expect(notificationRows(db)).toHaveLength(1);
    expect(counterValue(metrics.points, PRICE_ALERT_SUPPRESSED_COUNTER)).toBe(1);
    expect(counterValue(metrics.points, PRICE_ALERT_NOTIFIED_COUNTER)).toBe(0);

    // Run 3 — past the window (cooldown + 1 minute): the second
    // notification is allowed and delivered. "Per day" bounds the rate;
    // it must not silence the alert forever.
    const run3 = await handlePriceAlertEvaluation(
      alertsEnv(d1, metrics),
      log,
      { now: () => at(PRICE_ALERT_COOLDOWN_MS + 60_000) },
    );
    expect(run3).toMatchObject({ matched: 1, notified: 1, suppressed: 0 });
    expect(emails).toHaveLength(2);
    rows = notificationRows(db);
    expect(rows).toHaveLength(2);
    expect(
      rows.filter((r) => r.delivery_status === 'delivered'),
    ).toHaveLength(2);
  });

  it('keeps the invariant under an immediate back-to-back double run (same-tick re-entry)', async () => {
    const log = createLogger('error');
    const env = alertsEnv(d1, metrics);

    const first = await handlePriceAlertEvaluation(env, log, { now: () => T0 });
    // Second run BEFORE the first's mark could even be observed externally —
    // the delivered row is already committed, so the re-entry must not send.
    const second = await handlePriceAlertEvaluation(env, log, {
      now: () => at(1_000),
    });

    expect(first.notified).toBe(1);
    expect(second).toMatchObject({ notified: 0, suppressed: 1 });
    expect(emails).toHaveLength(1);
    expect(notificationRows(db)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Evaluation is never invoked from request paths
// ---------------------------------------------------------------------------

describe('evaluation is never invoked from request paths', () => {
  it('no route module — and not the route registration — references the cron handler', () => {
    const routesDir = path.join(API_WORKER_SRC, 'routes');
    // Manual walk (routes/** incl. subdirs), excluding test surface: the
    // invariant is about PRODUCTION wiring, not about who may mention the
    // handler in a test.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return entry.name === '__tests__' ? [] : walk(full);
        }
        return entry.name.endsWith('.ts') ? [full] : [];
      });

    const productionFiles = [...walk(routesDir), path.join(API_WORKER_SRC, 'index.ts')];
    expect(productionFiles.length).toBeGreaterThan(10);

    for (const file of productionFiles) {
      expect(
        readFileSync(file, 'utf8'),
        `${path.relative(API_WORKER_SRC, file)} must not reference the cron handler`,
      ).not.toMatch(/price-alert-evaluation/);
    }
  });

  it('CRUD traffic over trigger-ready state writes zero notification rows and zero evaluation counters', async () => {
    const opened = openMigratedD1();
    const { db, d1 } = opened;
    try {
      seedAccount(db, {
        id: ACCOUNT_ID,
        userId: 'user-7',
        email: ACCOUNT_EMAIL,
        tier: 'FREE',
      });
      seedProduct(db, { id: PRODUCT_ID, name: PRODUCT_NAME });
      // Summary strictly BELOW the threshold + configured email: if any
      // request path leaked the evaluation, this state would produce a
      // notification row and counter points — the probe makes a leak loud.
      await seedDailySummary(d1, new Date().toISOString().slice(0, 10), 999);

      const metrics = fakeMetricsBinding();
      const app = alertsApp();
      const env = alertsEnv(d1, metrics);
      const token = await issueSessionToken(d1, ACCOUNT_ID);
      const auth = { cookie: cookieOf(token) };

      const created = await request(app, env, '/api/v1/account/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ productId: PRODUCT_ID, thresholdCents: 1000 }),
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: number };

      const patched = await request(app, env, `/api/v1/account/alerts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ thresholdCents: 999 }),
      });
      expect(patched.status).toBe(200);

      const listed = await request(app, env, '/api/v1/account/alerts', {
        headers: auth,
      });
      expect(listed.status).toBe(200);
      expect(((await listed.json()) as unknown[]).length).toBeGreaterThan(0);

      expect(notificationRows(db)).toEqual([]);
      expect(
        metrics.points.filter((p) =>
          PRICE_ALERT_COUNTER_NAMES.includes(p.indexes?.[0] as string),
        ),
      ).toEqual([]);
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. End-to-end: API-created alert → evaluation → delivered email contract
// ---------------------------------------------------------------------------

describe('end-to-end: created alert → cron evaluation → email Worker send contract', () => {
  let db: DatabaseSync;
  let d1: ReturnType<typeof openMigratedD1>['d1'];
  let app: ReturnType<typeof alertsApp>;
  let env: Env;
  let token: string;
  let emails: Array<{ url: string; init: RequestInit }>;
  const T0 = new Date();

  beforeEach(async () => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    seedAccount(db, {
      id: ACCOUNT_ID,
      userId: 'user-7',
      email: ACCOUNT_EMAIL,
      tier: 'FREE',
    });
    seedProduct(db, { id: PRODUCT_ID, name: PRODUCT_NAME });
    const metrics = fakeMetricsBinding();
    emails = stubEmailWorker();
    app = alertsApp();
    env = alertsEnv(d1, metrics);
    token = await issueSessionToken(d1, ACCOUNT_ID);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  it('delivers one on-threshold email through the internal send contract and records the intent', async () => {
    // Flag on → create the watchlist entry through the REAL route chain.
    const created = await request(app, env, '/api/v1/account/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieOf(token) },
      body: JSON.stringify({ productId: PRODUCT_ID, thresholdCents: 1500 }),
    });
    expect(created.status).toBe(201);

    // The materialized price drops to €14.99 — strictly below the threshold.
    await seedDailySummary(d1, T0.toISOString().slice(0, 10), 1499);

    const result = await handlePriceAlertEvaluation(env, createLogger('error'), {
      now: () => T0,
    });
    expect(result.notified).toBe(1);

    // The exact request the email Worker would receive.
    expect(emails).toHaveLength(1);
    const { url, init } = emails[0]!;
    expect(url).toBe(`${EMAIL_WORKER_URL}/internal/email/send`);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('x-email-send-secret')).toBe(EMAIL_SEND_SECRET);
    expect(headers.get('content-type')).toBe('application/json');
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.to).toBe(ACCOUNT_EMAIL);
    expect(body.subject).toContain(PRODUCT_NAME);
    expect(body.subject).toContain('€14.99');
    expect(body.text).toContain('€14.99');
    expect(body.text).toContain('€15.00'); // the user's threshold
    expect(body.text).toContain('#1'); // product id

    // Exactly one intent row, delivered, freezing the observed price.
    const rows = notificationRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      observed_price_cents: 1499,
      channel: 'email',
      delivery_status: 'delivered',
    });
    expect(rows[0]?.marked_at).not.toBeNull();

    // GET list reflects the watchlist state — evaluation never mutated it.
    const listed = await request(app, env, '/api/v1/account/alerts', {
      headers: { cookie: cookieOf(token) },
    });
    expect(listed.status).toBe(200);
    const alerts = (await listed.json()) as Array<{
      productId: number;
      thresholdCents: number;
      status: string;
    }>;
    expect(alerts).toEqual([
      {
        id: expect.any(Number),
        productId: PRODUCT_ID,
        thresholdCents: 1500,
        status: 'active',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
  });
});
