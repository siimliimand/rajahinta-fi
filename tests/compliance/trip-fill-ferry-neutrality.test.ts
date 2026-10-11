/**
 * Compliance test: trip-fill ferry neutrality (task 9.1, change
 * trust-and-reach-roadmap; spec allowance-fill-planner — "Ferry offers
 * SHALL NOT participate in the fill computation, and the fill result
 * SHALL be byte-identical whether zero, one, or many ferry-offer rows
 * exist"; scenario "Ferry section isolated" — the basket selection and
 * all computed figures identical, ferry offers confined to their
 * separate display section).
 *
 * The compliance-layer second opinion on the task-8.2 route suite
 * (apps/api-worker/src/routes/__tests__/trip.routes.test.ts), built on
 * the trip-affiliate-neutrality.test.ts (task 5.5) pattern. What this
 * file adds over the route suite's zero-MISS-then-HIT shape:
 *
 * 1. **Byte-identity across database states, fresh compute each** — the
 *    IDENTICAL fill request is fired against three fully separate
 *    compositions (migrated D1 + full app + registerTripRoutes, exactly
 *    as the task-8.2 suite composes it), with 0 / 1 / 3 PUBLISHED
 *    ferry_offers rows. Each run answers as a cache MISS, so the fill
 *    computation itself is observed — the idempotency cache cannot mask
 *    a difference. Non-vacuity: the ferry block itself must vary with
 *    the row count.
 * 2. **Cache-path identity on ONE composition** — ferry rows appear
 *    between two identical requests; the second answer is a HIT whose
 *    fill bytes AND canonical X-Content-Hash are unchanged while the
 *    freshly-read ferry block reflects the new rows — the cache stores
 *    only the fill, the block is joined outside it.
 * 3. **Block shape pin** — the display section exposes exactly
 *    {id, operator, routeLabel, redirectPath}; the raw affiliate url
 *    never crosses into the payload (allowance-fill-planner +
 *    trip-affiliate R8 parity).
 *
 * Ferry-price extension (task 3.2, change ferry-onboard-prices): the
 * same machinery driven for `ferryPrices` — the observed onboard-price
 * block the same envelope attaches beside `ferryOffers` (3.1), and now
 * stripped by the byte proxy alongside it. Sections 3–5 fire the
 * IDENTICAL fill request across 0 / 1 / 3 `ferry_price_observations`
 * rows on separate fresh-compute compositions (real curated rows:
 * tallink/eckero operator keys, Helsinki–Tallinn, cited product-page
 * urls), prove the superseding-revision collapse (append-only history →
 * the latest revision per (operator, route, label)) leaves the fill
 * bytes byte-stable, and pin the honest empty state — the absent-data
 * table renders a present `ferryPrices: []`, never an absent key —
 * plus the cache-path identity (unchanged fill bytes AND hash) when
 * rows appear between two identical requests.
 *
 * Byte-proxy decision: `JSON.stringify` of the fill projection — the
 * response minus the separate `ferryOffers` block, with the fill
 * engine's `metadata.calculationTimestamp` normalized away. That stamp
 * is compute-time metadata (like the reliability embed's computedAt the
 * task-2.2 suite normalizes), not a calculated figure; section 2 pins
 * the FULL bytes including the stamp when the same computation is
 * re-served from the cache. Every seed uses fixed instants, so no other
 * volatility exists between compositions.
 *
 * @module TripFillFerryNeutralityComplianceTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import {
  buildApp,
  issueSessionToken,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedOffer,
  seedProduct,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { registerTripRoutes } from '../../apps/api-worker/src/routes/trip.routes';
import { D1TravellerAllowancesRepository } from '../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';
import { D1FerryOffersRepository } from '../../packages/data-platform/src/repositories/d1/ferry-offers.repository';
import { D1FerryPriceRepository } from '../../packages/data-platform/src/repositories/d1/ferry-price.repository';
import type { Env } from '../../apps/api-worker/src/env';
import type { D1DatabaseLike } from '../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fixtures — identical request and seeds in every run
// ---------------------------------------------------------------------------

const CITATION =
  'Commission Directive 2007/74/EC, Annex (https://eur-lex.europa.example/32007L0074)';

/** The ONE fill request fired unchanged in every scenario. */
const FILL = {
  travelDate: '2026-06-01',
  items: [
    { productId: 1, maxQuantity: 10 },
    { productId: 2, maxQuantity: 10 },
  ],
};

