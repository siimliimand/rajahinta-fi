/**
 * Trip-feasibility route tests (task 5.3, change
 * product-roadmap-phases-1-4) over the FULL app composition
 * (createApp() + registerTripFeasibilityRoutes — the exact composition
 * index.ts wires, flag gate + rate limit on the route itself) on the
 * fake-D1 harness.
 *
 * Pinning here: the validation contract (positive costs, known vehicle
 * types, ISO date, per-category prices, duplicate rejection), flag-off
 * 403 (TRIP_CALCULATOR, alerts/event-calc 403 envelope shape), the
 * per-IP CALCULATOR rate-limit profile (10/min → 429 on the 11th), the
 * 409 when no published allowance version covers the travel date, the
 * STRUCTURAL indicative-limits disclaimer on every result,
 * version-aware idempotency — and the AFFILIATE-NEUTRALITY architecture
 * (binding, design R8): the calculation output is byte-identical with
 * zero, one, and many ferry rows, the raw offer url never appears in a
 * public payload, and the block is read fresh even on a cache HIT.
 *
 * The audited operator-console CRUD for ferry offers and the outbound
 * ferry redirect are exercised here too (they share the app
 * composition and the same curated table).
 *
 * @module TripFeasibilityRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  FAKE_OPS_TOKEN,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
} from './harness';
import { registerTripFeasibilityRoutes } from '../trip-feasibility.routes';
import { D1TravellerAllowancesRepository } from '../../../../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';
import { D1FerryOffersRepository } from '../../../../../packages/data-platform/src/repositories/d1/ferry-offers.repository';
import { D1AuditEventRepository } from '../../../../../packages/data-platform/src/repositories/d1/audit-event.repository';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers the trip handler behind its route-level gate+
 * limiter (same slot as the other route ports); the test composition
 * mirrors that exactly.
 */
function tripApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerTripFeasibilityRoutes(app);
  return app;
}

function tripEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, { ...overrides, FF_TRIP_CALCULATOR: 'true' });
}

const OPS = { authorization: `Bearer ${FAKE_OPS_TOKEN}` };
const OPS_JSON = { 'content-type': 'application/json', ...OPS };

const CITATION =
  'Commission Directive 2007/74/EC, Annex (https://eur-lex.europa.example/32007L0074)';

/** Append one allowance version and publish it — the only PUBLISHED path. */
async function seedPublishedAllowances(d1: D1DatabaseLike): Promise<number> {
  const repo = new D1TravellerAllowancesRepository(d1);
  const version = await repo.createPendingVersion(
    {
      versionLabel: 'allowances-trip-2026.1',
      sourceCitation: CITATION,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
    [
      { category: 'beer', volumeCapLitres: 110, quantityCap: null, sourceCitation: CITATION, effectiveFrom: '2026-01-01', effectiveTo: null },
      { category: 'wine_still', volumeCapLitres: 90, quantityCap: null, sourceCitation: CITATION, effectiveFrom: '2026-01-01', effectiveTo: null },
      { category: 'spirits', volumeCapLitres: 10, quantityCap: null, sourceCitation: CITATION, effectiveFrom: '2026-01-01', effectiveTo: null },
    ],
  );
  const published = await repo.publish(version.dataset.id, 'ops-test');
  expect(published).not.toBeNull();
  return version.dataset.id;
}

const TRIP = {
  travelDate: '2026-06-01',
  vehicleType: 'car',
  passengers: 2,
  ticketCostCents: 20_000,
  fuelCostCents: 6_000,
  prices: [
    {
      category: 'beer',
      domesticPriceCentsPerLitre: 300,
      foreignPriceCentsPerLitre: 200,
    },
  ],
};

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

interface TripLineJson {
  status: string;
  category: string;
  priceDifferenceCentsPerLitre: number;
  breakEvenLitres?: number;
  capLitres?: number | null;
  capStatus?: string;
  cappedBreakEvenLitres?: number | null;
}

interface TripJson {
  status: string;
  allowanceDatasetVersion?: string;
  travelCostCents?: number;
  travelCostPerTravellerCents?: number;
  lines?: TripLineJson[];
  disclaimer?: { text: string; language: string; version: string };
  ferryOffers?: {
    id: number;
    operator: string;
    routeLabel: string;
    redirectPath: string;
  }[];
}

async function postTrip(
  app: ReturnType<typeof buildApp>,
  env: Env,
  body: unknown = TRIP,
): Promise<Response> {
  return request(app, env, '/api/v1/trip-feasibility', jsonInit(body));
}

/** Seed one published ferry offer directly and return its id. */
async function seedPublishedFerry(
  d1: D1DatabaseLike,
  overrides: Partial<{ operator: string; routeLabel: string; url: string }> = {},
): Promise<number> {
  const repo = new D1FerryOffersRepository(d1);
  const created = await repo.create({
    operator: overrides.operator ?? 'Viking Line',
    routeLabel: overrides.routeLabel ?? 'Helsinki–Tallinn',
    url: overrides.url ?? 'https://www.vikingline.example/minifarty',
  });
  const published = await repo.publish(created.id);
  expect(published).not.toBeNull();
  return created.id;
}

// ---------------------------------------------------------------------------
// Gate: flag-off 403 (TRIP_CALCULATOR)
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip-feasibility — gate', () => {
  it('rejects with 403 while TRIP_CALCULATOR is off (alerts/event-calc 403 shape)', async () => {
    const { d1 } = openMigratedD1();
    const app = tripApp();
    const res = await postTrip(app, lockedEnv(d1));
    await expectEnvelope(res, 403, {
      message: 'Feature "TRIP_CALCULATOR" is not enabled',
    });
  });
});

