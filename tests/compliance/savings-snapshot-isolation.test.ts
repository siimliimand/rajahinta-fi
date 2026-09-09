/**
 * Compliance test: savings-snapshot isolation (task 6.1, change
 * insight-surfaces), mirroring accuracy-unitprice-input-isolation.test.ts.
 *
 * The savings_snapshots table (migration 0018) is the materialized read
 * model behind the /api/v1/savings insight surface, written exclusively
 * by the daily background pass. It is an OUTPUT of the pipeline — it must
 * never feed a calculation, a ranking, or a basket optimization. Proven
 * with the mirror suite's two patterns:
 *
 * - **Import-analysis** (static): no module that PRODUCES a ranking or
 *   calculation input (core-domain ranking / calculator / tax /
 *   optimizer / tripcalc, the product-search repository) imports any
 *   savings module; the snapshot repository is reachable only from the
 *   data layer and its own display/backfill surfaces.
 * - **Output-identity** (dynamic): with ZERO, ONE, and MANY savings
 *   snapshot rows present, the landed-cost calculation, the €/g ranking,
 *   and the basket optimization are byte-identical (same
 *   JSON.stringify discipline as the mirror test) to the zero-row
 *   outputs. The savings surface itself is the non-vacuity witness: its
 *   honest empty state (asOf null) vs populated day proves the
 *   compositions genuinely differ in snapshot state while nothing else
 *   moved.
 *
 * Byte-proxy decisions are the mirror suite's: compute/read-time stamps
 * (calculationTimestamp/calculatedAt/computedAt) are normalized away;
 * all seeds use fixed instants, so no other volatility exists.
 *
 * Harness note: full app compositions via the api-worker route-test
 * harness by relative path (mirror precedent);
 * tests/compliance/vitest.config.ts resolves the graph.
 *
 * @module SavingsSnapshotIsolationComplianceTest
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  buildApp,
  openMigratedD1,
  permissiveEnv,
  request,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { registerSavingsRoutes } from '../../apps/api-worker/src/routes/savings.routes';
import { D1SavingsSnapshotRepository } from '../../packages/data-platform/src/repositories/d1/savings-snapshot.repository';
import type { SavingsSnapshotUpsertInput } from '../../packages/data-platform/src/abstracts';
import { seedCarrierBoxTypes } from '../../packages/data-platform/src/seed/carrier-box-types.seed';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Import-analysis helpers (mirror suite's readFileSync-scan pattern)
// ---------------------------------------------------------------------------

/** Recursively collect non-test .ts sources; generated/test trees excluded. */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // directory absent in this checkout — nothing to scan
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === '__tests__' ||
        entry.name === 'node_modules' ||
        entry.name === 'dist'
      ) {
        continue;
      }
      collectSourceFiles(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments — a doc-comment example must never fire the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Module specifiers of every static, side-effect, and dynamic import. */
function importedSpecifiers(source: string): string[] {
  const clean = stripComments(source);
  const specifiers: string[] = [];
  const patterns = [
    /from\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of clean.matchAll(pattern)) {
      specifiers.push(match[1]!);
    }
  }
  return specifiers;
}

function specifiersOf(file: string): string[] {
  return importedSpecifiers(readFileSync(file, 'utf8'));
}

const CORE_INPUT_DIRS = ['ranking', 'calculator', 'tax', 'optimizer', 'tripcalc'].map(
  (dir) => path.resolve(REPO_ROOT, 'packages/core-domain/src', dir),
);

const PRODUCT_SEARCH_REPOSITORY = path.resolve(
  REPO_ROOT,
  'packages/data-platform/src/repositories/d1/product-search.repository.ts',
);

const WORKER_ROUTES_DIR = path.resolve(REPO_ROOT, 'apps/api-worker/src/routes');

/** The modules whose OUTPUTS are ranking/calculation inputs. */
const INPUT_PRODUCING_FILES: readonly string[] = [
  ...CORE_INPUT_DIRS.flatMap((dir) => collectSourceFiles(dir)),
  PRODUCT_SEARCH_REPOSITORY,
];

// ===========================================================================
// 1. Import-analysis — the snapshot read model is never an input
// ===========================================================================

