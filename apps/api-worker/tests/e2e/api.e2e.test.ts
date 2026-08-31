/**
 * E2E API suite (task 3.9) — the full Worker app over HTTP-level requests.
 *
 * The Nest e2e reference (apps/backend/tests/e2e/calculator.test.ts) boots
 * the full Nest app via supertest; this suite is its Worker-runtime
 * counterpart: REAL createApp() (guards + rate limiting + routes + unified
 * error envelope), REAL core-domain engines over the fake-D1 harness and
 * in-memory DO namespaces, every assertion made on HTTP responses.
 *
 * Covered paths: calculator golden case + IdempotencyDO HIT/MISS headers,
 * search (karhu ranked), session issue→use→rotate→dead predecessor, account
 * export, ops console 403, rate-limit 429 burst, declaration pinned 403,
 * and the unified envelope on every error path.
 *
 * @module ApiE2E
 */

import { describe, it, expect } from 'vitest';
import {
  buildE2EApp,
  expectEnvelope,
  openMigratedD1,
  postJson,
  request,
  e2eEnv,
  lockedEnv,
} from './harness';
import { seedGoldenDataset } from './golden-fixtures';
import {
  seedAccount,
  seedCalculationRecord,
  seedOffer,
  seedProduct,
  seedTaxRule,
  issueSessionToken,
  FAKE_OPS_TOKEN,
} from '../../src/routes/__tests__/harness';

const AGE = { 'x-age-confirmed': 'confirmed' };

/** Extract the token value from an issued session's Set-Cookie header. */
function sessionCookieOf(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /rajahinta_session=([^;]+)/.exec(setCookie);
  expect(match, 'session issue must set the rajahinta_session cookie').not.toBeNull();
  return match![1]!;
}

describe('E2E — POST /api/v1/calculator (idempotency headers end-to-end)', () => {
  it('computes a MISS result, then serves an identical HIT from IdempotencyDO', async () => {
    const { db, d1 } = openMigratedD1();
    // Parity fixture (calculator.routes.test.ts): the product is NOT in
    // the deposit system and the container-duty rule carries a distinct
    // version label — an exempted container duty stores the 'EXEMPTED'
    // pseudo-version, whose cache entries legitimately never HIT against
    // the tax repo's active version labels (pinned Nest lookup parity).
    seedProduct(db, { id: 1, depositSystemStatus: 0 });
    seedOffer(db, { productId: 1, priceCents: 350 });
    seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
      verified: false,
      versionLabel: 'v2.0-2025',
    });
    const app = buildE2EApp();
    const env = e2eEnv(d1);
    const body = { productId: 1, quantity: 2, destination: 'FI' };

    const miss = await postJson(app, env, '/api/v1/calculator', body, AGE);
    expect(miss.status).toBe(200);
    expect(miss.headers.get('X-Cache')).toBe('MISS');
    const missHash = miss.headers.get('X-Content-Hash');
    expect(missHash).toMatch(/^[0-9a-f]{64}$/);
    const result = (await miss.json()) as Record<string, any>;

    // Live response shape parity — itemized, confident, disclaimed, persisted.
    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.currency).toBe('EUR');
    expect(result.itemizedCosts.length).toBeGreaterThanOrEqual(4);
    expect(result.calculationRecordId).toBeGreaterThan(0);

    const hit = await postJson(app, env, '/api/v1/calculator', body, AGE);
    expect(hit.status).toBe(200);
    expect(hit.headers.get('X-Cache')).toBe('HIT');
    expect(hit.headers.get('X-Content-Hash')).toBe(missHash);
    expect(await hit.json()).toEqual(result);
  });

  it('404s an unknown product with the unified envelope', async () => {
    const { d1 } = openMigratedD1();
    const app = buildE2EApp();
    const res = await postJson(
      app,
      e2eEnv(d1),
      '/api/v1/calculator',
      { productId: 999, quantity: 1, destination: 'FI' },
      AGE,
    );
    await expectEnvelope(res, 404, {
      message: 'Product 999 not found in product master',
      error: 'Not Found',
    });
  });

  it('422s a classification-gate rejection with the domain payload in the envelope', async () => {
    const { db, d1 } = openMigratedD1();
    seedGoldenDataset(db);
    const app = buildE2EApp();
    const res = await postJson(
      app,
      e2eEnv(d1),
      '/api/v1/calculator',
      { productId: 4, quantity: 1, destination: 'FI' },
      AGE,
    );
    const body = await expectEnvelope(res, 422, {
      error: 'ClassificationGateRejection',
      productId: 4,
    });
    expect(String(body.reason)).toContain('classification');
  });
});

describe('E2E — GET /api/v1/products (search)', () => {
  it('ranks the golden query (karhu) first over HTTP', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedProduct(db, { id: 2, name: 'Koff III' });
    seedProduct(db, { id: 3, name: 'Karjala IV' });
    const app = buildE2EApp();

    const res = await request(app, e2eEnv(d1), '/api/v1/products?q=karhu', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: number }>; total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items[0]!.id).toBe(1);
  });
});

