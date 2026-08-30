/**
 * Accounts + analytics route parity tests (task 3.7).
 *
 * Expectations ported from:
 * - packages/application-api/src/accounts/__tests__/session.controller.test.ts
 *   and session-security.test.ts (issuance shape, cookie flags, rotation
 *   invalidates the predecessor, revoke clears the cookie),
 * - account.controller.test.ts / gdpr-integration.test.ts (export shape),
 * - account-scenarios.controller.test.ts / account-history.controller.test.ts
 *   (upsert-by-name, account-scoped deletes, history claim semantics),
 * - email-verification.test.ts (upgrade endpoint validation + persistence),
 * - analytics/__tests__/analytics.controller.test.ts and
 *   outbound-redirect.controller.test.ts (payload policy, count report,
 *   redirect).
 *
 * @module AccountsAnalyticsRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
  seedCalculationRecord,
  seedOffer,
  seedProduct,
  lockedEnv,
} from './harness';

const AGE = { 'x-age-confirmed': 'confirmed' };
const JSON_HDRS = { 'content-type': 'application/json', ...AGE };

/** Extract the issued cookie's token value from a Set-Cookie header. */
function sessionCookieOf(res: Response): { raw: string; token: string } {
  const raw = res.headers.get('Set-Cookie') ?? '';
  const match = /rajahinta_session=([^;]*)/.exec(raw);
  expect(match).not.toBeNull();
  return { raw, token: match![1]! };
}

// ---------------------------------------------------------------------------
// Sessions (design D3)
// ---------------------------------------------------------------------------

describe('POST /api/v1/account/session — anonymous issuance', () => {
  it('issues a session without any credential: 201, httpOnly cookie, no token in the body', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/account/session', {
      method: 'POST',
    });
    expect(res.status).toBe(201);
    const { raw, token } = sessionCookieOf(res);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    expect(raw).toContain('Path=/');
    expect(token.length).toBeGreaterThan(0);

    const body = (await res.json()) as { userId: string; expiresAt: string; verified: boolean };
    // The identity is a server-generated UUID.
    expect(body.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(body.verified).toBe(false);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The token never appears in a response body.
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('authenticates the issued cookie against the account endpoints', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const issued = await request(app, env, '/api/v1/account/session', { method: 'POST' });
    const { token } = sessionCookieOf(issued);
    const body = (await issued.json()) as { userId: string };

    const exportRes = await request(app, env, '/api/v1/account/export', {
      headers: { cookie: `rajahinta_session=${token}` },
    });
    expect(exportRes.status).toBe(200);
    const exported = (await exportRes.json()) as Record<string, any>;
    expect(exported.userId).toBe(body.userId);
    expect(exported.account.email).toContain('@placeholder.local');
    expect(exported.subscription).toEqual({ userId: body.userId, plan: 'FREE', active: true });
  });
});

describe('POST /api/v1/account/session/rotate + DELETE /session', () => {
  it('rotates atomically: the old token stops authenticating immediately', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const issued = await request(app, env, '/api/v1/account/session', { method: 'POST' });
    const first = sessionCookieOf(issued);

    const rotated = await request(app, env, '/api/v1/account/session/rotate', {
      method: 'POST',
      headers: { cookie: `rajahinta_session=${first.token}` },
    });
    expect(rotated.status).toBe(200);
    const second = sessionCookieOf(rotated);
    expect(second.token).not.toBe(first.token);
    const rotatedBody = (await rotated.json()) as { userId: string; verified: boolean };
    expect(rotatedBody.verified).toBe(false);

    // The predecessor is dead — a rotated token never mints a successor.
    const stale = await request(app, env, '/api/v1/account/session/rotate', {
      method: 'POST',
      headers: { cookie: `rajahinta_session=${first.token}` },
    });
    await expectEnvelope(stale, 401, { error: 'InvalidSession' });

    // The successor authenticates.
    const ok = await request(app, env, '/api/v1/account/subscription', {
      headers: { cookie: `rajahinta_session=${second.token}` },
    });
    expect(ok.status).toBe(200);
  });

  it('revokes on logout and clears the cookie', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const issued = await request(app, env, '/api/v1/account/session', { method: 'POST' });
    const { token } = sessionCookieOf(issued);

    const logout = await request(app, env, '/api/v1/account/session', {
      method: 'DELETE',
      headers: { cookie: `rajahinta_session=${token}` },
    });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ revoked: true });
    const cleared = logout.headers.get('Set-Cookie') ?? '';
    expect(cleared).toContain('Max-Age=0');

    // The revoked token no longer authenticates.
    const after = await request(app, env, '/api/v1/account/subscription', {
      headers: { cookie: `rajahinta_session=${token}` },
    });
    await expectEnvelope(after, 401, { error: 'InvalidSession' });
  });
});