/** Two boundable half-litre lines with offers (task-8.2 fixture parity). */
function seedFillProducts(db: DatabaseSync): void {
  seedProduct(db, {
    id: 1,
    name: 'Karhu III 0,5 l',
    category: 'beer',
    regulatoryClassification: 'beer',
    unitVolume: 0.5,
  });
  seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 250 });
  seedOffer(db, { id: 12, productId: 1, merchant: 's-market', priceCents: 300 });
  seedProduct(db, {
    id: 2,
    name: 'Koskenkorva 0,5 l',
    category: 'spirits',
    regulatoryClassification: 'spirits',
    unitVolume: 0.5,
  });
  seedOffer(db, { id: 21, productId: 2, merchant: 'alko', priceCents: 1000 });
}

/** Append one allowance version and publish it — the only PUBLISHED path. */
async function seedPublishedFillAllowances(d1: D1DatabaseLike): Promise<void> {
  const repo = new D1TravellerAllowancesRepository(d1);
  const version = await repo.createPendingVersion(
    {
      versionLabel: 'allowances-fill-2026.1',
      sourceCitation: CITATION,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
    [
      { category: 'beer', volumeCapLitres: 1, quantityCap: 3, sourceCitation: CITATION, effectiveFrom: '2026-01-01', effectiveTo: null },
      { category: 'spirits', volumeCapLitres: 2, quantityCap: 4, sourceCitation: CITATION, effectiveFrom: '2026-01-01', effectiveTo: null },
    ],
  );
  const published = await repo.publish(version.dataset.id, 'ops-compliance');
  expect(published).not.toBeNull();
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

/**
 * Seed one curated observation through the repository's upsert (the
 * monthly refresh cron's write path) — defaults are a real task-2.2
 * dataset row (tallink operator key, Helsinki–Tallinn, cited
 * product-page url, fixed instant).
 */
async function seedObservation(
  d1: D1DatabaseLike,
  overrides: Partial<{
    operator: string;
    route: string;
    label: string;
    priceCents: number;
    observedAt: Date;
    citation: string;
  }> = {},
): Promise<void> {
  await new D1FerryPriceRepository(d1).upsertObservation({
    operator: overrides.operator ?? 'tallink',
    route: overrides.route ?? 'Helsinki–Tallinn',
    label: overrides.label ?? 'Finlandia Redberry 100 cl',
    priceCents: overrides.priceCents ?? 3962,
    observedAt: overrides.observedAt ?? new Date('2026-10-01T00:00:00.000Z'),
    citation:
      overrides.citation ??
      'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/finlandia-redberry-100-cl-5203396, accessed 2026-10-01',
  });
}

/** Session for the fill guard chain (every tier is FREE today). */
async function seedFreeSession(
  d1: D1DatabaseLike,
  db: DatabaseSync,
): Promise<string> {
  seedAccount(db, {
    id: 1,
    userId: 'user-fill-compliance',
    email: 'fill-compliance@example.invalid',
    tier: 'FREE',
  });
  return issueSessionToken(d1, 1);
}

/**
 * Full production composition (index.ts wiring; the task-8.2 suite's
 * fillApp parity — buildApp composes the guards, the registration the
 * handler).
 */
function fillApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerTripRoutes(app);
  return app;
}

async function postFill(
  app: ReturnType<typeof buildApp>,
  env: Env,
  token: string,
): Promise<Response> {
  return request(app, env, '/api/v1/trip/fill', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `rajahinta_session=${token}`,
    },
    body: JSON.stringify(FILL),
  });
}

// ---------------------------------------------------------------------------
// Response projection — the byte proxy
// ---------------------------------------------------------------------------

