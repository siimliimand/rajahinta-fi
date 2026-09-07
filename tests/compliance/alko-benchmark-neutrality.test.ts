/**
 * Compliance test: domestic Alko benchmark neutrality (task 4.4,
 * change drop-sweden-eur-only-alko-benchmark; spec compliance-governance
 * "Domestic benchmark neutrality" + landed-cost-calculator "Domestic
 * reference benchmark is display only" — "Result output SHALL be
 * byte-identical whether zero, one, or many Alko reference offers exist
 * for unrelated purposes").
 *
 * Deliberately independent of the task-4.2 unit suites (the compliance
 * layer's second-opinion role, trip-affiliate-neutrality.test.ts
 * precedent). What this file adds:
 *
 * 1. **Byte-identity across database states, fresh compute each** — the
 *    IDENTICAL calculator request is fired against three fully separate
 *    compositions (migrated D1 + full createApp(), exactly as
 *    calculator.routes.test.ts drives the stack), with 0 / 1 / 4
 *    merchant-'alko' retail_offers rows. Each run answers as a cache
 *    MISS (fresh in-memory IdempotencyDO namespace per env), so the
 *    computation path itself is observed. Every calculated figure —
 *    totals, itemized breakdown, confidence, classification, ranking
 *    metadata — must be byte-identical; only the optional
 *    `alkoBenchmark` field may vary.
 * 2. **Exclusion from totalCents and the itemized array** — the total
 *    equals the sum of the itemized lines (the benchmark can add no
 *    cent), and no benchmark vocabulary exists anywhere in the
 *    breakdown.
 * 3. **Ranking lockstep** — the real RankingService sorts products with
 *    and without benchmark snapshots into orders identical to the
 *    benchmark-free baseline across all six sort orders; `rank()`'s
 *    unknown-property guard throws if the benchmark field reaches a
 *    ranking input, so any future mapping that leaks it fails the build
 *    here; plus a type-level assertion and a source-level scan proving
 *    `NeutralSortInput` structurally cannot carry the field.
 * 4. **Pre-change record fetch** — a record persisted before the field
 *    existed (no benchmark column value) fetches normally with no
 *    `alkoBenchmark` key — absence is the render-nothing state, never a
 *    placeholder.
 *
 * Byte-proxy decision: `JSON.stringify` of the response minus the two
 * inherently volatile fields — `metadata.calculationTimestamp` (clock
 * read per compute) and `calculationRecordId` (per-database sequence) —
 * is the byte proxy, the same proxy shape the 5.3/trip suites use for
 * this exact requirement style. Everything else in the result is
 * deterministic on identical inputs. The route's X-Content-Hash is NOT
 * comparable across compositions here (unlike the trip suite, the
 * volatile timestamp sits INSIDE the hashed result), so cross-run
 * identity is asserted on the projection itself.
 *
 * Reference-row pricing note: every Alko row is priced ABOVE the foreign
 * calculated offer, the same fixture interpretation the committed 4.2
 * suites pin — reference rows exist to decorate the offer the
 * calculation used (design D6), and row count is the only variable
 * across the three datasets.
 *
 * Harness note: the api-worker route-test harness is imported by
 * relative path exactly the way trip-affiliate-neutrality.test.ts
 * imports it (the composition it builds IS the code under test);
 * tests/compliance/vitest.config.ts carries the alias/plugin block that
 * import graph needs.
 *
 * @module AlkoBenchmarkNeutralityComplianceTest
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';

import {
  buildApp,
  openMigratedD1,
  permissiveEnv,
  request,
  seedCalculationRecord,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { RankingService } from '@rajahinta/core-domain';
import type { SortOrder } from '@rajahinta/core-domain';
import type { NeutralSortInput } from '@rajahinta/core-domain/ranking/ranking.types';

// ---------------------------------------------------------------------------
// Fixtures — identical request in every run
// ---------------------------------------------------------------------------

const AGE = { 'x-age-confirmed': 'confirmed' };

/** The ONE calculation request fired unchanged in every scenario. */
const CALC_BODY = JSON.stringify({ productId: 1, quantity: 2, destination: 'FI' });

