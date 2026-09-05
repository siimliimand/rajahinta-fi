/**
 * Event-calculator route tests (task 4.3, change
 * product-roadmap-phases-1-4) over the FULL app composition
 * (createApp() + registerEventCalcRoutes — the exact composition
 * index.ts wires, flag gate + rate limit on the route itself) on the
 * fake-D1 harness.
 *
 * Pinning here: the validation caps (guests 1..500, durationHours
 * 1..72, whole hours), flag-off 403 (EVENT_CALCULATOR, same envelope
 * shape the alerts gate uses — 4.6 integration tests rely on this
 * class of contract), the NO_PUBLISHED_NORMS empty state (pending
 * norms invisible, wrong profile/date not resolved), the STRUCTURAL
 * disclaimer field on every result, and version-aware idempotency
 * (byte-identical repeats within a norms version; a published newer
 * version yields a fresh result under the same request).
 *
 * @module EventCalcRoutesTest
 */

import type { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import {
  createApp,
  expectEnvelope,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedTaxRule,
} from './harness';
import { registerEventCalcRoutes } from '../event-calc.routes';
import { D1ConsumptionNormsRepository } from '../../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import type { ConsumptionNormInsert } from '../../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers the event-calculator handler behind its route-level
 * gate+limiter (same slot as the other route ports); the test composition
 * mirrors that exactly.
 */
function eventCalcApp(): ReturnType<typeof createApp> {
  const app = createApp();
  registerEventCalcRoutes(app);
  return app;
}

function eventCalcEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, { ...overrides, FF_EVENT_CALCULATOR: 'true' });
}

const CITATION = 'Curated test norm — https://example.invalid/norms';

/** Append one norms version (single row) and publish it — the only PUBLISHED path. */
async function seedPublishedNorm(
  d1: D1DatabaseLike,
  overrides: Partial<ConsumptionNormInsert> = {},
): Promise<number> {
  const repo = new D1ConsumptionNormsRepository(d1);
  const row: ConsumptionNormInsert = {
    versionLabel: 'norms-test-2026.1',
    drinkType: 'beer',
    eventProfile: 'casual_gathering',
    normValuePerGuestPerHour: 0.5,
    sourceCitation: CITATION,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
  const [created] = await repo.createPendingVersion([row]);
  const published = await repo.publish(created.id, 'ops-test');
  expect(published).not.toBeNull();
  return created.id;
}

const EVENT = {
  guests: 10,
  durationHours: 4,
  eventProfile: 'casual_gathering',
  eventDate: '2026-06-01',
};

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

interface EventCalcJson {
  status: string;
  normsVersion?: string;
  lines?: {
    drinkType: string;
    needMl: number;
    needLitres: number;
    plannedUnits: { sizeMl: number; description: string; quantity: number }[];
    surplusMl: number;
  }[];
  disclaimer?: { text: string; language: string; version: string };
}

async function postEvent(
  app: ReturnType<typeof createApp>,
  env: Env,
  body: unknown = EVENT,
): Promise<Response> {
  return request(app, env, '/api/v1/event-calc', jsonInit(body));
}

// ---------------------------------------------------------------------------
// Gate: flag-off 403 (EVENT_CALCULATOR)
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — gate', () => {
  it('rejects with 403 while EVENT_CALCULATOR is off (alerts 403 shape)', async () => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const res = await postEvent(app, lockedEnv(d1));
    await expectEnvelope(res, 403, {
      message: 'Feature "EVENT_CALCULATOR" is not enabled',
    });
  });
});

// ---------------------------------------------------------------------------
// Validation — caps and shapes
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — validation caps', () => {
  it.each([0, -5, 0.5, 501, 10_000])('rejects guests=%s with 400', async (guests) => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1), { ...EVENT, guests });
    await expectEnvelope(res, 400, { error: 'ValidationError' });
  });

  it.each([0, -1, 2.5, 73])('rejects durationHours=%s with 400 (whole hours only)', async (durationHours) => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1), { ...EVENT, durationHours });
    await expectEnvelope(res, 400, { error: 'ValidationError' });
  });

  it('rejects an unknown profile and a non-ISO date with 400', async () => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);
    const badProfile = await postEvent(app, env, { ...EVENT, eventProfile: 'wedding' });
    await expectEnvelope(badProfile, 400, { error: 'ValidationError' });
    const badDate = await postEvent(app, env, { ...EVENT, eventDate: '2026/06/01' });
    await expectEnvelope(badDate, 400, { error: 'ValidationError' });
  });

  it('accepts the caps as boundaries (guests=500, durationHours=72)', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1), {
      ...EVENT,
      guests: 500,
      durationHours: 72,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventCalcJson;
    expect(body.status).toBe('COMPUTED');
    // 0.5 l × 500 guests × 72 h in exact integer ml.
    expect(body.lines![0]!.needMl).toBe(18_000_000);
  });
});