interface FerryRefJson {
  id: number;
  operator: string;
  routeLabel: string;
  redirectPath: string;
}

/** One observed onboard price row — the block's full curated provenance. */
interface FerryPriceRowJson {
  operator: string;
  route: string;
  label: string;
  priceCents: number;
  observedAt: string;
  citation: string;
}

interface FillJson {
  status: string;
  ferryOffers?: FerryRefJson[];
  ferryPrices?: FerryPriceRowJson[];
  metadata?: { input?: unknown; calculationTimestamp?: string };
  [key: string]: unknown;
}

/**
 * The fill bytes: the response minus the separate ferry blocks
 * (`ferryOffers` and, beside it, `ferryPrices` — 3.1), with the
 * compute-time stamp normalized to a fixed sentinel (see the byte-proxy
 * decision in the module docs).
 */
function fillBytes(body: FillJson): string {
  const {
    ferryOffers: _ferry,
    ferryPrices: _prices,
    metadata,
    ...fill
  } = body;
  const stamp = metadata?.calculationTimestamp;
  const normalized = {
    ...fill,
    ...(metadata !== undefined
      ? {
          metadata: {
            ...metadata,
            ...(stamp !== undefined ? { calculationTimestamp: '<COMPUTE-TIME>' } : {}),
          },
        }
      : {}),
  };
  return JSON.stringify(normalized);
}

// ===========================================================================
// 1. Fill bytes vs ferry-row count — fresh compute per composition
//    (spec: "byte-identical whether zero, one, or many ferry-offer rows")
// ===========================================================================

describe('fill output vs ferry-row count (fresh compute per composition)', () => {
  it('is byte-identical with zero, one, and three PUBLISHED ferry rows while the ferry block itself varies', async () => {
    const runs: {
      ferryCount: number;
      bytes: string;
      body: FillJson;
      cache: string | null;
      hash: string | null;
    }[] = [];

    for (const ferryCount of [0, 1, 3]) {
      // A fully separate composition per database state: own migrated
      // D1, own session, own app, own DO namespaces — the request is
      // answered by a FRESH computation (MISS), never a cache lookup.
      const { db, d1 } = openMigratedD1();
      await seedPublishedFillAllowances(d1);
      seedFillProducts(db);
      const token = await seedFreeSession(d1, db);
      for (let i = 0; i < ferryCount; i++) {
        await seedPublishedFerry(d1, {
          operator: `Operator ${i}`,
          url: `https://www.operator${i}.example/route`,
        });
      }

      const res = await postFill(fillApp(), permissiveEnv(d1), token);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Cache')).toBe('MISS');
      const body = (await res.json()) as FillJson;
      runs.push({
        ferryCount,
        bytes: fillBytes(body),
        body,
        cache: res.headers.get('X-Cache'),
        hash: res.headers.get('X-Content-Hash'),
      });
    }

    const [zero, one, many] = runs;

    // The fill bytes are identical across all three database states.
    expect(one.bytes).toBe(zero.bytes);
    expect(many.bytes).toBe(zero.bytes);

    // Non-vacuity: the ferry block itself varies with the row count —
    // the scenarios are genuinely different database states, and the
    // block (not the fill) is what moved.
    for (const run of runs) {
      expect(run.body.ferryOffers).toHaveLength(run.ferryCount);
      expect(run.hash).not.toBeNull();
    }
    expect(one.body.ferryOffers).toHaveLength(1);
    expect(many.body.ferryOffers!.map((o) => o.operator)).toEqual([
      'Operator 0',
      'Operator 1',
      'Operator 2',
    ]);
    expect(JSON.stringify(zero.body)).not.toBe(JSON.stringify(one.body));
    expect(JSON.stringify(one.body)).not.toBe(JSON.stringify(many.body));

    // The block exposes redirect paths only — no raw affiliate url ever
    // crosses into the public payload, and the fill never grew a key.
    for (const run of runs) {
      const raw = JSON.stringify(run.body);
      expect(raw).not.toContain('.example/route');
      expect(raw).not.toContain('vikingline.example');
      for (const offer of run.body.ferryOffers ?? []) {
        expect(Object.keys(offer).sort()).toEqual([
          'id',
          'operator',
          'redirectPath',
          'routeLabel',
        ]);
        expect(offer.redirectPath).toBe(`/api/v1/outbound/ferry/${offer.id}`);
      }
    }
  });
});