// ---------------------------------------------------------------------------
// Validation — positive costs, known vehicle types, shapes
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip-feasibility — validation', () => {
  it.each([0, -5, 0.5, 10_000_001])('rejects ticketCostCents=%s with 400', async (ticketCostCents) => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    await expectEnvelope(
      await postTrip(app, tripEnv(d1), { ...TRIP, ticketCostCents }),
      400,
      { error: 'ValidationError' },
    );
  });

  it.each([0, -1, 2.5])('rejects fuelCostCents=%s with 400', async (fuelCostCents) => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    await expectEnvelope(
      await postTrip(app, tripEnv(d1), { ...TRIP, fuelCostCents }),
      400,
      { error: 'ValidationError' },
    );
  });

  it('rejects an unknown vehicle type, a non-ISO date, unknown/duplicate categories and bad passenger counts with 400', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    const env = tripEnv(d1);

    await expectEnvelope(
      await postTrip(app, env, { ...TRIP, vehicleType: 'truck' }),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postTrip(app, env, { ...TRIP, travelDate: '2026/06/01' }),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postTrip(app, env, { ...TRIP, passengers: 0 }),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postTrip(app, env, { ...TRIP, passengers: 10 }),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postTrip(app, env, {
        ...TRIP,
        prices: [
          {
            category: 'mead',
            domesticPriceCentsPerLitre: 300,
            foreignPriceCentsPerLitre: 200,
          },
        ],
      }),
      400,
      { error: 'ValidationError' },
    );
    await expectEnvelope(
      await postTrip(app, env, {
        ...TRIP,
        prices: [
          { category: 'beer', domesticPriceCentsPerLitre: 300, foreignPriceCentsPerLitre: 200 },
          { category: 'beer', domesticPriceCentsPerLitre: 310, foreignPriceCentsPerLitre: 210 },
        ],
      }),
      400,
      { error: 'ValidationError' },
    );
  });

  it('accepts the van-seat boundary (passengers=9) as valid input', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    const res = await postTrip(app, tripEnv(d1), { ...TRIP, passengers: 9 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TripJson;
    // 26 000 ¢ ÷ 9 travellers = 2 889 ¢ (half-up).
    expect(body.travelCostPerTravellerCents).toBe(2_889);
  });
});