// ---------------------------------------------------------------------------
// Norms resolution — explicit empty state
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — norms resolution', () => {
  it('returns 200 NO_PUBLISHED_NORMS when nothing was ever published', async () => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventCalcJson;
    expect(body.status).toBe('NO_PUBLISHED_NORMS');
    expect(body.disclaimer).toMatchObject({ language: 'fi', version: '1.0' });
  });

  it('treats PENDING_CONFIRMATION norms as invisible (nothing published yet)', async () => {
    const { d1 } = openMigratedD1();
    const repo = new D1ConsumptionNormsRepository(d1);
    await repo.createPendingVersion([
      {
        versionLabel: 'norms-pending-1',
        drinkType: 'beer',
        eventProfile: 'casual_gathering',
        normValuePerGuestPerHour: 0.5,
        sourceCitation: CITATION,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ]);
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1));
    expect(res.status).toBe(200);
    expect(((await res.json()) as EventCalcJson).status).toBe('NO_PUBLISHED_NORMS');
  });

  it('does not resolve norms of a different profile or before the effective window', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedNorm(d1, { eventProfile: 'dinner_party' });
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);
    const wrongProfile = await postEvent(app, env);
    expect(((await wrongProfile.json()) as EventCalcJson).status).toBe('NO_PUBLISHED_NORMS');

    await seedPublishedNorm(d1, { versionLabel: 'norms-test-2026.2', effectiveFrom: '2026-07-01' });
    const before = await postEvent(app, env);
    expect(((await before.json()) as EventCalcJson).status).toBe('NO_PUBLISHED_NORMS');
  });
});

// ---------------------------------------------------------------------------
// Computed result — structural disclaimer
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — computed result', () => {
  it('returns the shopping list naming the norms version, with the structural disclaimer', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventCalcJson;

    expect(body.status).toBe('COMPUTED');
    expect(body.normsVersion).toBe('norms-test-2026.1');
    expect(body.lines).toHaveLength(1);
    const line = body.lines![0]!;
    expect(line.drinkType).toBe('beer');
    expect(line.needMl).toBe(20_000); // 0.5 l × 10 guests × 4 h
    expect(line.needLitres).toBe(20);
    expect(line.plannedUnits!.length).toBeGreaterThanOrEqual(1);
    expect(line.plannedUnits![0]!.description).toBeTruthy();
    expect(line.surplusMl).toBeGreaterThanOrEqual(0);

    // Structural field, not a string: same keys as the disclaimer module.
    expect(body.disclaimer).toEqual({
      text: expect.stringContaining('kulutusnormeihin'),
      language: 'fi',
      version: '1.0',
    });
  });
});

// ---------------------------------------------------------------------------
// Version-aware idempotency
// ---------------------------------------------------------------------------

describe('POST /api/v1/event-calc — version-aware idempotency', () => {
  it('serves a byte-identical repeat (X-Cache HIT) and a fresh result after a norms bump', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedNorm(d1, { versionLabel: 'norms-v1' });
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);

    const first = await postEvent(app, env);
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    const firstBody = (await first.json()) as EventCalcJson;
    expect(firstBody.normsVersion).toBe('norms-v1');
    const firstHash = first.headers.get('X-Content-Hash');
    expect(firstHash).not.toBeNull();

    const repeat = await postEvent(app, env);
    expect(repeat.headers.get('X-Cache')).toBe('HIT');
    expect(repeat.headers.get('X-Content-Hash')).toBe(firstHash);
    expect(await repeat.json()).toEqual(firstBody);

    // A NEWER version published effective on the same date changes the
    // resolved dataset version → fresh result, not a stale HIT.
    await seedPublishedNorm(d1, {
      versionLabel: 'norms-v2',
      normValuePerGuestPerHour: 0.6,
      effectiveFrom: '2026-02-01',
    });
    const afterBump = await postEvent(app, env);
    expect(afterBump.headers.get('X-Cache')).toBe('MISS');
    const bumpBody = (await afterBump.json()) as EventCalcJson;
    expect(bumpBody.normsVersion).toBe('norms-v2');
    expect(bumpBody.lines![0]!.needMl).toBe(24_000); // 0.6 l × 10 × 4
    expect(afterBump.headers.get('X-Content-Hash')).not.toBe(firstHash);
  });
});