// ===========================================================================
// 2. Ferry rows appear on ONE composition — cache HIT keeps the fill
//    bytes AND the canonical hash identical; the block is read fresh
// ===========================================================================

describe('ferry rows appear between two identical fill requests (one composition)', () => {
  it('serves the cached fill byte-identically (same X-Content-Hash) while the fresh block reflects the new rows', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    seedFillProducts(db);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const env = permissiveEnv(d1);

    // Empty ferry table — the MISS pins the full fill bytes + hash.
    const empty = await postFill(app, env, token);
    expect(empty.status).toBe(200);
    expect(empty.headers.get('X-Cache')).toBe('MISS');
    const emptyBody = (await empty.json()) as FillJson;
    expect(emptyBody.ferryOffers).toEqual([]);
    const emptyHash = empty.headers.get('X-Content-Hash');
    expect(emptyHash).not.toBeNull();

    // The ferry table goes empty → seeded BETWEEN two IDENTICAL requests.
    await seedPublishedFerry(d1, {
      operator: 'Eckerö Line',
      url: 'https://www.eckero.example/mini',
    });
    await seedPublishedFerry(d1, {
      operator: 'Viking Line',
      routeLabel: 'Turku–Stockholm',
      url: 'https://www.vikingline.example/amorella',
    });

    const seeded = await postFill(app, env, token);
    expect(seeded.status).toBe(200);
    expect(seeded.headers.get('X-Cache')).toBe('HIT');
    const seededBody = (await seeded.json()) as FillJson;

    // The fill half is untouched — same canonical hash, and the full
    // projection (ferry block stripped) is byte-identical down to the
    // cached compute-time stamp.
    expect(seeded.headers.get('X-Content-Hash')).toBe(emptyHash);
    expect(fillBytes(seededBody)).toBe(fillBytes(emptyBody));

    // Non-vacuity: the ferry block was read FRESH on the hit — it
    // changed under the identical cached fill, in curation order.
    expect(seededBody.ferryOffers).toHaveLength(2);
    expect(seededBody.ferryOffers!.map((o) => o.operator)).toEqual([
      'Eckerö Line',
      'Viking Line',
    ]);
    const raw = JSON.stringify(seededBody);
    expect(raw).not.toBe(JSON.stringify(emptyBody));
    expect(raw).not.toContain('eckero.example');
    expect(raw).not.toContain('vikingline.example');
  });
});

// ===========================================================================
// 3. Ferry-price extension (task 3.2, change ferry-onboard-prices):
//    fill bytes vs price-row count — fresh compute per composition
// ===========================================================================

/** Real curated rows (the task-2.2 dataset's shape), fixed instants. */
const PRICE_MANY_ROWS = [
  {
    operator: 'tallink',
    route: 'Helsinki–Tallinn',
    label: 'Finlandia Redberry 100 cl',
    priceCents: 3962,
    observedAt: new Date('2026-10-01T00:00:00.000Z'),
    citation:
      'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/finlandia-redberry-100-cl-5203396, accessed 2026-10-01',
  },
  {
    operator: 'eckero',
    route: 'Helsinki–Tallinn',
    label: 'Jaloviina Yrtti 30%, 3 x 50 cl',
    priceCents: 4170,
    observedAt: new Date('2026-10-01T00:00:00.000Z'),
    citation:
      'Eckerö Market pre-order shop, https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol/jaloviina-yrtti-3x50-cl, accessed 2026-10-01',
  },
  {
    operator: 'tallink',
    route: 'Helsinki–Tallinn',
    label: 'Johnnie Walker Red Label 100 cl',
    priceCents: 3590,
    observedAt: new Date('2026-10-01T00:00:00.000Z'),
    citation:
      'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/johnnie-walker-red-label-100-cl-21211, accessed 2026-10-01',
  },
];