describe('E2E — session lifecycle (issue → use → rotate → dead predecessor)', () => {
  it('walks the full rotation chain over HTTP', async () => {
    const { d1 } = openMigratedD1();
    const app = buildE2EApp();
    const env = e2eEnv(d1);

    // 1. Issue — no credential needed; identity is a server-derived UUID.
    const issued = await postJson(app, env, '/api/v1/account/session', {});
    expect(issued.status).toBe(201);
    const first = sessionCookieOf(issued);
    const issuedBody = (await issued.json()) as { userId: string };
    expect(issuedBody.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // 2. Use — the cookie authenticates the account endpoints under the
    //    SAME server-derived identity.
    const exportRes = await request(app, env, '/api/v1/account/export', {
      headers: { cookie: `rajahinta_session=${first}` },
    });
    expect(exportRes.status).toBe(200);
    const exported = (await exportRes.json()) as Record<string, any>;
    expect(exported.userId).toBe(issuedBody.userId);
    expect(exported.account.email).toContain('@placeholder.local');

    // 3. Rotate — a fresh token is minted; the new one works immediately.
    const rotated = await request(app, env, '/api/v1/account/session/rotate', {
      method: 'POST',
      headers: { cookie: `rajahinta_session=${first}` },
    });
    expect(rotated.status).toBe(200);
    const second = sessionCookieOf(rotated);
    expect(second).not.toBe(first);
    const rotatedExport = await request(app, env, '/api/v1/account/export', {
      headers: { cookie: `rajahinta_session=${second}` },
    });
    expect(rotatedExport.status).toBe(200);

    // 4. The predecessor is dead — 401 InvalidSession envelope.
    const stale = await request(app, env, '/api/v1/account/session/rotate', {
      method: 'POST',
      headers: { cookie: `rajahinta_session=${first}` },
    });
    await expectEnvelope(stale, 401, { error: 'InvalidSession' });
    const staleExport = await request(app, env, '/api/v1/account/export', {
      headers: { cookie: `rajahinta_session=${first}` },
    });
    await expectEnvelope(staleExport, 401, { error: 'InvalidSession' });
  });
});

describe('E2E — ops console access control', () => {
  it('403s without credentials and admits the bearer token', async () => {
    const { d1 } = openMigratedD1();
    const app = buildE2EApp();
    const env = e2eEnv(d1);

    const anonymous = await request(app, env, '/ops/console/audit');
    await expectEnvelope(anonymous, 403, { message: 'Forbidden' });

    const authorized = await request(app, env, '/ops/console/audit', {
      headers: { authorization: `Bearer ${FAKE_OPS_TOKEN}` },
    });
    expect(authorized.status).toBe(200);
    const body = (await authorized.json()) as { items: unknown[]; total: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe('E2E — rate limiting (CALCULATOR burst → 429)', () => {
  it('engages the DO sliding window: 429 envelope + Retry-After after the ceiling', async () => {
    const { db, d1 } = openMigratedD1();
    seedGoldenDataset(db);
    const app = buildE2EApp();
    const env = e2eEnv(d1);
    // One client, one window: the same edge-attested IP on every call.
    const client = { 'cf-connecting-ip': '203.0.113.7' };
    const body = { productId: 1, quantity: 1, destination: 'FI' };

    const statuses: number[] = [];
    let rateLimited: Response | null = null;
    for (let i = 0; i < 12 && rateLimited === null; i++) {
      const res = await postJson(app, env, '/api/v1/calculator', body, {
        ...client,
        // Unique inputs so every admitted request is a MISS computation.
        'x-idempotency-key': `burst-${i}`,
        ...AGE,
      });
      statuses.push(res.status);
      if (res.status === 429) {
        rateLimited = res;
      }
    }

    expect(rateLimited).not.toBeNull();
    // Exactly the CALCULATOR ceiling (10) was admitted before the burst
    // hit the wall.
    expect(statuses.filter((s) => s === 200).length).toBe(10);
    const res = rateLimited!;
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    const body429 = await expectEnvelope(res, 429, {
      error: 'TooManyRequests',
    });
    expect(typeof body429.message).toBe('string');
    expect(body429.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('E2E — declaration pinned 403', () => {
  it('keeps the pinned InsufficientEntitlement 403 for a valid PREMIUM session', async () => {
    const { db, d1 } = openMigratedD1();
    seedAccount(db, { id: 41, userId: 'user-41', email: 'premium@example.invalid', tier: 'PREMIUM' });
    seedProduct(db, { id: 1 });
    seedCalculationRecord(db, { id: 51, productMasterId: 1 });
    const token = await issueSessionToken(d1, 41);
    const app = buildE2EApp();

    const res = await request(app, e2eEnv(d1), '/api/v1/declaration/51', {
      headers: { ...AGE, cookie: `rajahinta_session=${token}` },
    });
    await expectEnvelope(res, 403, {
      error: 'InsufficientEntitlement',
      requiredTier: 'declaration:summary',
      currentTier: 'FREE',
    });
  });
});

describe('E2E — locked-down deployment (launch gates closed)', () => {
  it('403s the calculator and search ahead of any handler', async () => {
    const { d1 } = openMigratedD1();
    const app = buildE2EApp();

    const calc = await postJson(
      app,
      lockedEnv(d1),
      '/api/v1/calculator',
      { productId: 1, quantity: 1, destination: 'FI' },
      AGE,
    );
    await expectEnvelope(calc, 403, {
      message: expect.stringMatching(/not yet publicly available/),
    });

    const search = await request(app, lockedEnv(d1), '/api/v1/products', {
      headers: AGE,
    });
    await expectEnvelope(search, 403, {
      message: expect.stringMatching(/Price data is not yet publicly available/),
    });
  });
});

describe('E2E — offer-driven seed sanity (retail path)', () => {
  it('serves a seeded offer through the product detail projection', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 7, name: 'E2E Lager' });
    seedOffer(db, { id: 77, productId: 7, priceCents: 421 });
    const app = buildE2EApp();

    const res = await request(app, e2eEnv(d1), '/api/v1/products/7', { headers: AGE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      product: { id: number; name: string };
      offers: Array<{ id: number; priceCents: number }>;
    };
    expect(body.product.name).toBe('E2E Lager');
    expect(body.offers[0]).toMatchObject({ id: 77, priceCents: 421 });
  });
});
