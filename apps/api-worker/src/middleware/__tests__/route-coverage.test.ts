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
import { createApp } from '../../index';

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

  it('ops console: every moderation + newsletter ops route rides the guard prefix (tasks 2.3/5.3)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    // The task-2.3/5.3 additions — each must deny with the SAME
    // fail-closed envelope before any probe handler is reached.
    const opsRoutes: [string, string][] = [
      ['GET', '/ops/console/reports'],
      ['POST', '/ops/console/reports/1/link'],
      ['POST', '/ops/console/reports/1/reject'],
      ['GET', '/ops/console/blacklist/entries'],
      ['POST', '/ops/console/blacklist/publish'],
      ['GET', '/ops/console/blacklist/appeals'],
      ['POST', '/ops/console/blacklist/1/appeal'],
      ['POST', '/ops/console/blacklist/1/resolve'],
      ['POST', '/ops/console/newsletter/notify'],
    ];
    for (const [method, path] of opsRoutes) {
      const closed = await probe(app, testEnv(d1), path, { method });
      await expectEnvelope(closed, 403, { message: 'Forbidden' });

      const open = await probe(app, permissiveEnv(d1), path, {
        method,
        headers: { authorization: `Bearer ${FAKE_OPS_TOKEN}` },
      });
      expect(open.status, `${method} ${path}`).toBe(200);
    }
  });

  it('newsletter: subscribe is rate-limited public; confirm/unsubscribe are token-capability (task 5.3)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();
    const noDoEnv = testEnv(d1); // no RATE_LIMITER binding → limiter fails open

    // Subscribe: public (no session required — consent is
    // account-independent), the AUTH limiter composes ahead and fails
    // open without its DO binding, so the probe handler is reached.
    const subscribe = await probe(app, noDoEnv, '/api/v1/newsletter/subscribe', {
      method: 'POST',
    });
    expect(subscribe.status).toBe(200);

    // Confirm/unsubscribe: deliberately OUT of the guard table — the
    // emailed single-use token IS the capability (verify-email/confirm
    // precedent); nothing anonymous is pinned beyond reachability.
    for (const path of [
      '/api/v1/newsletter/confirm',
      '/api/v1/newsletter/unsubscribe',
    ]) {
      const reachable = await probe(app, noDoEnv, path);
      expect(reachable.status, `GET ${path}`).toBe(200);
    }
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

// ---------------------------------------------------------------------------
// Route inventory (task 9.3, change trust-and-reach-roadmap)
//
// The probe blocks above pin guard BEHAVIOR for the chains registered in
// guards.ts; route-local chains are pinned by their own route test files
// (trip.routes.test.ts 401 face, unitprice.routes.test.ts age gate, …).
// This block pins the route SET itself: every route createApp() registers
// must appear in EXPECTED_ROUTES below, with its rate-limit profile
// documented here and in the guards.ts header map. A new route that
// skips the inventory fails this test — the guard table cannot rot.
//
// Unlike the probe blocks, this one deliberately imports the entry
// script: introspection needs the real composition (no requests are
// made, so no bindings are touched).
// ---------------------------------------------------------------------------

/**
 * Every registered (path, methods) with its rate-limit profile. Profiles:
 * AUTH 10 req/5 min/IP (public writes), CALCULATOR 10/min/IP, BASKET
 * 5/min/IP, HISTORICAL 30/min/IP, DECLARATION 20/min/IP, SAVINGS 30/min/IP,
 * DEFAULT 60/min/IP (requireAccountRateLimit keys the same profile on the
 * resolved account). "—" = no rate limit (public read / token-capability
 * exchange).
 */
const EXPECTED_ROUTES: readonly (readonly [string, readonly string[], string])[] = [
  // Price alerts — sessionAuth + per-account DEFAULT on the handlers.
  ['/api/v1/account/alerts', ['GET', 'POST'], 'DEFAULT (per-account) + sessionAuth'],
  ['/api/v1/account/alerts/:alertId', ['DELETE', 'PATCH'], 'DEFAULT (per-account) + sessionAuth'],
  // AccountController — sessionAuth per route, no rate limit.
  ['/api/v1/account/baskets', ['GET', 'POST'], '— (sessionAuth)'],
  ['/api/v1/account/baskets/:basketId', ['DELETE'], '— (sessionAuth)'],
  ['/api/v1/account/export', ['GET'], '— (sessionAuth)'],
  ['/api/v1/account/history', ['GET', 'POST'], '— (sessionAuth)'],
  // Credential routes — AUTH on the brute-forceable writes; the emailed
  // token IS the capability for confirm/reset ("—" profiles).
  ['/api/v1/account/login', ['POST'], 'AUTH'],
  ['/api/v1/account/me', ['GET'], '— (sessionAuth)'],
  ['/api/v1/account/password/reset', ['POST'], '— (token capability)'],
  ['/api/v1/account/password/reset-request', ['POST'], 'AUTH'],
  ['/api/v1/account/register', ['POST'], 'AUTH'],
  ['/api/v1/account/scenarios', ['GET', 'POST'], '— (sessionAuth)'],
  ['/api/v1/account/scenarios/:id', ['DELETE'], '— (sessionAuth)'],
  ['/api/v1/account/session', ['DELETE'], '— (sessionAuth)'],
  ['/api/v1/account/session/rotate', ['POST'], 'DEFAULT + sessionAuth'],
  ['/api/v1/account/subscription', ['GET'], '— (sessionAuth)'],
  ['/api/v1/account/verify-email/confirm', ['POST'], '— (token capability)'],
  ['/api/v1/account/verify-email/request', ['POST'], '— (sessionAuth)'],
  // Trust-and-reach public trust statistic (task 3.3) — no guard, no limit.
  ['/api/v1/accuracy', ['GET'], '—'],
  // Traveller allowances (insight-surfaces 4.1) — route-local DEFAULT +
  // ageGate (PUBLISHED dataset reads).
  ['/api/v1/allowances', ['GET'], 'DEFAULT + ageGate'],
  ['/api/v1/allowances/versions', ['GET'], 'DEFAULT + ageGate'],
  // Click analytics — write-behind counter, no guard.
  ['/api/v1/analytics/click', ['POST'], '—'],
  // Basket optimizer — BASKET prefix profile at index.ts.
  ['/api/v1/basket/optimize', ['POST'], 'BASKET'],
  // Blog public reads (task 5.1) — PUBLISHED-only, no guard.
  ['/api/v1/blog/posts', ['GET'], '—'],
  ['/api/v1/blog/posts/:slug', ['GET'], '—'],
  // Outcome + share writes (tasks 3.2/6.1) — CALCULATOR prefix at
  // index.ts, sessionAuth from GUARDED_ROUTES.
  ['/api/v1/calculations/:id/outcome', ['POST'], 'CALCULATOR + sessionAuth'],
  ['/api/v1/calculations/:id/share', ['POST'], 'CALCULATOR + sessionAuth'],
  // Legacy direct-engine endpoints — CALCULATOR prefix at index.ts.
  ['/api/v1/calculations/excise', ['POST'], 'CALCULATOR'],
  ['/api/v1/calculations/landed-cost', ['POST'], 'CALCULATOR'],
  // Calculator — CALCULATOR prefix at index.ts, ageGate prefix in guards.
  ['/api/v1/calculator', ['POST'], 'CALCULATOR + ageGate'],
  ['/api/v1/calculator/result/:recordId', ['GET'], 'CALCULATOR + ageGate'],
  // Declaration — ageGate prefix + requireFeature('declaration:summary').
  ['/api/v1/declaration/:recordId', ['GET'], '— + ageGate + entitlement'],
  // Event calculator — route-local CALCULATOR.
  ['/api/v1/event-calc', ['POST'], 'CALCULATOR'],
  // Group orders — create is session-bound (per-account DEFAULT); the
  // participant routes take the share token as the capability.
  ['/api/v1/group-orders', ['POST'], 'DEFAULT (per-account) + sessionAuth'],
  ['/api/v1/group-orders/:shareToken/items', ['POST'], '— (share token)'],
  ['/api/v1/group-orders/:shareToken/join', ['POST'], '— (share token)'],
  ['/api/v1/group-orders/:shareToken/ledger', ['POST'], '— (share token)'],
  // Guides public read (insight-surfaces 5.1) — PUBLISHED GUIDE only, no guard.
  ['/api/v1/guides', ['GET'], '—'],
  // Health — process liveness + dependency readiness, unguarded.
  ['/api/v1/health', ['GET'], '—'],
  ['/api/v1/health/ready', ['GET'], '—'],
  // Curated lists — route-local DEFAULT.
  ['/api/v1/lists', ['GET'], 'DEFAULT'],
  ['/api/v1/lists/:slug', ['GET'], 'DEFAULT'],
  // Merchant reliability embed — route-local ageGate.
  ['/api/v1/merchants/reliability', ['GET'], '— + ageGate'],
  // Newsletter (task 5.3) — AUTH on the public bulk-mail entry point.
  ['/api/v1/newsletter/confirm', ['GET'], '— (token capability)'],
  ['/api/v1/newsletter/subscribe', ['POST'], 'AUTH'],
  ['/api/v1/newsletter/unsubscribe', ['GET'], '— (token capability)'],
  // Outbound redirectors — route-local DEFAULT.
  ['/api/v1/outbound/:offerId', ['GET'], 'DEFAULT'],
  ['/api/v1/outbound/ferry/:offerId', ['GET'], 'DEFAULT'],
  // Search surface — ageGate (guards + search.routes), no rate limit.
  ['/api/v1/products', ['GET'], '— + ageGate'],
  ['/api/v1/products/:id', ['GET'], '— + ageGate'],
  // Product dupes — route-local DEFAULT.
  ['/api/v1/products/:id/dupes', ['GET'], 'DEFAULT'],
  // Price context (insight-surfaces 3.2) — HISTORICAL at index.ts +
  // route-local ageGate (price-history parity).
  ['/api/v1/products/:id/price-context', ['GET'], 'HISTORICAL + ageGate'],
  // Price history — HISTORICAL at index.ts + route-local ageGate.
  ['/api/v1/products/:id/price-history', ['GET'], 'HISTORICAL + ageGate'],
  // Shop-report submission (task 2.2) — AUTH then sessionAuth.
  ['/api/v1/reports', ['POST'], 'AUTH + sessionAuth'],
  // Calculation-record export — DECLARATION at index.ts + ageGate +
  // optional session + entitlement, per-route.
  ['/api/v1/reports/:recordId', ['GET'], 'DECLARATION + ageGate + entitlement'],
  // Savings discovery listing (insight-surfaces 2.3) — route-local
  // ageGate + SAVINGS.
  ['/api/v1/savings', ['GET'], 'SAVINGS + ageGate'],
  // Share permalink read (task 6.1) — public, frozen snapshot.
  ['/api/v1/share/:publicId', ['GET'], '—'],
  // Trip feasibility — route-local CALCULATOR (anonymous surface).
  ['/api/v1/trip-feasibility', ['POST'], 'CALCULATOR'],
  // Trip fill (task 8.2) — route-local CALCULATOR + sessionAuth +
  // entitlement (spec: authenticated users).
  ['/api/v1/trip/fill', ['POST'], 'CALCULATOR + sessionAuth + entitlement'],
  // €/g value ranking (task 7.2) — route-local ageGate, no rate limit.
  ['/api/v1/unitprice/ranking', ['GET'], '— + ageGate'],
  // What-if — route-local CALCULATOR.
  ['/api/v1/what-if/excise', ['POST'], 'CALCULATOR'],
  // Ops console — every route rides the /ops/console/* opsAccess prefix;
  // no rate limit (operator traffic, bearer-token gated).
  ['/ops/console/audit', ['GET'], 'opsAccess'],
  ['/ops/console/blacklist/:id/appeal', ['POST'], 'opsAccess'],
  ['/ops/console/blacklist/:id/resolve', ['POST'], 'opsAccess'],
  ['/ops/console/blacklist/appeals', ['GET'], 'opsAccess'],
  ['/ops/console/blacklist/entries', ['GET'], 'opsAccess'],
  ['/ops/console/blacklist/publish', ['POST'], 'opsAccess'],
  ['/ops/console/blog/guides', ['POST'], 'opsAccess'],
  ['/ops/console/blog/guides/:id', ['POST'], 'opsAccess'],
  ['/ops/console/blog/posts', ['GET'], 'opsAccess'],
  ['/ops/console/blog/posts/:id/publish', ['POST'], 'opsAccess'],
  ['/ops/console/confirmations', ['GET'], 'opsAccess'],
  ['/ops/console/confirmations/consumption-norms/:id/confirm', ['POST'], 'opsAccess'],
  ['/ops/console/confirmations/tax/:id/approve', ['POST'], 'opsAccess'],
  ['/ops/console/confirmations/tax/:id/reject', ['POST'], 'opsAccess'],
  ['/ops/console/corrections', ['GET', 'POST'], 'opsAccess'],
  ['/ops/console/corrections/:id/resolve', ['POST'], 'opsAccess'],
  ['/ops/console/curated-entries', ['GET', 'POST'], 'opsAccess'],
  ['/ops/console/curated-entries/:id', ['POST'], 'opsAccess'],
  ['/ops/console/curated-entries/:id/delete', ['POST'], 'opsAccess'],
  ['/ops/console/curated-entries/:id/publish', ['POST'], 'opsAccess'],
  ['/ops/console/curated-entries/:id/unpublish', ['POST'], 'opsAccess'],
  ['/ops/console/ferry-offers', ['GET', 'POST'], 'opsAccess'],
  ['/ops/console/ferry-offers/:id', ['POST'], 'opsAccess'],
  ['/ops/console/ferry-offers/:id/delete', ['POST'], 'opsAccess'],
  ['/ops/console/ferry-offers/:id/publish', ['POST'], 'opsAccess'],
  ['/ops/console/governance', ['GET'], 'opsAccess'],
  ['/ops/console/governance/:merchantId/grant', ['POST'], 'opsAccess'],
  ['/ops/console/governance/:merchantId/revoke', ['POST'], 'opsAccess'],
  ['/ops/console/newsletter/notify', ['POST'], 'opsAccess'],
  ['/ops/console/producer-links', ['GET', 'POST'], 'opsAccess'],
  ['/ops/console/producer-links/:id', ['POST'], 'opsAccess'],
  ['/ops/console/producer-links/:id/delete', ['POST'], 'opsAccess'],
  ['/ops/console/producer-links/:id/publish', ['POST'], 'opsAccess'],
  ['/ops/console/reports', ['GET'], 'opsAccess'],
  ['/ops/console/reports/:id/link', ['POST'], 'opsAccess'],
  ['/ops/console/reports/:id/reject', ['POST'], 'opsAccess'],
];

describe('route inventory (guards.ts header map parity)', () => {
  it('enumerates every registered route — a new route must extend this inventory', () => {
    const app = createApp();
    const registered = new Map<string, Set<string>>();
    for (const { method, path } of app.routes as unknown as Array<{
      method: string;
      path: string;
    }>) {
      // 'ALL' entries are the prefix middleware (rate limits, guards,
      // logging) — their profiles live in the inventory annotations and
      // the guards.ts header map, not as routes of their own.
      if (method === 'ALL') continue;
      if (!registered.has(path)) registered.set(path, new Set());
      registered.get(path)!.add(method);
    }

    const actual = [...registered.entries()]
      .map(([path, methods]) => [path, [...methods].sort()] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    const expected = EXPECTED_ROUTES.map(
      ([path, methods]) => [path, [...methods].sort()] as const,
    );

    expect(actual).toEqual(expected);
  });

  it('keeps the inventory sorted so additions land in one place', () => {
    const paths = EXPECTED_ROUTES.map(([path]) => path);
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    expect(paths).toEqual(sorted);
  });
});
