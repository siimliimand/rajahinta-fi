/**
 * Compliance test: accuracy-statistic and €/g-ranking input isolation +
 * €/g ordering determinism (task 9.1, change trust-and-reach-roadmap).
 *
 * Spec pins proven here, with the two patterns the task names:
 *
 * - **Import-analysis** (static): spec unit-price-metrics — "the ranking
 *   SHALL NOT feed product default ordering, search order, or any
 *   calculation input"; spec calculation-outcomes — the accuracy
 *   statistic is a public read-model. No module that PRODUCES a ranking
 *   or calculation input (core-domain ranking / calculator / tax /
 *   optimizer / tripcalc, the product-search repository's default
 *   ordering) may import the unitprice or outcomes modules; the pure
 *   `rankUnitPrices` policy and the `D1CalculationOutcomeRepository`
 *   are reachable only from their own display surface (ranking route /
 *   outcomes route) and type mirrors; the search route's sole
 *   unit-price contact is the additive eur-per-gram DISPLAY embed, never
 *   the ranking policy.
 * - **Output-identity** (dynamic): a landed-cost calculation is
 *   byte-identical whether the outcomes table is empty or full, and the
 *   default product ordering is byte-identical whether the €/g ranking
 *   would order products one way or the exact reverse — only the
 *   ranking's own output moves.
 * - **Determinism lockstep**: the ranking endpoint's item order is in
 *   lockstep with the pure policy (`rankUnitPrices`) over the same data,
 *   byte-identical across repeat and separate requests, order-independent
 *   of input order, with product id as the stable secondary key
 *   (unit-price-metrics: "Equal values SHALL resolve by a stable
 *   secondary key").
 *
 * Byte-proxy decisions: compute/read-time timestamps (the landed-cost
 * body's `calculationTimestamp`, the excise mapping's nested
 * `calculatedAt`, the reliability embed's `computedAt`) are metadata —
 * normalized away like the task-2.2 suite's computedAt
 * (merchant-reports.routes.test.ts precedent); they are not calculated
 * figures. All seeds use fixed instants, so no other volatility exists.
 *
 * Harness note: full app compositions via the api-worker route-test
 * harness by relative path (trip-affiliate-neutrality.test.ts
 * precedent); tests/compliance/vitest.config.ts resolves the graph.
 *
 * @module AccuracyUnitPriceInputIsolationComplianceTest
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  buildApp,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedCalculationRecord,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { D1CalculationOutcomeRepository } from '../../packages/data-platform/src/repositories/d1/calculation-outcome.repository';
import { D1ProductSearchRepository } from '../../packages/data-platform/src/repositories/d1/product-search.repository';
import { eurPerGram } from '../../packages/core-domain/src/unitprice/eur-per-gram';
import { rankUnitPrices } from '../../packages/core-domain/src/unitprice/ranking';
import type { UnitPriceRankingEntry } from '../../packages/core-domain/src/unitprice/ranking';
import type { ReliabilityStatus } from '../../packages/core-domain/src/reliability/reliability.types';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Import-analysis helpers (trip-affiliate readFileSync-scan pattern)
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

/** Every module under the given core-domain src directories (non-test). */
function filesUnderDirs(dirs: readonly string[]): string[] {
  return dirs.flatMap((dir) => collectSourceFiles(dir));
}

const CORE_INPUT_DIRS = ['ranking', 'calculator', 'tax', 'optimizer', 'tripcalc'].map(
  (dir) => path.resolve(REPO_ROOT, 'packages/core-domain/src', dir),
);

const PRODUCT_SEARCH_REPOSITORY = path.resolve(
  REPO_ROOT,
  'packages/data-platform/src/repositories/d1/product-search.repository.ts',
);

const WORKER_ROUTES_DIR = path.resolve(REPO_ROOT, 'apps/api-worker/src/routes');

/** The modules whose OUTPUTS are ranking/calculation inputs — see module docs. */
const INPUT_PRODUCING_FILES: readonly string[] = [
  ...filesUnderDirs(CORE_INPUT_DIRS),
  PRODUCT_SEARCH_REPOSITORY,
];

/** Modules the input producers must never import (accuracy stat, €/g). */
const FORBIDDEN_TOKENS = ['unitprice', 'outcomes'] as const;

// ===========================================================================
// 1. Import-analysis — the statistic and the ranking are not inputs
// ===========================================================================