describe('fill output vs ferry-price row count (fresh compute per composition)', () => {
  it('is byte-identical with zero, one, and three cited price rows while the observed-price block itself varies', async () => {
    const runs: {
      priceCount: number;
      bytes: string;
      body: FillJson;
      hash: string | null;
    }[] = [];

    for (const priceCount of [0, 1, 3]) {
      // A fully separate composition per database state: own migrated
      // D1, own session, own app, own DO namespaces — a FRESH fill
      // computation (MISS) every time; the cache cannot mask a diff.
      const { db, d1 } = openMigratedD1();
      await seedPublishedFillAllowances(d1);
      seedFillProducts(db);
      const token = await seedFreeSession(d1, db);
      for (const row of PRICE_MANY_ROWS.slice(0, priceCount)) {
        await seedObservation(d1, row);
      }

      const res = await postFill(fillApp(), permissiveEnv(d1), token);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Cache')).toBe('MISS');
      const body = (await res.json()) as FillJson;
      runs.push({
        priceCount,
        bytes: fillBytes(body),
        body,
        hash: res.headers.get('X-Content-Hash'),
      });
    }

    const [zero, one, many] = runs;

    // The fill bytes (stamp normalized) are identical across all three
    // database states.
    expect(one.bytes).toBe(zero.bytes);
    expect(many.bytes).toBe(zero.bytes);

    // Empty-state honesty (spec "absent data renders nothing" starts
    // at the API): the absent-data table renders a PRESENT, honestly
    // empty block — `ferryPrices: []`, never an absent key — carrying
    // exactly the seeded states' fill bytes.
    expect(zero.body).toHaveProperty('ferryPrices');
    expect(zero.body.ferryPrices).toEqual([]);

    // Non-vacuity: the price block itself varies with the row count —
    // genuinely different database states.
    for (const run of runs) {
      expect(run.hash).not.toBeNull();
    }
    expect(one.body.ferryPrices).toHaveLength(1);
    expect(many.body.ferryPrices).toHaveLength(3);
    expect(
      many.body
        .ferryPrices!
        .map((r) => `${r.operator}|${r.route}|${r.label}`),
    ).toEqual([
      'eckero|Helsinki–Tallinn|Jaloviina Yrtti 30%, 3 x 50 cl',
      'tallink|Helsinki–Tallinn|Finlandia Redberry 100 cl',
      'tallink|Helsinki–Tallinn|Johnnie Walker Red Label 100 cl',
    ]);
    expect(JSON.stringify(zero.body)).not.toBe(JSON.stringify(one.body));
    expect(JSON.stringify(one.body)).not.toBe(JSON.stringify(many.body));

    // Row shape pin: exactly the six documented provenance fields, and
    // observedAt is the stored instant's UTC calendar date.
    for (const row of one.body.ferryPrices!) {
      expect(Object.keys(row).sort()).toEqual([
        'citation',
        'label',
        'observedAt',
        'operator',
        'priceCents',
        'route',
      ]);
      expect(row.observedAt).toBe('2026-10-01');
    }
  });
});

// ===========================================================================
// 4. Superseding revision — append-only history of the SAME observation
//    identity collapses to the latest revision; the fill stays
//    byte-stable across the two database states
// ===========================================================================