// ---------------------------------------------------------------------------
// Allowance resolution — no published dataset covering the date
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip-feasibility — allowance resolution', () => {
  it('rejects with 409 NoPublishedAllowances when nothing was ever published', async () => {
    const { d1 } = openMigratedD1();
    const app = tripApp();
    const res = await postTrip(app, tripEnv(d1));
    await expectEnvelope(res, 409, { error: 'NoPublishedAllowances' });
  });

  it('treats PENDING_CONFIRMATION allowances as invisible and honours the effective window', async () => {
    const { d1 } = openMigratedD1();
    const repo = new D1TravellerAllowancesRepository(d1);
    // Pending version — never visible.
    await repo.createPendingVersion(
      {
        versionLabel: 'allowances-pending',
        sourceCitation: CITATION,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
      [{ category: 'beer', volumeCapLitres: 110, quantityCap: null, sourceCitation: CITATION, effectiveFrom: '2026-01-01', effectiveTo: null }],
    );
    // Published but only from July — before the window the trip is uncovered.
    const later = await repo.createPendingVersion(
      {
        versionLabel: 'allowances-july',
        sourceCitation: CITATION,
        effectiveFrom: '2026-07-01',
        effectiveTo: null,
      },
      [{ category: 'beer', volumeCapLitres: 110, quantityCap: null, sourceCitation: CITATION, effectiveFrom: '2026-07-01', effectiveTo: null }],
    );
    await repo.publish(later.dataset.id, 'ops-test');

    const app = tripApp();
    const env = tripEnv(d1);
    await expectEnvelope(await postTrip(app, env), 409, {
      error: 'NoPublishedAllowances',
    });

    // Inside the window (or past it, open-ended) the version resolves.
    const inside = await postTrip(app, env, { ...TRIP, travelDate: '2026-07-15' });
    expect(inside.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Computed result — structural disclaimer + capping
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip-feasibility — computed result', () => {
  it('returns the capped break-even naming the dataset version, with the structural disclaimer', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    const res = await postTrip(app, tripEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TripJson;

    expect(body.status).toBe('COMPUTED');
    expect(body.allowanceDatasetVersion).toBe('allowances-trip-2026.1');
    // Derivation: 20 000 + 6 000 = 26 000 ¢; ÷2 travellers = 13 000 ¢.
    expect(body.travelCostCents).toBe(26_000);
    expect(body.travelCostPerTravellerCents).toBe(13_000);

    expect(body.lines).toHaveLength(1);
    const line = body.lines![0]!;
    expect(line.status).toBe('BREAK_EVEN');
    // Diff 100 ¢/l ⇒ 13 000 ¢ ÷ 100 = 130 l; the 110 l beer cap applies.
    expect(line.breakEvenLitres).toBe(130);
    expect(line.capStatus).toBe('CAPPED');
    expect(line.capLitres).toBe(110);
    expect(line.cappedBreakEvenLitres).toBe(110);

    // Structural field, not a UI string: same { text, language, version }
    // keys the disclaimer module declares; 5.4 renders from THIS field.
    expect(body.disclaimer).toEqual({
      text: expect.stringContaining('indicative'),
      language: 'en',
      version: '1.0',
    });

    // The separate block exists even with zero ferry rows — empty, present.
    expect(body.ferryOffers).toEqual([]);
  });

  it('passes the module line states through as values (NO_BREAK_EVEN is not an error)', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    const res = await postTrip(app, tripEnv(d1), {
      ...TRIP,
      prices: [
        {
          category: 'spirits',
          domesticPriceCentsPerLitre: 800,
          foreignPriceCentsPerLitre: 850,
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TripJson;
    expect(body.lines![0]!.status).toBe('NO_BREAK_EVEN');
    expect(body.lines![0]!.priceDifferenceCentsPerLitre).toBe(-50);
    expect(body.lines![0]!.breakEvenLitres).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Affiliate neutrality — the ferry block is a separate data path (R8)
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip-feasibility — ferry block independence', () => {
  it('keeps the calculation BYTE-IDENTICAL with zero, one, and many ferry rows; never leaks the raw url', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    const env = tripEnv(d1);

    const calcProjection = (body: TripJson): Omit<TripJson, 'ferryOffers'> => {
      const { ferryOffers: _ferry, ...calc } = body;
      return calc;
    };

    // Zero rows.
    const empty = await postTrip(app, env);
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as TripJson;
    expect(emptyBody.ferryOffers).toEqual([]);
    const emptyCalc = JSON.stringify(calcProjection(emptyBody));

    // One row — calculation bytes unchanged, block appears, raw url absent.
    await seedPublishedFerry(d1);
    const one = await postTrip(app, env);
    const oneBody = (await one.json()) as TripJson;
    expect(JSON.stringify(calcProjection(oneBody))).toBe(emptyCalc);
    expect(oneBody.ferryOffers).toHaveLength(1);
    expect(oneBody.ferryOffers![0]).toEqual({
      id: expect.any(Number),
      operator: 'Viking Line',
      routeLabel: 'Helsinki–Tallinn',
      redirectPath: `/api/v1/outbound/ferry/${oneBody.ferryOffers![0]!.id}`,
    });
    expect(JSON.stringify(oneBody)).not.toContain('vikingline.example');

    // Many rows — same calculation bytes, block grows in curation order.
    await seedPublishedFerry(d1, {
      operator: 'Eckerö Line',
      routeLabel: 'Helsinki–Tallinn',
      url: 'https://www.eckero.example/mini',
    });
    await seedPublishedFerry(d1, {
      operator: 'Viking Line',
      routeLabel: 'Turku–Stockholm',
      url: 'https://www.vikingline.example/amorella',
    });
    const many = await postTrip(app, env);
    const manyBody = (await many.json()) as TripJson;
    expect(JSON.stringify(calcProjection(manyBody))).toBe(emptyCalc);
    expect(manyBody.ferryOffers!.map((o) => o.operator)).toEqual([
      'Eckerö Line',
      'Viking Line',
      'Viking Line',
    ]);
    expect(JSON.stringify(manyBody)).not.toContain('eckero.example');
  });

  it('reads the ferry block fresh on a cache HIT — offers can change under a cached calculation', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    await seedPublishedFerry(d1);
    const app = tripApp();
    const env = tripEnv(d1);

    const first = await postTrip(app, env);
    expect(first.headers.get('X-Cache')).toBe('MISS');

    // An operator publishes a second offer AFTER the calculation cached.
    await seedPublishedFerry(d1, {
      operator: 'Eckerö Line',
      routeLabel: 'Helsinki–Tallinn',
      url: 'https://www.eckero.example/mini',
    });
    const repeat = await postTrip(app, env);
    expect(repeat.headers.get('X-Cache')).toBe('HIT');
    const repeatBody = (await repeat.json()) as TripJson;
    expect(repeatBody.ferryOffers).toHaveLength(2);
    // The calculation half is still the cached one (same allowance version).
    expect(repeatBody.allowanceDatasetVersion).toBe('allowances-trip-2026.1');
  });
});

// ---------------------------------------------------------------------------
// Version-aware idempotency
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip-feasibility — version-aware idempotency', () => {
  it('serves a byte-identical repeat (X-Cache HIT) and a fresh result after an allowance bump', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    const env = tripEnv(d1);

    const first = await postTrip(app, env);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    const firstBody = (await first.json()) as TripJson;
    const firstHash = first.headers.get('X-Content-Hash');
    expect(firstHash).not.toBeNull();

    const repeat = await postTrip(app, env);
    expect(repeat.headers.get('X-Cache')).toBe('HIT');
    expect(repeat.headers.get('X-Content-Hash')).toBe(firstHash);
    expect(await repeat.json()).toEqual(firstBody);

    // A NEWER version published effective on the same date changes the
    // resolved dataset version → fresh result, not a stale HIT.
    const repo = new D1TravellerAllowancesRepository(d1);
    const newer = await repo.createPendingVersion(
      {
        versionLabel: 'allowances-trip-2026.2',
        sourceCitation: CITATION,
        effectiveFrom: '2026-02-01',
        effectiveTo: null,
      },
      [{ category: 'beer', volumeCapLitres: 100, quantityCap: null, sourceCitation: CITATION, effectiveFrom: '2026-02-01', effectiveTo: null }],
    );
    await repo.publish(newer.dataset.id, 'ops-test');

    const afterBump = await postTrip(app, env);
    expect(afterBump.headers.get('X-Cache')).toBe('MISS');
    const bumpBody = (await afterBump.json()) as TripJson;
    expect(bumpBody.allowanceDatasetVersion).toBe('allowances-trip-2026.2');
    expect(bumpBody.lines![0]!.capLitres).toBe(100);
    expect(bumpBody.lines![0]!.cappedBreakEvenLitres).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting — the per-IP CALCULATOR profile (10/min)
// ---------------------------------------------------------------------------

describe('POST /api/v1/trip-feasibility — rate-limit profile', () => {
  it('admits ten requests per minute per IP (CALCULATOR) and rejects the eleventh with 429', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    const env = tripEnv(d1); // one shared env = one shared DO limiter bucket

    for (let i = 0; i < 10; i++) {
      // Distinct payloads so idempotency never short-circuits the limiter's
      // admission path (the limiter runs FIRST either way — that is the pin).
      const res = await postTrip(app, env, {
        ...TRIP,
        ticketCostCents: 20_000 + i,
      });
      expect(res.status).toBe(200);
    }

    const eleventh = await postTrip(app, env, { ...TRIP, ticketCostCents: 20_099 });
    await expectEnvelope(eleventh, 429, { error: 'TooManyRequests' });
    expect(eleventh.headers.get('Retry-After')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Outbound redirect — the ferry block's only public url reader (R8)
// ---------------------------------------------------------------------------

describe('GET /api/v1/outbound/ferry/:offerId', () => {
  it('302s to the stored url through the redirect controller and 404s unknown ids', async () => {
    const { d1 } = openMigratedD1();
    const id = await seedPublishedFerry(d1, {
      url: 'https://www.vikingline.example/minifarty?ref=affiliate',
    });
    const app = tripApp();

    const res = await request(app, tripEnv(d1), `/api/v1/outbound/ferry/${id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://www.vikingline.example/minifarty?ref=affiliate',
    );

    const unknown = await request(app, tripEnv(d1), '/api/v1/outbound/ferry/999999');
    await expectEnvelope(unknown, 404, {});
  });

  it('never serves a DRAFT offer — neither in the trip block nor on the redirect (no url leak)', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const repo = new D1FerryOffersRepository(d1);
    const draft = await repo.create({
      operator: 'Finnlines',
      routeLabel: 'Helsinki–Travemünde',
      url: 'https://www.finnlines.example/star',
    });
    const app = tripApp();

    const redirect = await request(app, tripEnv(d1), `/api/v1/outbound/ferry/${draft.id}`);
    expect(redirect.status).toBe(404);

    const trip = await postTrip(app, tripEnv(d1));
    expect((((await trip.json()) as TripJson).ferryOffers) ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Operator console — audited ferry-offer CRUD (R8)
// ---------------------------------------------------------------------------

describe('/ops/console/ferry-offers — audited CRUD', () => {
  const OFFER = {
    operator: 'ops@example.invalid',
    ferryOperator: 'Viking Line',
    routeLabel: 'Helsinki–Tallinn',
    url: 'https://www.vikingline.example/minifarty',
  };

  interface FerryAudit {
    entityType: string;
    entityId: string;
    action: string;
    author: string;
  }

  async function auditRows(d1: D1DatabaseLike): Promise<FerryAudit[]> {
    const entries = await new D1AuditEventRepository(d1).query({
      entityType: 'ferry_offer',
    });
    return entries.map((entry) => ({
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      author: entry.author,
    }));
  }

  /**
   * Audit actions of one entity, compared ORDER-INSENSITIVELY: the
   * repository orders newest-first by timestamp with a random-UUID
   * tie-break, so same-millisecond writes have no deterministic
   * sequence. WHICH actions were audited (and by whom) is the contract
   * pinned here; the ordering discipline belongs to the audit repo's
   * own suite.
   */
  async function auditActions(d1: D1DatabaseLike): Promise<string[]> {
    return (await auditRows(d1)).map((row) => row.action).sort();
  }

  it('creates a DRAFT, publishes it, and the offer then appears in the public trip block', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    const env = tripEnv(d1);

    const created = await request(app, env, '/ops/console/ferry-offers', {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify(OFFER),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { id: number; status: string };
    expect(createdBody.status).toBe('DRAFT');

    // Drafts are invisible to the public block…
    const before = await postTrip(app, env);
    expect((((await before.json()) as TripJson).ferryOffers) ?? []).toEqual([]);

    // …then the audited publish makes it public.
    const published = await request(
      app,
      env,
      `/ops/console/ferry-offers/${createdBody.id}/publish`,
      { method: 'POST', headers: OPS_JSON, body: JSON.stringify({ operator: 'ops@example.invalid' }) },
    );
    expect(published.status).toBe(200);

    const after = await postTrip(app, env);
    const afterBody = (await after.json()) as TripJson;
    expect(afterBody.ferryOffers).toHaveLength(1);
    expect(afterBody.ferryOffers![0]!.operator).toBe('Viking Line');

    const rows = await auditRows(d1);
    expect(rows.map((row) => row.action).sort()).toEqual(['confirmed', 'created']);
    for (const row of rows) {
      expect(row.entityType).toBe('ferry_offer');
      expect(row.entityId).toBe(String(createdBody.id));
      expect(row.author).toBe('ops@example.invalid');
    }
  });

  it('updates a DRAFT offer, refuses to update a PUBLISHED one (409), and audits the edit', async () => {
    const { d1 } = openMigratedD1();
    const app = tripApp();
    const env = tripEnv(d1);

    const created = await request(app, env, '/ops/console/ferry-offers', {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify(OFFER),
    });
    const { id } = (await created.json()) as { id: number };

    const updated = await request(app, env, `/ops/console/ferry-offers/${id}`, {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify({
        operator: 'ops@example.invalid',
        routeLabel: 'Helsinki–Tallinn (Star)',
      }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { routeLabel: string }).routeLabel).toBe(
      'Helsinki–Tallinn (Star)',
    );

    await request(app, env, `/ops/console/ferry-offers/${id}/publish`, {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify({ operator: 'ops@example.invalid' }),
    });
    const immutable = await request(app, env, `/ops/console/ferry-offers/${id}`, {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify({ operator: 'ops@example.invalid', url: 'https://x.example/v2' }),
    });
    await expectEnvelope(immutable, 409, { error: 'ImmutablePublishedOffer' });

    expect(await auditActions(d1)).toEqual(['confirmed', 'created', 'updated']);
  });

  it('deletes with a mandatory reason, removes the offer from the public block, and audits the deletion', async () => {
    const { d1 } = openMigratedD1();
    const app = tripApp();
    const env = tripEnv(d1);

    const created = await request(app, env, '/ops/console/ferry-offers', {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify(OFFER),
    });
    const { id } = (await created.json()) as { id: number };
    await request(app, env, `/ops/console/ferry-offers/${id}/publish`, {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify({ operator: 'ops@example.invalid' }),
    });

    // Reason mandatory.
    const noReason = await request(app, env, `/ops/console/ferry-offers/${id}/delete`, {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify({ operator: 'ops@example.invalid' }),
    });
    expect(noReason.status).toBe(400);

    const removed = await request(app, env, `/ops/console/ferry-offers/${id}/delete`, {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify({
        operator: 'ops@example.invalid',
        reason: 'campaign ended',
      }),
    });
    expect(removed.status).toBe(200);

    const trip = await postTrip(app, env);
    expect((((await trip.json()) as TripJson).ferryOffers) ?? []).toEqual([]);

    expect(await auditActions(d1)).toEqual(['confirmed', 'created', 'deleted']);
  });

  it('validates offer content (bad url) and the acting operator with 400', async () => {
    const { d1 } = openMigratedD1();
    const app = tripApp();
    const env = tripEnv(d1);

    const badUrl = await request(app, env, '/ops/console/ferry-offers', {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify({ ...OFFER, url: 'ftp://www.vikingline.example' }),
    });
    expect(badUrl.status).toBe(400);

    const noActor = await request(app, env, '/ops/console/ferry-offers', {
      method: 'POST',
      headers: OPS_JSON,
      body: JSON.stringify({ ...OFFER, operator: '' }),
    });
    expect(noActor.status).toBe(400);
  });
});