/**
 * Seed the product, the foreign calculated offer, and both tax rules —
 * the dataset every scenario shares. Fixture layout mirrors the route
 * lifecycle test (distinct tax version labels flow into
 * metadata.datasetVersions; no transport rows → transport degrades to
 * UNAVAILABLE identically in every run).
 */
function seedSharedDataset(db: DatabaseSync): void {
  seedProduct(db, { id: 1, name: 'Karhu III' });
  seedOffer(db, {
    id: 11,
    productId: 1,
    merchant: 'kauppa',
    country: 'DE',
    priceCents: 250,
    observedAt: '2026-08-06T10:00:00.000Z',
  });
  seedTaxRule(db, {
    taxType: 'excise',
    productCategory: 'beer',
    rate: 0.365,
  });
  seedTaxRule(db, {
    id: 2,
    taxType: 'container_duty',
    productCategory: 'all_beverages',
    rate: 0.51,
    verified: false,
    versionLabel: 'v2.0-2025',
  });
}

/** One merchant-'alko' reference row, priced above the 250¢ best offer. */
function seedAlkoRow(
  db: DatabaseSync,
  row: { id: number; priceCents: number; observedAt: string; reliability: string },
): void {
  seedOffer(db, {
    id: row.id,
    productId: 1,
    merchant: 'alko',
    country: 'FI',
    priceCents: row.priceCents,
    observedAt: row.observedAt,
    reliabilityStatus: row.reliability,
  });
}

/** One merchant-'alko' reference row set per database state. */
type AlkoRow = {
  id: number;
  priceCents: number;
  observedAt: string;
  reliability: string;
};

/** Reference-row sets for the three database states. */
const ALKO_ROWS: Record<0 | 1 | 4, AlkoRow[]> = {
  0: [],
  1: [
    { id: 12, priceCents: 300, observedAt: '2026-08-05T10:00:00.000Z', reliability: 'VERIFIED' },
  ],
  // Two older observations and an observedAt tie: the newest axis wins,
  // the tie breaks on the higher id (15) — selection stays deterministic
  // regardless of row count or array order.
  4: [
    { id: 12, priceCents: 300, observedAt: '2026-08-05T10:00:00.000Z', reliability: 'VERIFIED' },
    { id: 13, priceCents: 320, observedAt: '2026-08-01T10:00:00.000Z', reliability: 'STALE' },
    { id: 14, priceCents: 310, observedAt: '2026-08-03T10:00:00.000Z', reliability: 'VERIFIED' },
    { id: 15, priceCents: 290, observedAt: '2026-08-05T10:00:00.000Z', reliability: 'ESTIMATED' },
  ],
};

/** Minimal response projection — exact-field pins live in the 4.2 suites. */
interface CalcResponseJson {
  itemizedCosts: { label: string; category: string; cents: number }[];
  totalCents: number;
  currency: string;
  confidence: string;
  metadata: Record<string, unknown>;
  calculationRecordId: number;
  alkoBenchmark?: Record<string, unknown>;
}

/**
 * The calculation bytes: the response minus what legitimately varies —
 * the benchmark field (the ONLY allowed variance; its exact per-run
 * values are pinned in the non-vacuity assertions below), the per-run
 * clock read, and the per-database record id (see module docs for the
 * byte-proxy decision).
 */
function calculationBytes(body: CalcResponseJson): string {
  const { alkoBenchmark: _bench, calculationRecordId: _id, metadata, ...stable } = body;
  const { calculationTimestamp: _ts, ...stableMetadata } = metadata;
  return JSON.stringify({ ...stable, metadata: stableMetadata });
}

/** The metadata fields a ranking mapping reads from, clock read removed. */
function rankingMetadata(body: CalcResponseJson): Record<string, unknown> {
  const { calculationTimestamp: _ts, ...stable } = body.metadata;
  return stable;
}