describe('import-analysis: ranking/calculation input producers never import savings', () => {
  it('the specifier matcher itself can fire — the scan cannot pass vacuously', () => {
    expect(
      importedSpecifiers(
        `import { D1SavingsSnapshotRepository } from '../savings-snapshot.repository';`,
      ).some((s) => s.includes('savings')),
    ).toBe(true);
    // Comments are stripped — prose may mention the module freely.
    expect(
      importedSpecifiers(`// feeds the savings surface\nconst x = 1;`),
    ).toEqual([]);
  });

  it('the scan set is live: it contains the input-producing modules', () => {
    expect(INPUT_PRODUCING_FILES.length).toBeGreaterThan(0);
    for (const dir of CORE_INPUT_DIRS) {
      expect(
        INPUT_PRODUCING_FILES.some((f) => f.startsWith(dir)),
        `core-domain/src/${path.basename(dir)} must be part of the scan set`,
      ).toBe(true);
    }
    expect(INPUT_PRODUCING_FILES).toContain(PRODUCT_SEARCH_REPOSITORY);
  });

  it('no input-producing module imports a savings module', () => {
    for (const file of INPUT_PRODUCING_FILES) {
      const specifiers = specifiersOf(file);
      expect(
        specifiers.filter((s) => s.includes('savings')),
        `${file} must not import savings — the snapshot table is a read ` +
          'model written by the background pass, never a calculation or ' +
          'ranking input',
      ).toEqual([]);
    }
  });

  it('the snapshot repository is reachable only from the data layer and the savings surfaces', () => {
    const importers = collectSourceFiles(path.resolve(REPO_ROOT, 'apps'))
      .concat(collectSourceFiles(path.resolve(REPO_ROOT, 'packages')))
      .filter((file) => specifiersOf(file).some((s) => s.includes('savings-snapshot.repository')));

    const allowed = (file: string): boolean =>
      file.includes(`${path.sep}data-platform${path.sep}`) || // the data layer itself
      file.endsWith(path.join(WORKER_ROUTES_DIR, 'savings.routes.ts')) ||
      file.endsWith(
        path.join('apps', 'api-worker', 'src', 'cron', 'savings-snapshots.ts'),
      ); // the only writer

    const outside = importers.filter((file) => !allowed(file));
    expect(
      outside,
      'the savings-snapshot repository leaked outside its display/backfill ' +
        'surfaces — it must never feed a calculation, ranking, or basket input',
    ).toEqual([]);
    // Non-vacuity: the display route really does import it.
    expect(importers).toContain(path.join(WORKER_ROUTES_DIR, 'savings.routes.ts'));
  });
});

// ---------------------------------------------------------------------------
// Shared catalog — identical seeds in every composition
// ---------------------------------------------------------------------------

const AGE = { 'x-age-confirmed': 'confirmed' };
const JSON_AGE = { 'content-type': 'application/json', ... AGE };

const OBSERVED_AT = '2026-01-15T10:00:00.000Z';

const LANDED_COST_BODY = {
  retailPriceCents: 350,
  transportCostCents: 500,
  exciseBase: { category: 'beer', volumeLitres: 0.33, alcoholByVolume: 0.047 },
  containerType: 'glass',
  containerVolumeLitres: 0.33,
  depositSystemVerified: false,
  transactionClass: 'distance-selling',
};

function seedTaxRules(db: ReturnType<typeof openMigratedD1>['db']): void {
  seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
  seedTaxRule(db, {
    id: 2,
    taxType: 'container_duty',
    productCategory: 'all_beverages',
    rate: 0.51,
  });
}

/**
 * Five same-shape beer products (the mirror suite's ranking catalog —
 * names fix the default listing order, prices fix the €/g order with an
 * exact id-tiebroken tie), plus the basket fixture's dimension row on
 * product 1 and the real curated box catalogue.
 */
