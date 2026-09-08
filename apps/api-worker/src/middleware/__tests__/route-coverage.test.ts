/**
 * Guard route-coverage tests (task 3.2) — pins the composition scoping to
 * the Nest controllers' `@UseGuards` decorations (the Worker equivalent of
 * the guard-regression suites: calculator-guard-regression,
 * reports-guard-regression, age-gate-coverage).
 *
 * Each guarded area: unauthenticated/ungated requests are denied with the
 * guard's envelope BEFORE reaching the probe handler; requests satisfying
 * every guard reach it. The anonymous POST /api/v1/account/session
 * issuance route is DELETED (change email-password-auth) — register and
 * login are the only session-issuing endpoints, so nothing anonymous is
 * pinned here.
 *
 * Feature flags and launch gates are gone (owner decision): no probe
 * asserts a flag or launch-gate denial, and /api/v1/feature-flags stays
 * a 404.
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

/** Ops configured — the "everything passes" env. */
function permissiveEnv(d1: D1DatabaseLike): Env {
  return testEnv(d1, {
    OPS_BEARER_TOKEN: FAKE_OPS_TOKEN,
  });
}

describe('guard route coverage (Nest @UseGuards parity)', () => {
  it('calculator: the age gate guards POST /api/v1/calculator', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    // No age confirmation → age gate denies.
    const noAge = await probe(app, permissiveEnv(d1), '/api/v1/calculator', { method: 'POST' });
    await expectEnvelope(noAge, 403, {
      message: 'Age confirmation required. Please confirm your age via the age-gate prompt.',
    });

    // Age confirmed → probe handler reached.
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

  it('products: the age gate guards the search surface', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    const noAge = await probe(app, permissiveEnv(d1), '/api/v1/products');
    await expectEnvelope(noAge, 403, { message: expect.stringMatching(/age confirmation/i) });

    const ok = await probe(app, permissiveEnv(d1), '/api/v1/products', {
      headers: { cookie: 'age_confirmed=1' },
    });
    expect(ok.status).toBe(200);
  });

  it('basket: reachable without flags (rate limit slots in at index.ts)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    const on = await probe(app, testEnv(d1), '/api/v1/basket/optimize', { method: 'POST' });
    expect(on.status).toBe(200);
  });

  it('declaration: age gate at class level, entitlement admits FREE on GET :recordId', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();

    // Age gate first (class-level guard order).
    const noAge = await probe(app, permissiveEnv(d1), '/api/v1/declaration/5');
    await expectEnvelope(noAge, 403, { message: expect.stringMatching(/age confirmation/i) });

    // The entitlement check runs after the age gate. Every feature is
    // FREE tier today, so it admits anonymous callers and valid sessions
    // alike (the middleware itself is covered in entitlement.test.ts).
    const token = await issueSessionToken(d1, 11); // PREMIUM account
    const headerSets: Record<string, string>[] = [
      { 'x-age-confirmed': 'confirmed' },
      { 'x-age-confirmed': 'confirmed', cookie: `rajahinta_session=${token}` },
    ];
    for (const headers of headerSets) {
      const res = await probe(app, permissiveEnv(d1), '/api/v1/declaration/5', { headers });
      expect(res.status).toBe(200);
    }
  });

  it('account routes require a session; credential issuance routes are public', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();
    const locked = testEnv(d1);
    const token = await issueSessionToken(d1, 7);

    // The credential routes (email-password-auth D2) are PUBLIC by design —
    // register/login/reset-request carry only the AUTH rate limit, and the
    // anonymous POST /session issuance route is deleted; their probe
    // handlers are reachable without a cookie.
    for (const path of [
      '/api/v1/account/register',
      '/api/v1/account/login',
      '/api/v1/account/password/reset-request',
    ]) {
      const publicRoute = await probe(app, locked, path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      expect(publicRoute.status, `POST ${path}`).toBe(200);
    }

    // Everything else in the /api/v1/account prefix (class-level
    // SessionAuthGuard) requires the session cookie. The self-asserted
    // POST /api/v1/account/verify-email endpoint is DELETED (replaced by
    // the verify-email/request + /confirm token flow).
    for (const [method, path] of [
      ['GET', '/api/v1/account/export'],
      ['GET', '/api/v1/account/me'],
      ['GET', '/api/v1/account/baskets'],
      ['POST', '/api/v1/account/baskets'],
      ['DELETE', '/api/v1/account/baskets/basket-1'],
      ['GET', '/api/v1/account/history'],
      ['POST', '/api/v1/account/history'],
      ['GET', '/api/v1/account/subscription'],
      ['POST', '/api/v1/account/verify-email/request'],
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

  it('account scenarios: session-guarded only (flag removed)', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();

    // No session → SessionRequired.
    const noSession = await probe(app, testEnv(d1), '/api/v1/account/scenarios');
    await expectEnvelope(noSession, 401, { error: 'SessionRequired' });

    // Session → passes (no flag check anymore).
    const token = await issueSessionToken(d1, 7);
    const ok = await probe(app, testEnv(d1), '/api/v1/account/scenarios', {
      headers: { cookie: `rajahinta_session=${token}` },
    });
    expect(ok.status).toBe(200);
  });

  it('shop reports: AUTH rate limit then session (guard order, task 2.2)', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();
    const token = await issueSessionToken(d1, 7);

    // No session → SessionRequired (the AUTH limiter fails open without a
    // DO binding here; the session guard is the denial face).
    const denied = await probe(app, testEnv(d1), '/api/v1/reports', { method: 'POST' });
    await expectEnvelope(denied, 401, { error: 'SessionRequired' });

    // Session → reaches the probe handler.
    const allowed = await probe(app, testEnv(d1), '/api/v1/reports', {
      method: 'POST',
      headers: { cookie: `rajahinta_session=${token}` },
    });
    expect(allowed.status).toBe(200);
  });

  it('outcome + share writes: session-guarded (tasks 3.2/6.1)', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();
    const token = await issueSessionToken(d1, 7);

    for (const path of [
      '/api/v1/calculations/1/outcome',
      '/api/v1/calculations/1/share',
    ]) {
      const denied = await probe(app, testEnv(d1), path, { method: 'POST' });
      await expectEnvelope(denied, 401, { error: 'SessionRequired' });

      const allowed = await probe(app, testEnv(d1), path, {
        method: 'POST',
        headers: { cookie: `rajahinta_session=${token}` },
      });
      expect(allowed.status, `POST ${path}`).toBe(200);
    }
  });

  it('ops console: ops access (deny before any data)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    // Unconfigured → fail closed.
    const closed = await probe(app, testEnv(d1), '/ops/console/audit');
    await expectEnvelope(closed, 403, { message: 'Forbidden' });

    // Ops config → passes.
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
    // 404 envelope — no guard rejects it. /api/v1/feature-flags is pinned
    // here as a regression guard: the flag-map endpoint was REMOVED with
    // the flag system.
    const other = await probe(app, testEnv(d1), '/api/v1/feature-flags');
    expect(other.status).toBe(404);
    const body = (await other.json()) as { message: string; error: string };
    expect(body.message).toBe('Cannot GET /api/v1/feature-flags');
    expect(body.error).toBe('Not Found');
  });
});