/** One full composition (own migrated D1 + app + fresh DO namespaces). */
async function runScenario(alkoRowCount: 0 | 1 | 4): Promise<CalcResponseJson> {
  const { db, d1 } = openMigratedD1();
  seedSharedDataset(db);
  for (const row of ALKO_ROWS[alkoRowCount]) {
    seedAlkoRow(db, row);
  }
  const app = buildApp();

  const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AGE },
    body: CALC_BODY,
  });
  expect(res.status).toBe(200);
  // Fresh compute each — the idempotency cache cannot mask a difference.
  expect(res.headers.get('X-Cache')).toBe('MISS');
  return (await res.json()) as CalcResponseJson;
}

// ===========================================================================
// 1. Byte-identity with zero, one, and many Alko reference rows
//    (spec scenario: "Output invariance")
// ===========================================================================

describe('calculation output vs Alko reference-row count (fresh compute per composition)', () => {
  it('is byte-identical with zero, one, and many reference rows while only the benchmark field varies', async () => {
    const zero = await runScenario(0);
    const one = await runScenario(1);
    const many = await runScenario(4);

    // The calculation bytes are identical across all three database
    // states — totals, breakdown, confidence, classification, and the
    // ranking metadata never move.
    expect(calculationBytes(one)).toBe(calculationBytes(zero));
    expect(calculationBytes(many)).toBe(calculationBytes(zero));

    // The spec's named projections, each pinned explicitly against the
    // benchmark-free run: totals, itemized breakdown, confidence, and
    // the metadata every ranking input maps from.
    for (const run of [one, many]) {
      expect(run.totalCents).toBe(zero.totalCents);
      expect(run.itemizedCosts).toEqual(zero.itemizedCosts);
      expect(run.confidence).toBe(zero.confidence);
      expect(rankingMetadata(run)).toEqual(rankingMetadata(zero));
    }

    // Non-vacuity: the benchmark field genuinely varies with the rows —
    // absent with zero, and a different selected reference with one vs
    // many (the observedAt tie breaks to the higher id) — so the three
    // raw bodies are pairwise distinct database states.
    expect('alkoBenchmark' in zero).toBe(false);
    expect(one.alkoBenchmark).toEqual({
      status: 'available',
      referencePriceCents: 300,
      differenceCents: -50,
      // −50 / 300 × 100 = −16.666… → −16.7 (half away from zero).
      differencePercent: -16.7,
      reliabilityStatus: 'VERIFIED',
      observedAt: '2026-08-05T10:00:00.000Z',
    });
    expect(many.alkoBenchmark).toEqual({
      status: 'available',
      referencePriceCents: 290,
      differenceCents: -40,
      // −40 / 290 × 100 = −13.793… → −13.8.
      differencePercent: -13.8,
      reliabilityStatus: 'ESTIMATED',
      observedAt: '2026-08-05T10:00:00.000Z',
    });
    expect(one.alkoBenchmark).not.toEqual(many.alkoBenchmark);
    expect(JSON.stringify(zero)).not.toBe(JSON.stringify(one));
    expect(JSON.stringify(one)).not.toBe(JSON.stringify(many));
    expect(JSON.stringify(zero)).not.toBe(JSON.stringify(many));
  });
});

// ===========================================================================
// 2. Benchmark excluded from totalCents and the itemized breakdown array
// ===========================================================================

describe('benchmark exclusion from totals and breakdown', () => {
  it('the total equals the sum of the itemized lines and no breakdown line carries the benchmark', async () => {
    const many = await runScenario(4);

    // The benchmark can add no cent: the total is exactly the four
    // itemized lines, benchmark present or not.
    const lineSum = many.itemizedCosts.reduce((sum, line) => sum + line.cents, 0);
    expect(many.totalCents).toBe(lineSum);
    expect(many.totalCents).toBeGreaterThan(0);

    // No benchmark vocabulary anywhere in the itemized array (top-level
    // lines or nested sub-lines).
    const breakdownJson = JSON.stringify(many.itemizedCosts).toLowerCase();
    expect(breakdownJson).not.toContain('alko');
    expect(breakdownJson).not.toContain('benchmark');

    // The field exists only as its own top-level display-only key —
    // strip it and no trace remains in the payload.
    const { alkoBenchmark: _bench, ...withoutBenchmark } = many;
    expect(JSON.stringify(withoutBenchmark)).not.toContain('alkoBenchmark');
  });
});