describe('import-analysis: ranking/calculation input producers never import unitprice or outcomes', () => {
  it('the specifier matcher itself can fire — the scan cannot pass vacuously', () => {
    expect(
      importedSpecifiers(
        `import { rankUnitPrices } from '../unitprice/ranking';\nexport * from './outcomes/outcomes';`,
      ),
    ).toEqual(['../unitprice/ranking', './outcomes/outcomes']);
    expect(
      importedSpecifiers(
        `import { eurPerGram } from '../../../../packages/core-domain/src/unitprice/eur-per-gram';`,
      ).some((s) => s.includes('unitprice')),
    ).toBe(true);
    // Comments are stripped — prose may mention the modules freely.
    expect(
      importedSpecifiers(`// feeds the unitprice ranking\nconst x = 1;`),
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

  it('no input-producing module imports unitprice or outcomes', () => {
    for (const file of INPUT_PRODUCING_FILES) {
      const specifiers = specifiersOf(file);
      for (const token of FORBIDDEN_TOKENS) {
        expect(
          specifiers.filter((s) => s.includes(token)),
          `${file} must not import ${token} — the accuracy statistic and the ` +
            '€/g ranking are read-models, never ranking/calculation inputs',
        ).toEqual([]);
      }
    }
  });

  it('the search route may embed the display METRIC but never the ranking POLICY nor accuracy', () => {
    const specifiers = specifiersOf(
      path.join(WORKER_ROUTES_DIR, 'search.routes.ts'),
    );
    // The sanctioned contact point: the additive informational embed.
    expect(specifiers.some((s) => s.includes('unitprice/eur-per-gram'))).toBe(
      true,
    );
    // The ranked ORDER and the statistic must not enter search.
    expect(specifiers.filter((s) => s.includes('unitprice/ranking'))).toEqual([]);
    expect(specifiers.filter((s) => s.includes('outcomes'))).toEqual([]);
  });

  it('the ranking route itself never reads the accuracy statistic', () => {
    const specifiers = specifiersOf(
      path.join(WORKER_ROUTES_DIR, 'unitprice.routes.ts'),
    );
    expect(specifiers.filter((s) => s.includes('outcomes'))).toEqual([]);
  });

  it('rankUnitPrices is reachable only from its display route and type mirrors', () => {
    const importers = collectSourceFiles(path.resolve(REPO_ROOT, 'apps'))
      .concat(collectSourceFiles(path.resolve(REPO_ROOT, 'packages')))
      .filter((file) => specifiersOf(file).some((s) => s.includes('unitprice/ranking')));

    const allowed = (file: string): boolean =>
      file.includes(`${path.sep}unitprice${path.sep}`) || // the module itself
      file.endsWith(path.join('apps', 'api-worker', 'src', 'routes', 'unitprice.routes.ts')) ||
      file.endsWith(path.join('apps', 'frontend', 'src', 'lib', 'types.ts')); // display type mirror

    const outside = importers.filter((file) => !allowed(file));
    expect(
      outside,
      'rankUnitPrices leaked outside the ranking display surface — it must ' +
        'never feed default ordering, search order, or calculation inputs',
    ).toEqual([]);
    // Non-vacuity: the display route really does import it.
    expect(importers).toContain(
      path.join(WORKER_ROUTES_DIR, 'unitprice.routes.ts'),
    );
  });

  it('the calculation-outcome repository is reachable only from the data layer and its own route', () => {
    const importers = collectSourceFiles(path.resolve(REPO_ROOT, 'apps'))
      .concat(collectSourceFiles(path.resolve(REPO_ROOT, 'packages')))
      .filter((file) => specifiersOf(file).some((s) => s.includes('calculation-outcome')));

    const allowed = (file: string): boolean =>
      file.includes(`${path.sep}data-platform${path.sep}`) || // the data layer itself
      file.endsWith(path.join('apps', 'api-worker', 'src', 'routes', 'outcomes.routes.ts'));

    const outside = importers.filter((file) => !allowed(file));
    expect(
      outside,
      'the accuracy statistic repository leaked outside the outcomes surface',
    ).toEqual([]);
    // Non-vacuity: the outcomes route really does import it.
    expect(importers).toContain(
      path.join(WORKER_ROUTES_DIR, 'outcomes.routes.ts'),
    );
  });
});

// ---------------------------------------------------------------------------
// Output-identity fixtures — landed cost vs accuracy state
// ---------------------------------------------------------------------------

const AGE = { 'x-age-confirmed': 'confirmed' };

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

async function postLandedCost(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<Record<string, unknown>> {
  const res = await request(
    buildApp(),
    permissiveEnv(d1),
    '/api/v1/calculations/landed-cost',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify(LANDED_COST_BODY),
    },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Strip compute/read-time stamps — the top-level `calculationTimestamp`
 * and any nested `calculatedAt`/`computedAt` (e.g. the excise mapping's
 * freshness stamp). They differ in milliseconds between two fetches and
 * carry no calculated figure — the same normalization decision the
 * task-2.2 suite makes for computedAt. Everything else must be
 * byte-identical, and the diff the first run showed was exactly
 * milliseconds-only.
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

function calculationBytes(body: Record<string, unknown>): string {
  return JSON.stringify(normalizeStamps(body));
}

async function getAccuracy(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<{ count: number; withinMarginShare: number | null; label: Record<string, string> }> {
  const res = await request(
    buildApp(),
    permissiveEnv(d1),
    '/api/v1/accuracy',
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    count: number;
    withinMarginShare: number | null;
    label: Record<string, string>;
  };
}

/** Two outcomes on two records: one within the 5% margin, one outside — share 0.5. */
async function seedOutcomes(
  d1: ReturnType<typeof openMigratedD1>['d1'],
  db: ReturnType<typeof openMigratedD1>['db'],
): Promise<void> {
  seedProduct(db, { id: 1, name: 'Karhu III' });
  seedCalculationRecord(db, { id: 1, productMasterId: 1, totalCents: 1000 });
  seedCalculationRecord(db, { id: 2, productMasterId: 1, totalCents: 1000 });
  seedAccount(db, {
    id: 1,
    userId: 'user-outcome',
    email: 'outcome@example.invalid',
    tier: 'FREE',
  });
  const repo = new D1CalculationOutcomeRepository(d1);
  await repo.create({
    calculationRecordId: 1,
    reporterAccountId: 1,
    estimateDigest: { algorithm: 'sha256', digest: 'compliance-fixture' },
    estimatedTotalCents: 1000,
    reportedTotalCents: 1020, // +2% — within the margin
  });
  await repo.create({
    calculationRecordId: 2,
    reporterAccountId: 1,
    estimateDigest: { algorithm: 'sha256', digest: 'compliance-fixture' },
    estimatedTotalCents: 1000,
    reportedTotalCents: 1300, // +30% — outside the margin
  });
}

// ===========================================================================
// 2. Output-identity: the accuracy statistic never enters a calculation
// ===========================================================================

describe('accuracy-statistic state vs landed-cost output (fresh compute per composition)', () => {
  it('the calculation is byte-identical with an empty and a full outcomes table', async () => {
    // Composition A: no outcomes anywhere.
    const empty = openMigratedD1();
    seedTaxRules(empty.db);
    const emptyBody = await postLandedCost(empty.d1);
    const emptyAccuracy = await getAccuracy(empty.d1);
    expect(emptyAccuracy.count).toBe(0);
    expect(emptyAccuracy.withinMarginShare).toBeNull(); // honest empty state

    // Composition B: identical seeds PLUS two reported outcomes.
    const seeded = openMigratedD1();
    seedTaxRules(seeded.db);
    await seedOutcomes(seeded.d1, seeded.db);
    const seededBody = await postLandedCost(seeded.d1);
    const seededAccuracy = await getAccuracy(seeded.d1);

    // The calculation neither grew a key nor moved a figure.
    expect(calculationBytes(seededBody)).toBe(calculationBytes(emptyBody));
    expect(Object.keys(seededBody).sort()).toEqual(Object.keys(emptyBody).sort());

    // Non-vacuity: the statistic genuinely moved between the states —
    // count 0 → 2, share null → 0.5 — while the calculation did not.
    expect(seededAccuracy.count).toBe(2);
    expect(seededAccuracy.withinMarginShare).toBe(0.5);
    // The "user-reported" labelling contract: the EN label carries the
    // phrase, the FI label is its Finnish counterpart — never a bare
    // percentage.
    expect(seededAccuracy.label.en?.toLowerCase()).toContain('user-reported');
    expect(seededAccuracy.label.fi?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// €/g ranking fixtures — determinism, lockstep, and default-ordering isolation
// ---------------------------------------------------------------------------

const RANKING_PATH = '/api/v1/unitprice/ranking?category=beer';
const COMPARE_PATH = '/api/v1/products?ids=1,2,3,4,5';
const SEARCH_PATH = '/api/v1/products?q=Product';
const OBSERVED_AT = '2026-01-15T10:00:00.000Z';

interface RankingJson {
  category: string;
  items: {
    productId: number;
    name: string;
    brand: string;
    offerId: number;
    centsPerGram: number;
    ethanolGrams: number;
    reliabilityStatus: 'VERIFIED' | 'ESTIMATED';
  }[];
}

interface ListingJson {
  items: { id: number }[];
  merchantWarnings?: unknown;
  [key: string]: unknown;
}

function stripVolatile(body: Record<string, unknown>): string {
  const { merchantWarnings: _w, calculationTimestamp: _t, ...rest } = body;
  return JSON.stringify(rest).replaceAll(/"computedAt":"[^"]*"/g, '"computedAt":"<READ-TIME>"');
}

/**
 * Five same-shape beer products. Names fix the DEFAULT listing order
 * (alphabetical: 2,3,1,4,5); offer prices fix the initial €/g ranking
 * order (cheapest first: 1,4,5,3,2 — products 4 and 5 tie exactly, so
 * the id tiebreaker is exercised). All identical across compositions.
 */
function seedRankingCatalog(db: ReturnType<typeof openMigratedD1>['db']): void {
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
}

/** Reverse the €/g landscape: cheapest becomes dearest and vice versa. */
function flipPrices(db: ReturnType<typeof openMigratedD1>['db']): void {
  const update = db.prepare('UPDATE retail_offers SET price_cents = ? WHERE id = ?');
  update.run(900, 11); // product 1: 100 → 900
  update.run(100, 21); // product 2: 500 → 100
  update.run(150, 41); // product 4: 200 → 150
}

async function getRanking(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<RankingJson> {
  const res = await request(buildApp(), permissiveEnv(d1), RANKING_PATH, {
    headers: AGE,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as RankingJson;
}

async function fireListing(
  d1: ReturnType<typeof openMigratedD1>['d1'],
  path: string,
): Promise<ListingJson> {
  const res = await request(buildApp(), permissiveEnv(d1), path, {
    headers: AGE,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ListingJson;
}

/** The route's own input mapping, replicated for the policy lockstep. */
function toReliabilityStatus(raw: string): ReliabilityStatus {
  const statuses: readonly string[] = ['VERIFIED', 'STALE', 'ESTIMATED', 'UNAVAILABLE'];
  return (statuses.includes(raw) ? raw : 'UNAVAILABLE') as ReliabilityStatus;
}

async function rankViaPolicy(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<ReturnType<typeof rankUnitPrices>> {
  const repo = new D1ProductSearchRepository(d1);
  const products = await repo.searchByName(null, 10_000);
  const entries: UnitPriceRankingEntry[] = [];
  for (const product of products) {
    if (product.category !== 'beer') continue;
    const unitVolumeL = Number.parseFloat(product.unitVolume);
    const alcoholFraction =
      product.alcoholByVolume !== null ? Number.parseFloat(product.alcoholByVolume) : null;
    for (const offer of await repo.findOffers(product.id)) {
      entries.push({
        productId: product.id,
        offerId: offer.id,
        metric: eurPerGram(
          offer.priceCents,
          unitVolumeL,
          alcoholFraction,
          toReliabilityStatus(offer.reliabilityStatus),
        ),
      });
    }
  }
  return rankUnitPrices(entries);
}

// ===========================================================================
// 3. €/g ordering determinism lockstep (route ↔ pure policy)
// ===========================================================================

describe('€/g ranking determinism lockstep', () => {
  it('the endpoint order equals the pure policy order over the same data, ties resolved by product id', async () => {
    const { db, d1 } = openMigratedD1();
    seedRankingCatalog(db);

    const route = await getRanking(d1);
    expect(route.category).toBe('beer');
    expect(route.items.map((i) => i.productId)).toEqual([1, 4, 5, 3, 2]);
    // The exact-tie products sit id-ascending — the stable secondary key.
    expect(route.items.slice(1, 3).map((i) => i.productId)).toEqual([4, 5]);

    // Lockstep: every endpoint row IS the policy row (the endpoint only
    // joins the identity fields name/brand onto it — pinned against the
    // seeded catalog so the join cannot smuggle in another field set).
    const policy = await rankViaPolicy(d1);
    const catalogNames: Record<number, string> = {
      1: 'C-Product',
      2: 'A-Product',
      3: 'B-Product',
      4: 'D-Product',
      5: 'E-Product',
    };
    expect(
      route.items.map(({ name: _n, brand: _b, ...row }) => row),
    ).toEqual(policy);
    for (const item of route.items) {
      expect(item.name).toBe(catalogNames[item.productId]);
    }
  });

  it('repeated requests and separate compositions produce byte-identical ranking bodies', async () => {
    const first = openMigratedD1();
    seedRankingCatalog(first.db);
    const firstBody = await getRanking(first.d1);
    const repeat = await getRanking(first.d1); // same composition, second request
    expect(JSON.stringify(repeat)).toBe(JSON.stringify(firstBody));

    const second = openMigratedD1(); // fully separate composition, same seeds
    seedRankingCatalog(second.db);
    const secondBody = await getRanking(second.d1);
    expect(JSON.stringify(secondBody)).toBe(JSON.stringify(firstBody));
  });

  it('the pure policy is order-independent: every input permutation yields the identical output', async () => {
    const { db, d1 } = openMigratedD1();
    seedRankingCatalog(db);
    const repo = new D1ProductSearchRepository(d1);
    const products = await repo.searchByName(null, 10_000);
    const entries: UnitPriceRankingEntry[] = [];
    for (const product of products) {
      if (product.category !== 'beer') continue;
      for (const offer of await repo.findOffers(product.id)) {
        entries.push({
          productId: product.id,
          offerId: offer.id,
          metric: eurPerGram(offer.priceCents, 0.5, 0.047),
        });
      }
    }
    const reference = JSON.stringify(rankUnitPrices(entries));
    const permutations = [entries, [...entries].reverse(), [entries[4], entries[0], entries[3], entries[1], entries[2]]];
    for (const permutation of permutations) {
      expect(JSON.stringify(rankUnitPrices(permutation))).toBe(reference);
    }
  });
});

// ===========================================================================
// 4. Output-identity: the €/g ranking never moves the default ordering
// ===========================================================================

describe('€/g ranking flip vs default ordering (fresh composition per price state)', () => {
  it('the ranking order reverses while the default listing stays byte-identical', async () => {
    // State A: initial prices.
    const before = openMigratedD1();
    seedRankingCatalog(before.db);
    const rankingBefore = await getRanking(before.d1);
    const compareBefore = await fireListing(before.d1, COMPARE_PATH);
    const searchBefore = await fireListing(before.d1, SEARCH_PATH);
    expect(rankingBefore.items.map((i) => i.productId)).toEqual([1, 4, 5, 3, 2]);

    // State B: identical seeds, prices flipped, fresh composition.
    const after = openMigratedD1();
    seedRankingCatalog(after.db);
    flipPrices(after.db);
    const rankingAfter = await getRanking(after.d1);
    const compareAfter = await fireListing(after.d1, COMPARE_PATH);
    const searchAfter = await fireListing(after.d1, SEARCH_PATH);

    // Non-vacuity: the €/g ranking genuinely moved — the metric is live.
    const orderBefore = rankingBefore.items.map((i) => i.productId);
    const orderAfter = rankingAfter.items.map((i) => i.productId);
    expect(orderAfter).not.toEqual(orderBefore);
    expect(orderAfter).toEqual([2, 4, 5, 3, 1]);

    // The default ordering followed the product data, never the metric:
    // identical id order AND identical bytes (informational embeds
    // stripped). The compare surface pins the alphabetical order —
    // names, not €/g, decide it; the search surface pins its own
    // relevance order (a product_master FTS read — no offers, no
    // ranking) as flip-invariant.
    expect(compareBefore.items.map((i) => i.id)).toEqual([2, 3, 1, 4, 5]);
    for (const [a, b, label] of [
      [compareBefore, compareAfter, 'compare'],
      [searchBefore, searchAfter, 'search'],
    ] as const) {
      const orderA = a.items.map((i) => i.id);
      expect(a.items).toHaveLength(5);
      expect(b.items.map((i) => i.id), `${label}: id order after flip`).toEqual(
        orderA,
      );
      expect(stripVolatile(b as unknown as Record<string, unknown>)).toBe(
        stripVolatile(a as unknown as Record<string, unknown>),
      );
    }
  });
});