// ---------------------------------------------------------------------------
// V2 cross-border sourcing (task 4.5)
// ---------------------------------------------------------------------------

/**
 * Real engine fixtures (design R14: golden-style tests use real engines,
 * not mocks): beer excise on the per-centilitre-ethanol formula and the
 * flat per-litre container duty, both effective from 2026-01-01 — the
 * event date 2026-06-01 resolves them through the same half-open
 * windows the production route uses.
 */
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

/** 0.5 l × 10 guests × 4 h = exactly 20 l → 40 × 0.5 l cans, zero surplus. */
const BEER_RETAIL_CENTS_AT = (centsPerLitre: number): number =>
  Math.round((centsPerLitre * 20_000) / 1000);

interface V2LineJson {
  drinkType: string;
  sourceCountry: string;
  sourceKind: string;
  totalCents: number;
  components: { retailCents: number; exciseCents: number; containerDutyCents: number; transportCents: number };
  statuses: Record<string, string>;
  confidenceOverall: string;
  datasetVersions: string[];
  domesticTotalCents: number;
  savingsVsDomesticCents: number;
}

interface V2Json extends EventCalcJson {
  plan?: {
    lines: V2LineJson[];
    unpricedDrinkTypes: string[];
    totalCents: number;
    budget: { limitCents: number; totalCents: number; met: boolean; overrunCents: number } | null;
  };
  packing?: {
    suggestion: {
      status: string;
      boxes: unknown[];
      excludedItems: { productId: number; quantity: number; reason: string }[];
      mixingWarning: unknown;
    };
    lines: { productId: number; drinkType: string }[];
  };
}

/** A sourcing section pricing beer domestically and in Estonia. */
function sourcingBeer(
  domesticCentsPerLitre: number,
  foreign: { country: string; pricePerLitreCents: number }[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    lines: [
      {
        drinkType: 'beer',
        abvPercent: 4.7,
        container: 'can',
        domesticPricePerLitreCents: domesticCentsPerLitre,
        foreign,
      },
    ],
    ...overrides,
  };
}

function postV2(
  app: ReturnType<typeof createApp>,
  env: Env,
  sourcing: Record<string, unknown>,
): Promise<Response> {
  return postEvent(app, env, { ...EVENT, sourcing });
}