// ===========================================================================
// 3. Pre-change record fetch — absence is normal
// ===========================================================================

describe('persisted record fetch (pre-change shape, no benchmark field)', () => {
  it('a record written before the field existed fetches with no alkoBenchmark key', async () => {
    const { db, d1 } = openMigratedD1();
    seedSharedDataset(db);
    // seedCalculationRecord writes the pre-change row shape — no
    // benchmark value, as every record created before task 4.2 looks.
    seedCalculationRecord(db, { id: 9, productMasterId: 1, totalCents: 873 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator/result/9', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // Absence, never null and never a placeholder — the page renders
    // normally without the benchmark line.
    expect('alkoBenchmark' in body).toBe(false);
    expect(body.totalCents).toBe(873);
  });
});

// ===========================================================================
// 4. Ranking lockstep over products with and without reference offers
//    (spec scenario: "Ranking lockstep with benchmark")
// ===========================================================================

/**
 * Compile-time assertion: an object carrying `alkoBenchmark` is NOT
 * assignable to `NeutralSortInput` — the same seal
 * `_NeutralityTypeCheck` applies to `paidBoost`. If this line ever
 * fails to compile, the ranking input type accepts the benchmark.
 */
 
type _AlkoRankingTypeCheck = NeutralSortInput extends { alkoBenchmark: unknown }
  ? never
  : true;
const _alkoRankingTypeCheck: _AlkoRankingTypeCheck = true;
void _alkoRankingTypeCheck;

/**
 * A product record as a caller holds it after calculation — the
 * NeutralSortInput fields plus, on some products, the display-only
 * benchmark snapshot. The projection below is the ONLY legal mapping
 * into the ranking input.
 */
interface ProductRecord {
  readonly productName: string;
  readonly totalCents: number;
  readonly volumeLitres: number;
  readonly quantity: number;
  readonly alcoholByVolume: number;
  readonly category: string;
  readonly alkoBenchmark?: Record<string, unknown>;
}

function createProduct(overrides: Partial<ProductRecord>): ProductRecord {
  return {
    productName: 'Test Product',
    totalCents: 1000,
    volumeLitres: 0.33,
    quantity: 1,
    alcoholByVolume: 4.7,
    category: 'beer',
    ...overrides,
  };
}

/** The products: a mix with and without reference offers, with cost ties. */
const PRODUCTS: ProductRecord[] = [
  createProduct({ productName: 'Karhu III', totalCents: 3000 }),
  createProduct({
    productName: 'Heineken',
    totalCents: 1500,
    volumeLitres: 0.5,
    alkoBenchmark: {
      status: 'available',
      referencePriceCents: 290,
      differenceCents: -40,
      differencePercent: -13.8,
      reliabilityStatus: 'ESTIMATED',
      observedAt: '2026-08-05T10:00:00.000Z',
    },
  }),
  // Ties with Heineken on totalCents AND volumeLitres — the alphabetical
  // tiebreaker decides, with or without the benchmark decoration.
  createProduct({ productName: 'A. Le Coq Premium', totalCents: 1500, volumeLitres: 0.5 }),
  createProduct({
    productName: 'Koskenkorva',
    totalCents: 4500,
    category: 'spirits',
    alcoholByVolume: 38,
    volumeLitres: 0.5,
    alkoBenchmark: {
      status: 'available',
      referencePriceCents: 2900,
      differenceCents: 1600,
      differencePercent: 55.2,
      reliabilityStatus: 'VERIFIED',
      observedAt: '2026-08-01T10:00:00.000Z',
    },
  }),
  createProduct({
    productName: 'Franzia',
    totalCents: 1200,
    category: 'wine',
    alcoholByVolume: 12,
    volumeLitres: 1,
  }),
];

/** The only legal mapping: an explicit projection to the six fields. */
function toRankingInput(p: ProductRecord): NeutralSortInput {
  return {
    totalCents: p.totalCents,
    volumeLitres: p.volumeLitres,
    quantity: p.quantity,
    productName: p.productName,
    alcoholByVolume: p.alcoholByVolume,
    category: p.category,
  };
}

/** Benchmark-free baseline — the same records with the field stripped. */
const BASELINE_PRODUCTS: ProductRecord[] = PRODUCTS.map(
  ({ alkoBenchmark: _bench, ...rest }) => rest,
);

const ALL_SORT_ORDERS: SortOrder[] = [
  'LOWEST_LANDED_COST',
  'LOWEST_PER_LITRE',
  'LOWEST_PER_UNIT',
  'ALPHABETICAL',
  'ALCOHOL_PERCENTAGE',
  'PRODUCT_CATEGORY',
];

describe('ranking lockstep with benchmark (products with and without reference offers)', () => {
  const service = new RankingService();

  it.each<SortOrder>(ALL_SORT_ORDERS)(
    '%s produces the benchmark-free baseline order',
    (order) => {
      const withBenchmark = service.rank(PRODUCTS.map(toRankingInput), order);
      const baseline = service.rank(BASELINE_PRODUCTS.map(toRankingInput), order);
      expect(withBenchmark.map((i) => i.productName)).toEqual(
        baseline.map((i) => i.productName),
      );
    },
  );

  it('the projection output carries no benchmark key — explicit leak assertion', () => {
    for (const item of PRODUCTS.map(toRankingInput)) {
      expect(item).not.toHaveProperty('alkoBenchmark');
      expect(Object.keys(item)).toHaveLength(6);
    }
  });

  it('rank() structurally rejects the benchmark — a leak fails the build here', () => {
    // If a future mapping spreads the full result into the ranking
    // input, the unknown-property guard throws before any comparator
    // runs — this suite (and any caller) fails loudly instead of
    // sorting on commercial-adjacent data.
    const leaked = { ...toRankingInput(PRODUCTS[1]!), alkoBenchmark: { status: 'available' } };
    expect(() => service.rank([leaked], 'LOWEST_LANDED_COST')).toThrow(TypeError);
    expect(() => service.rank([leaked], 'LOWEST_LANDED_COST')).toThrow(
      /alkoBenchmark/,
    );
  });
});

// ===========================================================================
// 5. Source level — NeutralSortInput structurally cannot carry the field
//    (trip-affiliate-neutrality readFileSync-scan pattern)
// ===========================================================================

/** Alko/benchmark vocabulary — must never appear in the ranking input type. */
const ALKO_VOCABULARY = /alko|benchmark/i;

/** Extract a full `interface`/`type` declaration block by brace matching. */
function extractDeclaration(source: string, name: string): string | null {
  const match = new RegExp(`\\b(?:export )?(?:interface|type) ${name}\\b`).exec(
    source,
  );
  if (match === null) return null;
  const open = source.indexOf('{', match.index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  return null;
}

describe('NeutralSortInput is benchmark-free at source level', () => {
  it('the vocabulary matcher itself can fire — the scan cannot pass vacuously', () => {
    expect(ALKO_VOCABULARY.test('readonly alkoBenchmark?: AlkoBenchmark')).toBe(
      true,
    );
    expect(ALKO_VOCABULARY.test('readonly totalCents: number')).toBe(false);
  });

  it('the NeutralSortInput declaration mentions no alko/benchmark vocabulary', () => {
    const source = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../packages/core-domain/src/ranking/ranking.types.ts',
      ),
      'utf8',
    );
    const block = extractDeclaration(source, 'NeutralSortInput');
    expect(block).not.toBeNull();
    expect(
      block,
      'NeutralSortInput must not carry alko/benchmark vocabulary — ' +
        'the ranking input structurally cannot include the display-only benchmark',
    ).not.toMatch(ALKO_VOCABULARY);
  });
});
