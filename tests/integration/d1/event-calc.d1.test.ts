/**
 * Event-calculator integration suite (task 4.6, change
 * product-roadmap-phases-1-4) — the whole feature against the real stack:
 * the FULL worker app composition (createApp + registerEventCalcRoutes —
 * flag gate → rate limiter → handler, exactly as index.ts wires) over a
 * real migrated D1 (node:sqlite through the structural shim) and
 * in-memory DO namespaces.
 *
 * Scope note — this file deliberately does NOT repeat the unit suites'
 * bindings: norms effective-date resolution (half-open windows, open-ended
 * versions, newest-wins overlap) is pinned by the task-4.1 repository
 * tests, minimal-surplus rounding by the task-4.2 eventcalc tests, and V2
 * assignment determinism (country-order tie-break, shuffled option arrays)
 * by the task-4.5 sourcing tests. What only an integration run proves
 * end-to-end:
 *
 * 1. unpublished norms invisible: seed PENDING_CONFIRMATION → the route
 *    answers NO_PUBLISHED_NORMS (uncached) → the manual confirmation path
 *    (D1ConsumptionNormsRepository.publish) makes the SAME rows visible →
 *    the route computes and names the version — the governance lifecycle
 *    across the HTTP boundary (spec: Manual confirmation required);
 * 2. the structural norms-are-estimates disclaimer rides EVERY 200
 *    result: MVP COMPUTED, NO_PUBLISHED_NORMS (with and without a
 *    sourcing section), and the V2 plan response;
 * 3. flag-off 403: the standard feature-disabled envelope for both
 *    request shapes, the gate composing before the handler parses
 *    anything;
 * 4. V2 determinism across the wire: the same request twice yields a
 *    byte-identical body (deep-equal + equal X-Content-Hash), the second
 *    served as an idempotency HIT — the spec's deterministic-ordering
 *    requirement observed over HTTP, cache round-trip included.
 *
 * Golden note — no golden fixtures added (spec: minimal golden delta):
 * tests/golden/ drives real engines over in-memory product/offer ports
 * (per-category.test.ts pattern); the event route is anonymous and
 * norms-dependent (a migrated D1 plus the PENDING → PUBLISHED lifecycle),
 * which that harness structure does not accommodate. The eventcalc
 * golden-relevant math stays pinned by the pure-module suites
 * (eventcalc.test.ts, eventcalc-sourcing.test.ts); this D1 suite is the
 * route-level real-stack delta.
 *
 * The route/env helpers are imported from the api-worker route harness
 * (not duplicated): the composition they build IS the code under test.
 *
 * @module EventCalcD1IntegrationTest
 */
import type { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createApp,
  expectEnvelope,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedTaxRule,
} from '../../../apps/api-worker/src/routes/__tests__/harness';
import { registerEventCalcRoutes } from '../../../apps/api-worker/src/routes/event-calc.routes';
import { D1ConsumptionNormsRepository } from '../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import type { ConsumptionNormInsert } from '../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import type { Env } from '../../../apps/api-worker/src/env';
import type { D1DatabaseLike } from '../../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const CITATION = 'Curated integration norm — https://example.invalid/norms';

const NORMS_VERSION = 'norms-it-2026.1';

/** 0.5 l/g/h beer norm for the casual-gathering profile, effective 2026-01-01. */
const BEER_NORM: ConsumptionNormInsert = {
  versionLabel: NORMS_VERSION,
  drinkType: 'beer',
  eventProfile: 'casual_gathering',
  normValuePerGuestPerHour: 0.5,
  sourceCitation: CITATION,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
};

const EVENT = {
  guests: 10,
  durationHours: 4,
  eventProfile: 'casual_gathering',
  eventDate: '2026-06-01',
};

/** Real engine fixtures (design R14, route-test parity): beer excise on the
 * per-centilitre-ethanol formula, flat per-litre container duty — both
 * effective before the event date, so the route's asOf resolution finds them. */
function seedSourcingTaxRules(db: DatabaseSync): void {
  seedTaxRule(db, { id: 1, taxType: 'excise', productCategory: 'beer', rate: 0.365 });
  seedTaxRule(db, {
    id: 2,
    taxType: 'container_duty',
    productCategory: 'all_beverages',
    rate: 0.51,
    verified: false,
  });
}

/** The sourcing section pricing beer domestically and in Estonia. */
function sourcingBeer(): Record<string, unknown> {
  return {
    lines: [
      {
        drinkType: 'beer',
        abvPercent: 4.7,
        container: 'can',
        domesticPricePerLitreCents: 500,
        foreign: [{ country: 'EE', pricePerLitreCents: 200 }],
      },
    ],
  };
}