describe('POST /api/v1/event-calc — V2 plan', () => {
  it('assigns a line to the foreign source that undercuts the domestic total, engines priced', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    seedSourcingTaxRules(db);
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);

    // EE shelf 2.00 €/l vs FI 5.00 €/l: 4 000 + excise + duty well under 10 000.
    const res = await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as V2Json;

    // MVP shape stays intact next to the plan; structural disclaimer too.
    expect(body.status).toBe('COMPUTED');
    expect(body.disclaimer).toMatchObject({ language: 'fi' });
    expect(body.plan).toBeDefined();

    const plan = body.plan!;
    expect(plan.lines).toHaveLength(1);
    const line = plan.lines[0]!;
    expect(line.drinkType).toBe('beer');
    expect(line.sourceCountry).toBe('EE');
    expect(line.sourceKind).toBe('FOREIGN');
    // Retail basis is user-supplied: exact half-up cents over exact ml.
    expect(line.components.retailCents).toBe(BEER_RETAIL_CENTS_AT(200));
    // Landed-cost engines priced the import — EXACT vectors (design R14):
    // excise 94 cl ethanol × 0.365 ¢/cl = 34 ¢; duty 20 l × 51 ¢/l = 1020 ¢.
    expect(line.components.exciseCents).toBe(34);
    expect(line.components.containerDutyCents).toBe(1020);
    // No carrier dimension yet: transport is an explicit UNAVAILABLE zero.
    expect(line.components.transportCents).toBe(0);
    expect(line.statuses.transport).toBe('UNAVAILABLE');
    // Every figure traceable: the total is its components; datasets named.
    expect(line.totalCents).toBe(4000 + 34 + 1020);
    expect(line.totalCents).toBe(
      line.components.retailCents +
        line.components.exciseCents +
        line.components.containerDutyCents +
        line.components.transportCents,
    );
    expect(line.datasetVersions.length).toBeGreaterThanOrEqual(2);
    expect(line.domesticTotalCents).toBe(BEER_RETAIL_CENTS_AT(500));
    expect(line.savingsVsDomesticCents).toBe(10_000 - 5_054);
    expect(plan.unpricedDrinkTypes).toEqual([]);
    expect(plan.totalCents).toBe(line.totalCents);
    expect(plan.budget).toBeNull();
  });

  it('keeps the domestic store when Finnish taxes erase the shelf-price gap', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    seedSourcingTaxRules(db);
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);

    // EE shelf 4.90 €/l → 9 800 + 34 excise + 1 020 duty = 10 854 over the
    // 10 000 domestic total — the gap only erases through the taxes.
    const res = await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 490 }]));
    const body = (await res.json()) as V2Json;
    const line = body.plan!.lines[0]!;
    expect(line.sourceCountry).toBe('FI');
    expect(line.sourceKind).toBe('DOMESTIC');
    expect(line.totalCents).toBe(BEER_RETAIL_CENTS_AT(500));
    expect(line.components.exciseCents).toBe(0);
    expect(line.components.containerDutyCents).toBe(0);
    expect(line.savingsVsDomesticCents).toBe(0);
  });

  it('breaks a foreign tie by the fixed country order regardless of array order', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    seedSourcingTaxRules(db);
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);

    // Identical shelf prices in DE and LV ⇒ identical landed totals ⇒
    // SOURCING_COUNTRY_ORDER decides (LV before DE); the MIRROR request
    // lists them in the opposite order and must produce the same plan.
    const first = await postV2(app, env, sourcingBeer(500, [
      { country: 'DE', pricePerLitreCents: 200 },
      { country: 'LV', pricePerLitreCents: 200 },
    ]));
    const mirror = await postV2(app, env, sourcingBeer(500, [
      { country: 'LV', pricePerLitreCents: 200 },
      { country: 'DE', pricePerLitreCents: 200 },
    ]));
    const firstBody = (await first.json()) as V2Json;
    expect((await mirror.json()) as V2Json).toEqual(firstBody);
    expect(firstBody.plan!.lines[0]!.sourceCountry).toBe('LV');
  });

  it('degrades an exceeded budget explicitly: complete plan, met:false, exact overrun', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    seedSourcingTaxRules(db);
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);

    const plain = (await (await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }]))).json()) as V2Json;
    const budgeted = (await (await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }], { budgetCents: 100 }))).json()) as V2Json;

    // NOT truncated: identical assignment and total, only the flag differs.
    expect(budgeted.plan!.lines).toEqual(plain.plan!.lines);
    expect(budgeted.plan!.budget).toEqual({
      limitCents: 100,
      totalCents: plain.plan!.totalCents,
      met: false,
      overrunCents: plain.plan!.totalCents - 100,
    });
  });

  it('reports unpriced plan lines explicitly instead of dropping them', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    seedSourcingTaxRules(db);
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);

    const res = await postV2(app, env, sourcingBeer(500, []));
    const body = (await res.json()) as V2Json;
    expect(body.plan!.lines).toHaveLength(1);
    expect(body.plan!.lines[0]!.sourceCountry).toBe('FI');
    expect(body.plan!.totalCents).toBe(BEER_RETAIL_CENTS_AT(500));
  });

  it('stays a NO_PUBLISHED_NORMS value when sourcing is requested but no norms exist', async () => {
    const { d1 } = openMigratedD1();
    const app = eventCalcApp();
    const res = await postV2(app, eventCalcEnv(d1), sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as V2Json;
    expect(body.status).toBe('NO_PUBLISHED_NORMS');
    expect(body.plan).toBeUndefined();
    expect(body.disclaimer).toMatchObject({ language: 'fi' });
  });
});

describe('POST /api/v1/event-calc — V2 idempotency', () => {
  it('serves byte-identical V2 repeats and keys equal plans canonically (array order-insensitive)', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    seedSourcingTaxRules(db);
    const app = eventCalcApp();
    const env = eventCalcEnv(d1);

    const first = await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }]));
    expect(first.headers.get('X-Cache')).toBe('MISS');
    const firstBody = (await first.json()) as V2Json;

    const repeat = await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }]));
    expect(repeat.headers.get('X-Cache')).toBe('HIT');
    expect(await repeat.json()).toEqual(firstBody);

    // Same plan, different foreign-array order ⇒ same canonical key ⇒ HIT.
    const reordered = await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }]));
    expect(reordered.headers.get('X-Cache')).toBe('HIT');

    // A different budget changes the result ⇒ fresh MISS.
    const otherBudget = await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }], { budgetCents: 999_999 }));
    expect(otherBudget.headers.get('X-Cache')).toBe('MISS');
  });
});