// ---------------------------------------------------------------------------
// Account data — baskets, history, subscription, GDPR export, verify-email
// ---------------------------------------------------------------------------

describe('account data endpoints', () => {
  async function issueInto(env: unknown, app: ReturnType<typeof buildApp>) {
    const issued = await request(app, env as never, '/api/v1/account/session', {
      method: 'POST',
    });
    const cookie = `rajahinta_session=${sessionCookieOf(issued).token}`;
    const body = (await issued.json()) as { userId: string };
    return { cookie, userId: body.userId };
  }

  it('saves and lists baskets with the persisted identity', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie } = await issueInto(env, app);

    const saved = await request(app, env, '/api/v1/account/baskets', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'Weekend',
        items: [{ productId: 1, productName: 'Karhu III', quantity: 6 }],
      }),
    });
    expect(saved.status).toBe(201);

    const list = await request(app, env, '/api/v1/account/baskets', {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const baskets = (await list.json()) as Array<Record<string, any>>;
    expect(baskets).toHaveLength(1);
    expect(baskets[0]!.name).toBe('Weekend');
    expect(baskets[0]!.items).toEqual([
      { productId: 1, productName: 'Karhu III', quantity: 6 },
    ]);
  });

  it('rejects basket deletion for non-UUID ids (ParseUUIDPipe parity) and unknown ids with 404', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie } = await issueInto(env, app);

    const bad = await request(app, env, '/api/v1/account/baskets/not-a-uuid', {
      method: 'DELETE',
      headers: { cookie },
    });
    await expectEnvelope(bad, 400, {
      message: 'Validation failed (uuid is expected)',
      error: 'Bad Request',
    });

    const missing = await request(
      app,
      env,
      '/api/v1/account/baskets/00000000-0000-4000-8000-000000000000',
      { method: 'DELETE', headers: { cookie } },
    );
    await expectEnvelope(missing, 404, { error: 'BasketNotFound' });
  });

  it('claims calculation records for history — first claim wins', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedCalculationRecord(db, { id: 42, productMasterId: 1 });
    const app = buildApp();
    const env = permissiveEnv(d1);
    const first = await issueInto(env, app);
    const second = await issueInto(env, app);

    const add = await request(app, env, '/api/v1/account/history', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie: first.cookie },
      body: JSON.stringify({ recordId: 42 }),
    });
    expect(add.status).toBe(201);
    expect(await add.json()).toEqual({ success: true, recordId: 42 });

    // A replay of the same record id to another session is idempotent and
    // never re-assigns ownership.
    const replay = await request(app, env, '/api/v1/account/history', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie: second.cookie },
      body: JSON.stringify({ recordId: 42 }),
    });
    expect(replay.status).toBe(201);

    const mine = await request(app, env, '/api/v1/account/history', {
      headers: { cookie: first.cookie },
    });
    expect(await mine.json()).toEqual([42]);

    const theirs = await request(app, env, '/api/v1/account/history', {
      headers: { cookie: second.cookie },
    });
    expect(await theirs.json()).toEqual([]);

    const invalid = await request(app, env, '/api/v1/account/history', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie: first.cookie },
      body: JSON.stringify({ recordId: 0 }),
    });
    await expectEnvelope(invalid, 400, {
      message: 'recordId must be a positive integer',
      error: 'InvalidRecordId',
    });
  });

  it('exports the full GDPR payload: account, baskets, scenarios, history, subscription', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedCalculationRecord(db, { id: 7, productMasterId: 1 });
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie, userId } = await issueInto(env, app);

    await request(app, env, '/api/v1/account/history', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({ recordId: 7 }),
    });
    await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'Cheap beer',
        inputs: { productId: 1, quantity: 6, destination: 'FI' },
      }),
    });

    const res = await request(app, env, '/api/v1/account/export', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const exported = (await res.json()) as Record<string, any>;

    expect(exported.userId).toBe(userId);
    expect(exported.exportDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(exported.account).toMatchObject({
      userId,
      email: `${userId}@placeholder.local`,
      tier: 'FREE',
    });
    expect(exported.savedBaskets).toEqual([]);
    expect(exported.savedScenarios).toHaveLength(1);
    expect(exported.savedScenarios[0]!.name).toBe('Cheap beer');
    expect(exported.calculationHistory).toHaveLength(1);
    expect(exported.calculationHistory[0]).toMatchObject({
      calculationId: 7,
      totalCents: 873,
      quantity: 1,
    });
    expect(exported.subscription).toEqual({ userId, plan: 'FREE', active: true });
  });

  it('upgrades the anonymous account to a verified email (persisted)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie, userId } = await issueInto(env, app);

    const invalid = await request(app, env, '/api/v1/account/verify-email', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    await expectEnvelope(invalid, 400, {
      message: '"email" is required and must be a valid email address',
      error: 'InvalidEmail',
    });

    const ok = await request(app, env, '/api/v1/account/verify-email', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({ email: 'me@example.invalid' }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ verified: true, email: 'me@example.invalid' });

    // The verified address replaced the placeholder on the account row —
    // visible in the export (and the session keeps authenticating).
    const exported = await request(app, env, '/api/v1/account/export', {
      headers: { cookie },
    });
    const data = (await exported.json()) as Record<string, any>;
    expect(data.account.email).toBe('me@example.invalid');
    expect(data.userId).toBe(userId);
  });

  it('returns the FREE-tier subscription status', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie, userId } = await issueInto(env, app);

    const res = await request(app, env, '/api/v1/account/subscription', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId, plan: 'FREE', active: true });
  });
});

