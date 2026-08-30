/**
 * Guard route-coverage tests (task 3.2) — pins the composition scoping to
 * the Nest controllers' `@UseGuards` decorations (the Worker equivalent of
 * the guard-regression suites: calculator-guard-regression,
 * reports-guard-regression, age-gate-coverage).
 *
 * Each guarded area: unauthenticated/ungated requests are denied with the
 * guard's envelope BEFORE reaching the probe handler; requests satisfying
 * every guard reach it. POST /api/v1/account/session is pinned as PUBLIC
 * (SessionController issues anonymous sessions — the impersonation-vector
 * guard would break issuance if it leaked into the prefix).
 *
 * @module RouteCoverageTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildProbeApp,
  expectEnvelope,
  issueSessionToken,
  openMigratedD1,
  probe,
  seedStandardAccounts,
  testEnv,
  FAKE_OPS_TOKEN,
} from './guard-test-harness';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/** All gates open + operator console on — the "everything passes" env. */
function permissiveEnv(d1: D1DatabaseLike): Env {
  return testEnv(d1, {
    LAUNCH_GATES_OVERRIDE: 'true',
    FF_BASKET_OPTIMIZATION: 'true',
    FF_ADVANCED_FEATURES: 'true',
    FF_OPERATOR_CONSOLE: 'true',
    OPS_BEARER_TOKEN: FAKE_OPS_TOKEN,
  });
}