/** Full production composition (index.ts wiring: guards first, then routes). */
function eventCalcApp(): ReturnType<typeof createApp> {
  const app = createApp();
  registerEventCalcRoutes(app);
  return app;
}

/** Flag-on env over the given D1 (permissive env leaves the flag unset). */
function eventCalcEnv(d1: D1DatabaseLike): Env {
  return permissiveEnv(d1, { FF_EVENT_CALCULATOR: 'true' });
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function postEvent(
  app: ReturnType<typeof createApp>,
  env: Env,
  body: unknown = EVENT,
): Promise<Response> {
  return request(app, env, '/api/v1/event-calc', jsonInit(body));
}

/** Minimal response shapes — the exact-field pins live in the unit suites. */
interface EventCalcJson {
  status: string;
  normsVersion?: string;
  lines?: { drinkType: string; needMl: number; surplusMl: number }[];
  disclaimer?: { text: string; language: string; version: string };
  plan?: {
    lines: {
      drinkType: string;
      sourceCountry: string;
      sourceKind: string;
      totalCents: number;
      components: {
        retailCents: number;
        exciseCents: number;
        containerDutyCents: number;
        transportCents: number;
      };
    }[];
    unpricedDrinkTypes: string[];
    totalCents: number;
    budget: unknown;
  };
}

/** The structural disclaimer, asserted the same way on every 200 state. */
function expectNormsDisclaimer(body: EventCalcJson): void {
  expect(body.disclaimer).toEqual({
    text: expect.stringContaining('kulutusnormeihin'),
    language: 'fi',
    version: '1.0',
  });
}

// ---------------------------------------------------------------------------
// Shared state — fresh migrated D1 + app per test
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — real-stack integration (task 4.6)', () => {
  let db: DatabaseSync;
  let d1: D1DatabaseLike;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;
    app = eventCalcApp();
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // 1. Unpublished norms invisible — the governance lifecycle end-to-end
  // -------------------------------------------------------------------------

  it('keeps PENDING_CONFIRMATION norms invisible until the manual publish, then computes the SAME request', async () => {
    const repo = new D1ConsumptionNormsRepository(d1);
    const [created] = await repo.createPendingVersion([BEER_NORM]);

    // While pending: the route sees NOTHING — 200 with the explicit empty
    // state, and no X-Cache header (the empty state is deliberately not
    // cached, so it cannot outlive the publication it precedes).
    const pending = await postEvent(app, eventCalcEnv(d1));
    expect(pending.status).toBe(200);
    expect(pending.headers.get('X-Cache')).toBeNull();
    expect(((await pending.json()) as EventCalcJson).status).toBe(
      'NO_PUBLISHED_NORMS',
    );

    // Ground truth: the repository's calculator-facing read resolves the
    // same invisibility — nothing PUBLISHED covers the event date yet.
    expect(
      await repo.findPublishedEffectiveOn(EVENT.eventProfile, EVENT.eventDate),
    ).toEqual([]);

    // The operator confirms through the manual publish path — the only
    // route to PUBLISHED (no auto-publish seam exists to shortcut it).
    const published = await repo.publish(created.id, 'ops-integration');
    expect(published).not.toBeNull();
    expect(published!.status).toBe('PUBLISHED');

    // The SAME request now computes and names the version it used.
    const computed = await postEvent(app, eventCalcEnv(d1));
    expect(computed.status).toBe(200);
    const body = (await computed.json()) as EventCalcJson;
    expect(body.status).toBe('COMPUTED');
    expect(body.normsVersion).toBe(NORMS_VERSION);
    expect(body.lines).toHaveLength(1);
    expect(body.lines![0]!.drinkType).toBe('beer');
    expect(body.lines![0]!.needMl).toBe(20_000); // 0.5 l × 10 guests × 4 h
    expect(body.lines![0]!.surplusMl).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // 2. Disclaimer present in EVERY result — a sweep over all 200 states
  // -------------------------------------------------------------------------

  it('carries the structural norms-are-estimates disclaimer on every 200 result: NO_PUBLISHED_NORMS (MVP + V2) and COMPUTED (MVP + V2)', async () => {
    const repo = new D1ConsumptionNormsRepository(d1);
    const env = eventCalcEnv(d1);

    // State 1 — nothing in the table at all, MVP request.
    const empty = await postEvent(app, env);
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as EventCalcJson;
    expect(emptyBody.status).toBe('NO_PUBLISHED_NORMS');
    expectNormsDisclaimer(emptyBody);

    // State 2 — pending-only norms WITH a sourcing section: the V2 request
    // shape changes nothing (no norms ⇒ no lines to source, no plan), the
    // disclaimer stays.
    const [created] = await repo.createPendingVersion([BEER_NORM]);
    const pendingV2 = await postEvent(app, env, { ...EVENT, sourcing: sourcingBeer() });
    expect(pendingV2.status).toBe(200);
    const pendingBody = (await pendingV2.json()) as EventCalcJson;
    expect(pendingBody.status).toBe('NO_PUBLISHED_NORMS');
    expect(pendingBody.plan).toBeUndefined();
    expectNormsDisclaimer(pendingBody);

    // States 3 + 4 — the publish flips the same rows visible: COMPUTED on
    // both the MVP shape and the V2 plan shape.
    await repo.publish(created.id, 'ops-integration');
    const computed = await postEvent(app, env);
    expect(computed.status).toBe(200);
    const computedBody = (await computed.json()) as EventCalcJson;
    expect(computedBody.status).toBe('COMPUTED');
    expectNormsDisclaimer(computedBody);

    seedSourcingTaxRules(db);
    const v2 = await postEvent(app, env, { ...EVENT, sourcing: sourcingBeer() });
    expect(v2.status).toBe(200);
    const v2Body = (await v2.json()) as EventCalcJson;
    expect(v2Body.status).toBe('COMPUTED');
    expect(v2Body.plan).toBeDefined();
    expectNormsDisclaimer(v2Body);
  });

  // -------------------------------------------------------------------------
  // 3. Flag-off 403 — gate composes before the handler, both request shapes
  // -------------------------------------------------------------------------

  it('rejects the MVP request with 403 while EVENT_CALCULATOR is off (alerts 403 shape)', async () => {
    const res = await postEvent(app, lockedEnv(d1));
    await expectEnvelope(res, 403, {
      message: 'Feature "EVENT_CALCULATOR" is not enabled',
      error: 'Forbidden',
    });
  });

  it('rejects the V2 request with the same 403 — the gate fires before any sourcing parsing', async () => {
    const res = await postEvent(app, lockedEnv(d1), {
      ...EVENT,
      sourcing: sourcingBeer(),
    });
    await expectEnvelope(res, 403, {
      message: 'Feature "EVENT_CALCULATOR" is not enabled',
      error: 'Forbidden',
    });
  });

  // -------------------------------------------------------------------------
  // 4. V2 determinism across the wire — byte-identical repeat, HIT served
  // -------------------------------------------------------------------------

  it('serves the same V2 request twice byte-identically — MISS then idempotency HIT, deterministic country assignment', async () => {
    const repo = new D1ConsumptionNormsRepository(d1);
    const [created] = await repo.createPendingVersion([BEER_NORM]);
    // The only-PUBLISHED path, exercising the same operator confirmation
    // the lifecycle test proves end-to-end.
    await repo.publish(created.id, 'ops-integration');
    seedSourcingTaxRules(db);
    const env = eventCalcEnv(d1);
    const sourcing = sourcingBeer();

    const first = await postEvent(app, env, { ...EVENT, sourcing });
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    const firstBody = (await first.json()) as EventCalcJson;
    const firstHash = first.headers.get('X-Content-Hash');
    expect(firstHash).not.toBeNull();
    expectNormsDisclaimer(firstBody);

    // Deterministic assignment content: EE undercuts FI beyond the import
    // taxes (2.00 €/l + 34 ¢ excise + 1 020 ¢ duty vs 5.00 €/l domestic —
    // exact engine vectors pinned by the route-unit suite), and the plan
    // total is its lines.
    const plan = firstBody.plan!;
    expect(plan.lines).toHaveLength(1);
    const line = plan.lines[0]!;
    expect(line.drinkType).toBe('beer');
    expect(line.sourceCountry).toBe('EE');
    expect(line.sourceKind).toBe('FOREIGN');
    expect(line.components.retailCents).toBe(4_000);
    expect(line.components.exciseCents).toBe(34);
    expect(line.components.containerDutyCents).toBe(1_020);
    expect(line.totalCents).toBe(5_054);
    expect(plan.totalCents).toBe(line.totalCents);
    expect(plan.unpricedDrinkTypes).toEqual([]);
    expect(plan.budget).toBeNull();

    // The repeat is served from the idempotency store: byte-identical body
    // (disclaimer included) and the identical content hash — the spec's
    // "identically on every run", observed across the cache round-trip.
    const repeat = await postEvent(app, env, { ...EVENT, sourcing });
    expect(repeat.status).toBe(200);
    expect(repeat.headers.get('X-Cache')).toBe('HIT');
    expect(repeat.headers.get('X-Content-Hash')).toBe(firstHash);
    expect(await repeat.json()).toEqual(firstBody);
  });
});