function seedSharedCatalog(db: ReturnType<typeof openMigratedD1>['db']): void {
  seedTaxRules(db);
  seedProduct(db, { id: 1, name: 'C-Product', category: 'beer', unitVolume: 0.5 });
  seedProduct(db, { id: 2, name: 'A-Product', category: 'beer', unitVolume: 0.5 });
  seedProduct(db, { id: 3, name: 'B-Product', category: 'beer', unitVolume: 0.5 });
  seedProduct(db, { id: 4, name: 'D-Product', category: 'beer', unitVolume: 0.5 });
  seedProduct(db, { id: 5, name: 'E-Product', category: 'beer', unitVolume: 0.5 });
  seedOffer(db, { id: 11, productId: 1, merchant: 'alko', priceCents: 100, observedAt: OBSERVED_AT });
  seedOffer(db, { id: 21, productId: 2, merchant: 'alko', priceCents: 500, observedAt: OBSERVED_AT });
  seedOffer(db, { id: 31, productId: 3, merchant: 'alko', priceCents: 300, observedAt: OBSERVED_AT });
  seedOffer(db, { id: 41, productId: 4, merchant: 'alko', priceCents: 200, observedAt: OBSERVED_AT });
  seedOffer(db, { id: 51, productId: 5, merchant: 'alko', priceCents: 200, observedAt: OBSERVED_AT });
  db.prepare(
    `INSERT INTO product_dimensions (
       product_id, weight_g, height_mm, diameter_mm, material, source,
       reliability_status, observed_at
     ) VALUES (1, 400, 250, 80, 'GLASS', 'savings-isolation-compliance', 'ESTIMATED', ?)`,
  ).run(OBSERVED_AT);
}

async function seedBoxCatalogue(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<void> {
  await seedCarrierBoxTypes(d1);
}

// ---------------------------------------------------------------------------
// Savings snapshot fixtures — the only difference between compositions
// ---------------------------------------------------------------------------

const SNAPSHOT_DAY_A = '2026-09-07';

/** One fully computed daily snapshot, as the insight job emits it. */
function snapshotInput(
  productId: number,
  overrides: Partial<SavingsSnapshotUpsertInput> = {},
): SavingsSnapshotUpsertInput {
  return {
    asOf: SNAPSHOT_DAY_A,
    productId,
    category: 'beer',
    bestMerchant: 'eu-import',
    bestMerchantCountry: 'DE',
    bestPriceCents: 1099,
    bestObservedAt: new Date('2026-09-07T06:00:00.000Z'),
    alkoReferenceCents: 2599,
    alkoObservedAt: new Date('2026-09-07T05:30:00.000Z'),
    landedTotalCents: 1590,
    landedReliability: 'ESTIMATED',
    confidence: 'MEDIUM',
    gapCents: 1009,
    gapBasisPoints: 3882,
    taxDatasetVersion: 'v3.0-2026',
    ...overrides,
  };
}

async function seedSnapshots(
  d1: ReturnType<typeof openMigratedD1>['d1'],
  inputs: readonly SavingsSnapshotUpsertInput[],
): Promise<void> {
  const repo = new D1SavingsSnapshotRepository(d1);
  for (const input of inputs) {
    await repo.upsertSnapshot(input);
  }
}

// ---------------------------------------------------------------------------
// The three measured surfaces
// ---------------------------------------------------------------------------

/**
 * Strip compute/read-time stamps — the same normalization decision as the
 * mirror suite (milliseconds differ between two fetches, no calculated
 * figure moves). Everything else must be byte-identical.
 */
function normalizeStamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStamps);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (key === 'calculationTimestamp' || key === 'calculatedAt' || key === 'computedAt') {
        continue;
      }
      out[key] = normalizeStamps(v);
    }
    return out;
  }
  return value;
}