// ---------------------------------------------------------------------------
// Scenarios (ADVANCED_FEATURES-gated)
// ---------------------------------------------------------------------------

describe('account scenarios', () => {
  async function issueInto(env: unknown, app: ReturnType<typeof buildApp>) {
    const issued = await request(app, env as never, '/api/v1/account/session', {
      method: 'POST',
    });
    return `rajahinta_session=${sessionCookieOf(issued).token}`;
  }

  it('stays session-guarded, then flag-gated (route-coverage parity)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const noSession = await request(app, lockedEnv(d1), '/api/v1/account/scenarios');
    await expectEnvelope(noSession, 401, { error: 'SessionRequired' });

    const cookie = await issueInto(permissiveEnv(d1), app);
    const flagOff = await request(
      app,
      permissiveEnv(d1, { FF_ADVANCED_FEATURES: undefined }),
      '/api/v1/account/scenarios',
      { headers: { cookie } },
    );
    await expectEnvelope(flagOff, 403, {
      message: 'Feature "ADVANCED_FEATURES" is not enabled',
    });
  });

  it('upserts by name and returns the persisted scenario (201)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const cookie = await issueInto(env, app);

    const invalid = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({ name: '', inputs: { productId: 1 } }),
    });
    await expectEnvelope(invalid, 400, {
      message: 'name must be a non-empty string',
      error: 'InvalidScenarioRequest',
    });

    const badInputs = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'X',
        inputs: { productId: 1, quantity: 6, destination: '', transportArrangement: 'TELEPORT' },
      }),
    });
    // The controller's fail() throws on the FIRST violation — one message.
    await expectEnvelope(badInputs, 400, {
      message: 'inputs.destination must be a non-empty string',
      error: 'InvalidScenarioRequest',
    });

    const badArrangement = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'X',
        inputs: { productId: 1, quantity: 6, destination: 'FI', transportArrangement: 'TELEPORT' },
      }),
    });
    await expectEnvelope(badArrangement, 400, {
      message:
        'inputs.transportArrangement must be one of SELLER_ARRANGED, INDEPENDENT_CARRIER, PERSONAL when provided',
      error: 'InvalidScenarioRequest',
    });

    const created = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'Cheap beer',
        inputs: { productId: 1, quantity: 6, destination: 'FI' },
      }),
    });
    expect(created.status).toBe(201);
    const scenario = (await created.json()) as Record<string, any>;
    expect(scenario.name).toBe('Cheap beer');
    expect(scenario.inputs).toEqual({ productId: 1, quantity: 6, destination: 'FI' });

    // Upsert-by-name: same identity, refreshed inputs.
    const replaced = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'Cheap beer',
        inputs: { productId: 2, quantity: 12, destination: 'FI' },
      }),
    });
    expect(replaced.status).toBe(201);
    const replacedBody = (await replaced.json()) as Record<string, any>;
    expect(replacedBody.id).toBe(scenario.id);
    expect(replacedBody.inputs).toEqual({ productId: 2, quantity: 12, destination: 'FI' });

    const list = await request(app, env, '/api/v1/account/scenarios', {
      headers: { cookie },
    });
    const scenarios = (await list.json()) as Array<Record<string, any>>;
    expect(scenarios).toHaveLength(1);
  });

  it('deletes account-scoped: foreign ids are not found, never cross-account', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const cookieA = await issueInto(env, app);
    const cookieB = await issueInto(env, app);

    const created = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie: cookieA },
      body: JSON.stringify({
        name: 'Mine',
        inputs: { productId: 1, quantity: 1, destination: 'FI' },
      }),
    });
    const { id } = (await created.json()) as { id: number };

    const foreign = await request(app, env, `/api/v1/account/scenarios/${id}`, {
      method: 'DELETE',
      headers: { cookie: cookieB },
    });
    await expectEnvelope(foreign, 404, {
      message: `Scenario "${id}" not found`,
      error: 'ScenarioNotFound',
    });

    const nonInteger = await request(app, env, '/api/v1/account/scenarios/abc', {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    await expectEnvelope(nonInteger, 400, {
      message: 'Validation failed (numeric string is expected)',
    });

    const ok = await request(app, env, `/api/v1/account/scenarios/${id}`, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    expect(ok.status).toBe(200);

    const list = await request(app, env, '/api/v1/account/scenarios', {
      headers: { cookie: cookieA },
    });
    expect(await list.json()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Analytics (click + outbound redirect)
// ---------------------------------------------------------------------------

describe('POST /api/v1/analytics/click', () => {
  it('rejects forbidden fields before any other validation', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    for (const field of ['commission', 'affiliate', 'purchase', 'transactionId', 'orderId']) {
      const res = await request(app, permissiveEnv(d1), '/api/v1/analytics/click', {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ [field]: 1, merchantId: 'alko', url: 'https://x' }),
      });
      await expectEnvelope(res, 400, {
        message: `Field "${field}" is not allowed in click analytics payload`,
        error: 'ForbiddenField',
      });
    }
  });

  it('requires non-empty merchantId and url strings', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/analytics/click', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ merchantId: '', url: 5 }),
    });
    await expectEnvelope(res, 400, {
      message: '"merchantId" is required and must be a non-empty string',
      error: 'ValidationError',
    });
  });

  it('records the click through ClickCounterDO and reports the updated count', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const payload = { merchantId: 'alko', url: 'https://example.invalid/karhu' };

    const first = await request(app, env, '/api/v1/analytics/click', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, count: 1 });

    const second = await request(app, env, '/api/v1/analytics/click', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify(payload),
    });
    expect(await second.json()).toEqual({ success: true, count: 2 });
  });
});

describe('GET /api/v1/outbound/:offerId', () => {
  it('redirects (302) to the merchant source URL', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1, sourceUrl: 'https://shop.example/karhu' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/outbound/11');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://shop.example/karhu');
  });

  it('404s an unknown offer or one without a source URL', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 12, productId: 1, sourceUrl: null });
    const app = buildApp();

    const unknown = await request(app, permissiveEnv(d1), '/api/v1/outbound/999');
    await expectEnvelope(unknown, 404, {
      message: 'Offer 999 not found or has no source URL',
    });

    const noUrl = await request(app, permissiveEnv(d1), '/api/v1/outbound/12');
    await expectEnvelope(noUrl, 404, {
      message: 'Offer 12 not found or has no source URL',
    });
  });
});