describe('guard route coverage (Nest @UseGuards parity)', () => {
  it('calculator: launch gate + age gate guard POST /api/v1/calculator', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    // Default: gates closed → launch gate denies first (guard order).
    const closed = await probe(app, testEnv(d1), '/api/v1/calculator', { method: 'POST' });
    await expectEnvelope(closed, 403, {
      message: expect.stringMatching(/Landed-cost calculations are not yet publicly available/),
    });

    // Gates open but no age confirmation → age gate denies.
    const noAge = await probe(app, permissiveEnv(d1), '/api/v1/calculator', { method: 'POST' });
    await expectEnvelope(noAge, 403, {
      message: 'Age confirmation required. Please confirm your age via the age-gate prompt.',
    });

    // Both satisfied → probe handler reached.
    const ok = await probe(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'x-age-confirmed': 'confirmed' },
    });
    expect(ok.status).toBe(200);
  });

  it('calculator: the age gate also covers GET result/:recordId', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    const res = await probe(app, permissiveEnv(d1), '/api/v1/calculator/result/5');
    await expectEnvelope(res, 403, {
      message: expect.stringMatching(/age confirmation required/i),
    });
  });

  it('products: PRICE_DATA launch gate + age gate guard the search surface', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    const closed = await probe(app, testEnv(d1), '/api/v1/products');
    await expectEnvelope(closed, 403, {
      message: expect.stringMatching(/Price data is not yet publicly available/),
    });

    const noAge = await probe(app, permissiveEnv(d1), '/api/v1/products');
    await expectEnvelope(noAge, 403, { message: expect.stringMatching(/age confirmation/i) });

    const ok = await probe(app, permissiveEnv(d1), '/api/v1/products', {
      headers: { cookie: 'age_confirmed=1' },
    });
    expect(ok.status).toBe(200);
  });

  it('basket: BASKET_OPTIMIZATION flag guards POST /api/v1/basket/optimize', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    const off = await probe(app, testEnv(d1), '/api/v1/basket/optimize', { method: 'POST' });
    await expectEnvelope(off, 403, { message: 'Feature "BASKET_OPTIMIZATION" is not enabled' });

    const on = await probe(app, permissiveEnv(d1), '/api/v1/basket/optimize', { method: 'POST' });
    expect(on.status).toBe(200);
  });

  it('declaration: age gate at class level, entitlement on GET :recordId', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();

    // Age gate first (class-level guard order).
    const noAge = await probe(app, permissiveEnv(d1), '/api/v1/declaration/5');
    await expectEnvelope(noAge, 403, { message: expect.stringMatching(/age confirmation/i) });

    // Entitlement: the Nest controller carries EntitlementGuard but NO
    // session guard — request.user is never attached on this surface, so
    // the check resolves anonymous (FREE < declaration:summary) and the
    // route denies identically for anonymous callers and valid sessions.
    // Faithful port of current Nest behavior (see PR notes).
    const token = await issueSessionToken(d1, 11); // PREMIUM account
    const headerSets: Record<string, string>[] = [
      { 'x-age-confirmed': 'confirmed' },
      { 'x-age-confirmed': 'confirmed', cookie: `rajahinta_session=${token}` },
    ];
    for (const headers of headerSets) {
      const res = await probe(app, permissiveEnv(d1), '/api/v1/declaration/5', { headers });
      await expectEnvelope(res, 403, {
        error: 'InsufficientEntitlement',
        requiredTier: 'declaration:summary',
        currentTier: 'FREE',
      });
    }

    // The middleware itself (outside the route scoping) admits a PREMIUM
    // context — the identity wiring is the route ports' (tasks 3.5–3.8).
    // Covered in entitlement.test.ts.
  });

  it('account routes require a session; POST /api/v1/account/session stays public', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();
    const locked = testEnv(d1);
    const token = await issueSessionToken(d1, 7);

    // Issuance is reachable WITHOUT a cookie — the route must stay public.
    const issue = await probe(app, locked, '/api/v1/account/session', { method: 'POST' });
    expect(issue.status).toBe(200);

    // Everything else in the /api/v1/account prefix (class-level
    // SessionAuthGuard) requires the session cookie.
    for (const [method, path] of [
      ['GET', '/api/v1/account/export'],
      ['GET', '/api/v1/account/baskets'],
      ['POST', '/api/v1/account/baskets'],
      ['DELETE', '/api/v1/account/baskets/basket-1'],
      ['GET', '/api/v1/account/history'],
      ['POST', '/api/v1/account/history'],
      ['GET', '/api/v1/account/subscription'],
      ['POST', '/api/v1/account/verify-email'],
      ['POST', '/api/v1/account/session/rotate'],
      ['DELETE', '/api/v1/account/session'],
    ] as const) {
      const denied = await probe(app, locked, path, { method });
      await expectEnvelope(denied, 401, { error: 'SessionRequired' });

      const allowed = await probe(app, locked, path, {
        method,
        headers: { cookie: `rajahinta_session=${token}` },
      });
      expect(allowed.status, `${method} ${path}`).toBe(200);
    }
  });

  it('account scenarios: session first, then the ADVANCED_FEATURES flag', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();
    const noFlag = testEnv(d1); // flag off (default)

    // No session → SessionRequired (session guard runs first).
    const noSession = await probe(app, noFlag, '/api/v1/account/scenarios');
    await expectEnvelope(noSession, 401, { error: 'SessionRequired' });

    // Session but flag off → flag denies with 403.
    const token = await issueSessionToken(d1, 7);
    const flagOff = await probe(app, noFlag, '/api/v1/account/scenarios', {
      headers: { cookie: `rajahinta_session=${token}` },
    });
    await expectEnvelope(flagOff, 403, { message: 'Feature "ADVANCED_FEATURES" is not enabled' });

    // Session + flag → passes.
    const ok = await probe(
      app,
      testEnv(d1, { FF_ADVANCED_FEATURES: 'true' }),
      '/api/v1/account/scenarios',
      { headers: { cookie: `rajahinta_session=${token}` } },
    );
    expect(ok.status).toBe(200);
  });

  it('ops health: fails closed when unconfigured, admits the configured operator', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    const denied = await probe(app, testEnv(d1), '/ops/health');
    await expectEnvelope(denied, 403, { message: 'Forbidden' });

    const ok = await probe(app, permissiveEnv(d1), '/ops/health', {
      headers: { authorization: `Bearer ${FAKE_OPS_TOKEN}` },
    });
    expect(ok.status).toBe(200);
  });

  it('ops console: ops access AND the OPERATOR_CONSOLE flag (deny before any data)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    // Unconfigured → fail closed.
    const closed = await probe(app, testEnv(d1), '/ops/console/audit');
    await expectEnvelope(closed, 403, { message: 'Forbidden' });

    // Ops config but console flag off (default) → dark even for operators.
    const dark = await probe(app, testEnv(d1, { OPS_BEARER_TOKEN: FAKE_OPS_TOKEN }), '/ops/console/audit', {
      headers: { authorization: `Bearer ${FAKE_OPS_TOKEN}` },
    });
    await expectEnvelope(dark, 403, { message: 'Feature "OPERATOR_CONSOLE" is not enabled' });

    // Ops config + flag → passes both.
    const ok = await probe(app, permissiveEnv(d1), '/ops/console/audit', {
      headers: { authorization: `Bearer ${FAKE_OPS_TOKEN}` },
    });
    expect(ok.status).toBe(200);
  });

  it('health and unscoped routes stay unguarded (reviewed-safe / not-yet-ported)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    const health = await probe(app, testEnv(d1), '/api/v1/health');
    expect(health.status).toBe(200);

    // A route outside every guard prefix falls through to the Nest-parity
    // 404 envelope — no guard rejects it.
    const other = await probe(app, testEnv(d1), '/api/v1/feature-flags');
    expect(other.status).toBe(404);
    const body = (await other.json()) as { message: string; error: string };
    expect(body.message).toBe('Cannot GET /api/v1/feature-flags');
    expect(body.error).toBe('Not Found');
  });
});