describe('superseding revision of one observation identity (fresh compute per composition)', () => {
  it('keeps the fill bytes byte-stable while the block collapses to the latest revision only', async () => {
    // Same (operator, route, label), different observed_at — a later
    // transcription of the same onboard price.
    const revisions = [
      {
        operator: 'tallink',
        route: 'Helsinki–Tallinn',
        label: 'Finlandia Redberry 100 cl',
        priceCents: 3962,
        observedAt: new Date('2026-10-01T00:00:00.000Z'),
        citation:
          'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/finlandia-redberry-100-cl-5203396, accessed 2026-10-01',
      },
      {
        operator: 'tallink',
        route: 'Helsinki–Tallinn',
        label: 'Finlandia Redberry 100 cl',
        priceCents: 4050,
        observedAt: new Date('2026-10-08T00:00:00.000Z'),
        citation:
          'Tallink MyStar onboard shop, https://shopping-onboard.tallink.com/en/mystar/product/finlandia-redberry-100-cl-5203396, accessed 2026-10-08',
      },
    ];

    const runs: { bytes: string; body: FillJson }[] = [];
    for (const stored of [revisions.slice(0, 1), revisions]) {
      const { db, d1 } = openMigratedD1();
      await seedPublishedFillAllowances(d1);
      seedFillProducts(db);
      const token = await seedFreeSession(d1, db);
      for (const row of stored) {
        await seedObservation(d1, row);
      }

      const res = await postFill(fillApp(), permissiveEnv(d1), token);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Cache')).toBe('MISS');
      const body = (await res.json()) as FillJson;
      runs.push({ bytes: fillBytes(body), body });
    }

    const [first, superseded] = runs;

    // The fill output cannot tell the two database states apart…
    expect(superseded.bytes).toBe(first.bytes);

    // …while the block collapses to exactly ONE row — the LATEST
    // revision; the earlier observation never renders.
    expect(first.body.ferryPrices).toHaveLength(1);
    expect(superseded.body.ferryPrices).toEqual([
      {
        operator: 'tallink',
        route: 'Helsinki–Tallinn',
        label: 'Finlandia Redberry 100 cl',
        priceCents: 4050,
        observedAt: '2026-10-08',
        citation: revisions[1]!.citation,
      },
    ]);
    expect(JSON.stringify(superseded.body)).not.toBe(
      JSON.stringify(first.body),
    );
  });
});

// ===========================================================================
// 5. Price rows appear between two identical fill requests on ONE
//    composition — the cache-path parity of section 2: the cached fill
//    (bytes AND hash) stays identical while the fresh block reads the
//    new rows
// ===========================================================================

describe('ferry-price rows appear between two identical fill requests (one composition)', () => {
  it('serves the cached fill byte-identically (same X-Content-Hash) while the fresh block reflects the new rows', async () => {
    const { db, d1 } = openMigratedD1();
    await seedPublishedFillAllowances(d1);
    seedFillProducts(db);
    const token = await seedFreeSession(d1, db);
    const app = fillApp();
    const env = permissiveEnv(d1);

    // Absent-data table — the MISS pins the honest empty block and the
    // baseline fill bytes + hash.
    const empty = await postFill(app, env, token);
    expect(empty.status).toBe(200);
    expect(empty.headers.get('X-Cache')).toBe('MISS');
    const emptyBody = (await empty.json()) as FillJson;
    expect(emptyBody).toHaveProperty('ferryPrices');
    expect(emptyBody.ferryPrices).toEqual([]);
    const emptyBytes = fillBytes(emptyBody);
    const emptyHash = empty.headers.get('X-Content-Hash');
    expect(emptyHash).not.toBeNull();

    // The price table goes empty → seeded BETWEEN two IDENTICAL requests.
    await seedObservation(d1, PRICE_MANY_ROWS[0]!);
    await seedObservation(d1, PRICE_MANY_ROWS[1]!);

    const seeded = await postFill(app, env, token);
    expect(seeded.status).toBe(200);
    expect(seeded.headers.get('X-Cache')).toBe('HIT');
    const seededBody = (await seeded.json()) as FillJson;

    // The fill half is untouched — same bytes, same canonical hash.
    expect(fillBytes(seededBody)).toBe(emptyBytes);
    expect(seeded.headers.get('X-Content-Hash')).toBe(emptyHash);

    // Non-vacuity: the block was read FRESH on the hit, in the
    // deterministic order, under the identical cached fill.
    expect(seededBody.ferryPrices).toHaveLength(2);
    expect(seededBody.ferryPrices!.map((r) => r.operator)).toEqual([
      'eckero',
      'tallink',
    ]);
    expect(JSON.stringify(seededBody)).not.toBe(JSON.stringify(emptyBody));
  });
});