describe('POST /api/v1/event-calc — V2 packing opt-in', () => {
  function seedBoxType(db: DatabaseSync): void {
    db.prepare(
      `INSERT INTO carrier_box_types (
         carrier, name, internal_height_mm, internal_width_mm, internal_depth_mm,
         max_weight_g, source, observed_at
       ) VALUES ('postnord', 'PostNord Box M', 250, 180, 120, 5000, 'carrier packaging page', ?)`,
    ).run(new Date().toISOString());
  }

  it('attaches the packing section over the foreign haul when opted in and flagged on', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    seedSourcingTaxRules(db);
    seedBoxType(db);
    const app = eventCalcApp();
    const env = eventCalcEnv(d1, { FF_PACKING_OPTIMIZER: 'true' });

    const res = await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }], { packing: true }));
    const body = (await res.json()) as V2Json;
    expect(body.packing).toBeDefined();
    // Synthetic id 1 = beer (position in the canonical set + 1), echoed.
    expect(body.packing!.lines).toEqual([{ productId: 1, drinkType: 'beer' }]);
    // No product_dimensions rows exist for drink types — the packing
    // module's own degradation: ESTIMATED status + named exclusions.
    expect(body.packing!.suggestion.status).toBe('ESTIMATED');
    expect(body.packing!.suggestion.excludedItems).toEqual([
      { productId: 1, quantity: 40, reason: 'MISSING_DIMENSIONS' },
    ]);
    expect(body.packing!.suggestion.boxes).toEqual([]);
  });

  it('omits the packing section when the PACKING_OPTIMIZER flag is off (flag-less shape)', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    seedSourcingTaxRules(db);
    const app = eventCalcApp();
    const env = eventCalcEnv(d1); // permissive env leaves PACKING_OPTIMIZER unset

    const res = await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }], { packing: true }));
    const body = (await res.json()) as V2Json;
    expect(body.plan).toBeDefined();
    expect(body.packing).toBeUndefined();
  });

  it('omits the packing section when not opted in', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    seedSourcingTaxRules(db);
    seedBoxType(db);
    const app = eventCalcApp();
    const env = eventCalcEnv(d1, { FF_PACKING_OPTIMIZER: 'true' });

    const res = await postV2(app, env, sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }]));
    const body = (await res.json()) as V2Json;
    expect(body.packing).toBeUndefined();
  });
});

describe('POST /api/v1/event-calc — V2 validation', () => {
  it.each([
    ['unknown country', sourcingBeer(500, [{ country: 'US', pricePerLitreCents: 200 }])],
    ['duplicate line drink type', {
      lines: [
        { drinkType: 'beer', abvPercent: 4.7, container: 'can', domesticPricePerLitreCents: 500 },
        { drinkType: 'beer', abvPercent: 5.0, container: 'can', domesticPricePerLitreCents: 400 },
      ],
    }],
    ['duplicate foreign country', sourcingBeer(500, [
      { country: 'EE', pricePerLitreCents: 200 },
      { country: 'EE', pricePerLitreCents: 210 },
    ])],
    ['zero budget', sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 200 }], { budgetCents: 0 })],
    ['zero abv', sourcingBeer(0, [])],
    ['zero foreign price', sourcingBeer(500, [{ country: 'EE', pricePerLitreCents: 0 }])],
    ['empty lines', { lines: [] }],
  ])('rejects %s with 400', async (_name, sourcing) => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    seedSourcingTaxRules(db);
    const app = eventCalcApp();
    const res = await postV2(app, eventCalcEnv(d1), sourcing);
    await expectEnvelope(res, 400, { error: 'ValidationError' });
  });

  it('keeps the MVP response byte-compatible — no plan key without the sourcing section', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedNorm(d1);
    const app = eventCalcApp();
    const res = await postEvent(app, eventCalcEnv(d1));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('COMPUTED');
    expect('plan' in body).toBe(false);
    expect('packing' in body).toBe(false);
  });
});