async function postLandedCost(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<Record<string, unknown>> {
  const res = await request(
    buildApp(),
    permissiveEnv(d1),
    '/api/v1/calculations/landed-cost',
    {
      method: 'POST',
      headers: JSON_AGE,
      body: JSON.stringify(LANDED_COST_BODY),
    },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function getRanking(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<unknown> {
  const res = await request(
    buildApp(),
    permissiveEnv(d1),
    '/api/v1/unitprice/ranking?category=beer',
    { headers: AGE },
  );
  expect(res.status).toBe(200);
  return await res.json();
}

async function postBasketOptimize(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<Record<string, unknown>> {
  const res = await request(
    buildApp(),
    permissiveEnv(d1),
    '/api/v1/basket/optimize',
    {
      method: 'POST',
      headers: JSON_AGE,
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 2 }],
        destination: 'FI',
      }),
    },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function getSavings(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<{
  asOf: string | null;
  rows: { productId: number }[];
  coverage: { evaluated: number; withReference: number; listed: number };
}> {
  const app = registerSavingsRoutes(buildApp());
  const res = await request(app, permissiveEnv(d1), '/api/v1/savings?category=beer', {
    headers: AGE,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    asOf: string | null;
    rows: { productId: number }[];
    coverage: { evaluated: number; withReference: number; listed: number };
  };
}

// ===========================================================================
// 2. Output-identity: zero, one, and many snapshots — identical outputs
// ===========================================================================

describe('savings-snapshot state vs calculator/ranking/basket outputs (fresh composition per snapshot state)', () => {
  it('all three outputs are byte-identical with zero, one, and many snapshot rows', async () => {
    // Composition A: no savings rows anywhere.
    const zero = openMigratedD1();
    seedSharedCatalog(zero.db);
    await seedBoxCatalogue(zero.d1);
    const zeroCost = await postLandedCost(zero.d1);
    const zeroRanking = await getRanking(zero.d1);
    const zeroBasket = await postBasketOptimize(zero.d1);
    const zeroSavings = await getSavings(zero.d1);

    // Composition B: identical seeds PLUS exactly one snapshot row.
    const one = openMigratedD1();
    seedSharedCatalog(one.db);
    await seedBoxCatalogue(one.d1);
    await seedSnapshots(one.d1, [snapshotInput(1)]);
    const oneCost = await postLandedCost(one.d1);
    const oneRanking = await getRanking(one.d1);
    const oneBasket = await postBasketOptimize(one.d1);
    const oneSavings = await getSavings(one.d1);

    // Composition C: identical seeds PLUS many snapshot rows — three
    // days, two products.
    const many = openMigratedD1();
    seedSharedCatalog(many.db);
    await seedBoxCatalogue(many.d1);
    await seedSnapshots(many.d1, [
      snapshotInput(1),
      snapshotInput(2),
      snapshotInput(1, { asOf: '2026-09-06' }),
      snapshotInput(2, { asOf: '2026-09-06' }),
      snapshotInput(1, { asOf: '2026-09-05' }),
      snapshotInput(2, { asOf: '2026-09-05' }),
    ]);
    const manyCost = await postLandedCost(many.d1);
    const manyRanking = await getRanking(many.d1);
    const manyBasket = await postBasketOptimize(many.d1);
    const manySavings = await getSavings(many.d1);

    // The calculator neither grew a key nor moved a figure.
    const zeroCostBytes = JSON.stringify(normalizeStamps(zeroCost));
    expect(JSON.stringify(normalizeStamps(oneCost))).toBe(zeroCostBytes);
    expect(JSON.stringify(normalizeStamps(manyCost))).toBe(zeroCostBytes);
    expect(Object.keys(manyCost).sort()).toEqual(Object.keys(zeroCost).sort());

    // The ranking is byte-identical across all three states.
    const zeroRankingBytes = JSON.stringify(zeroRanking);
    expect(JSON.stringify(oneRanking)).toBe(zeroRankingBytes);
    expect(JSON.stringify(manyRanking)).toBe(zeroRankingBytes);
    // Non-vacuity for the ranking surface: the metric orders the seeded
    // catalog (mirror suite's expected order).
    expect(
      (zeroRanking as { items: { productId: number }[] }).items.map((i) => i.productId),
    ).toEqual([1, 4, 5, 3, 2]);

    // The basket optimization is byte-identical across all three states.
    const zeroBasketBytes = JSON.stringify(normalizeStamps(zeroBasket));
    expect(JSON.stringify(normalizeStamps(oneBasket))).toBe(zeroBasketBytes);
    expect(JSON.stringify(normalizeStamps(manyBasket))).toBe(zeroBasketBytes);
    expect(Object.keys(manyBasket).sort()).toEqual(Object.keys(zeroBasket).sort());

    // Non-vacuity — the compositions genuinely differ in snapshot state:
    // the savings surface's honest empty state (asOf null, no rows) vs
    // the populated latest day, while its registry coverage (products
    // evaluated) stayed constant.
    expect(zeroSavings.asOf).toBeNull();
    expect(zeroSavings.rows).toEqual([]);
    expect(oneSavings.asOf).toBe(SNAPSHOT_DAY_A);
    expect(oneSavings.rows).toHaveLength(1);
    expect(manySavings.asOf).toBe(SNAPSHOT_DAY_A);
    expect(manySavings.rows.map((r) => r.productId).sort()).toEqual([1, 2]);
    expect(zeroSavings.coverage.evaluated).toBe(manySavings.coverage.evaluated);
    expect(zeroSavings.coverage.withReference).toBe(0);
    expect(manySavings.coverage.withReference).toBe(2);
  });
});
