/**
 * Compliance test: accuracy-breakdown read path is display-only (task 4.3,
 * change expand-alerts-accuracy-breakdowns).
 *
 * Spec pins proven here, with the two patterns the task names (precedent:
 * accuracy-unitprice-input-isolation):
 *
 * - **Import-analysis** (static): spec calculation-outcomes — "the
 *   breakdown read path SHALL be display-only and SHALL NOT feed the
 *   calculator, ranking, or any basket input". No module that PRODUCES a
 *   ranking or calculation input (core-domain ranking / calculator / tax /
 *   optimizer / tripcalc, the product-search repository's default
 *   ordering) may import the outcomes module or the calculation-outcome
 *   repository; the pure `aggregateOutcomeAccuracyBreakdown` module is
 *   reachable only from the core-domain barrel and its display route
 *   (outcomes.routes.ts), and the pinned surfaces' own route files
 *   (calculator, unitprice ranking, basket) have no outcomes contact at
 *   all.
 * - **Output-identity** (dynamic): with the breakdown read path present
 *   AND exercised — both split endpoints returning populated cells over
 *   the same joins the statistic uses — the calculator response, the €/g
 *   ranking response, and the basket/optimization response are
 *   byte-identical to their values with an empty outcomes table. The two
 *   compositions share EVERY seed (catalog, offers, tax rules, transport
 *   offer, linked calculation records, account); only the two
 *   `calculation_outcomes` rows differ, so any byte difference could only
 *   come from the breakdown read path.
 *
 * Byte-proxy decisions (precedent parity): compute/read-time timestamps
 * (`calculationTimestamp`, nested `calculatedAt`/`computedAt`) are
 * metadata — normalized away like the precedent's `normalizeStamps`; the
 * accuracy endpoints' `asOf` is read-time too, so those bodies are
 * compared structurally (cells/counts), never by bytes. All seeds use
 * fixed instants, so no other volatility exists.
 *
 * Harness note: full app compositions via the api-worker route-test
 * harness by relative path (accuracy-unitprice-input-isolation.test.ts
 * precedent); tests/compliance/vitest.config.ts resolves the graph.
 *
 * @module AccuracyBreakdownInputIsolationComplianceTest
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
import type { DatabaseSync } from 'node:sqlite';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Import-analysis helpers (accuracy-unitprice readFileSync-scan pattern)
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

/**
 * Modules the input producers must never import: the outcomes module
 * (home of `aggregateOutcomeAccuracyBreakdown`) and the calculation-outcome
 * repository (home of `findAccuracyBreakdown`).
 */
const FORBIDDEN_TOKENS = ['outcomes', 'calculation-outcome'] as const;

const OUTCOMES_MODULE_DIR = path.resolve(REPO_ROOT, 'packages/core-domain/src/outcomes');
const CORE_DOMAIN_BARREL = path.resolve(REPO_ROOT, 'packages/core-domain/src/index.ts');
const OUTCOMES_ROUTE = path.join(WORKER_ROUTES_DIR, 'outcomes.routes.ts');

// ===========================================================================
// 1. Import-analysis — the breakdown is not a ranking/calculation input
// ===========================================================================

describe('import-analysis: breakdown read path never feeds calculator/ranking/basket inputs', () => {
  it('the specifier matcher itself can fire — the scan cannot pass vacuously', () => {
    expect(
      importedSpecifiers(
        `import { rankUnitPrices } from '../unitprice/ranking';\nexport * from './outcomes/outcomes';`,
      ),
    ).toEqual(['../unitprice/ranking', './outcomes/outcomes']);
    expect(
      importedSpecifiers(
        `import { findAccuracyBreakdown } from './calculation-outcome.repository';`,
      ).some((s) => s.includes('calculation-outcome')),
    ).toBe(true);
    // Comments are stripped — prose may mention the modules freely.
    expect(
      importedSpecifiers(`// feeds the accuracy breakdown\nconst x = 1;`),
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

  it('no input-producing module imports the outcomes module or the calculation-outcome repository', () => {
    for (const file of INPUT_PRODUCING_FILES) {
      const specifiers = specifiersOf(file);
      for (const token of FORBIDDEN_TOKENS) {
        expect(
          specifiers.filter((s) => s.includes(token)),
          `${file} must not import ${token} — the accuracy breakdown is a ` +
            'read-model, never a ranking/calculation input',
        ).toEqual([]);
      }
    }
  });

  it('the executable breakdown module is reachable only from the barrel and its display route — the one outside contact is the value-free margin constant', () => {
    const importers = collectSourceFiles(path.resolve(REPO_ROOT, 'apps'))
      .concat(collectSourceFiles(path.resolve(REPO_ROOT, 'packages')))
      .filter((file) => specifiersOf(file).some((s) => s.includes('outcomes/outcomes')));

    const isDisplaySurface = (file: string): boolean =>
      file.startsWith(OUTCOMES_MODULE_DIR + path.sep) || // the module itself
      file === CORE_DOMAIN_BARREL || // re-export for display consumers
      file === OUTCOMES_ROUTE; // the display surface

    // The EXECUTABLE module (aggregateOutcomeAccuracyBreakdown) — not the
    // sibling .types file. End-anchored so 'outcomes/outcomes.types' does
    // not match.
    const executableSpecifier = /outcomes\/outcomes(\.js)?$/;

    for (const file of importers) {
      if (isDisplaySurface(file)) continue;
      expect(
        specifiersOf(file).filter((s) => executableSpecifier.test(s)),
        `${file} imports the executable accuracy-breakdown module — it must ` +
          'never feed calculator, ranking, or basket inputs',
      ).toEqual([]);
      // Outside the display surface the only permitted outcomes contact
      // is the types/constants module — no values can flow through it.
      // (Established wiring: the api-worker bridge re-exports the
      // WITHIN_MARGIN_FRACTION constant from outcomes.types.)
      const nonTypeSpecifiers = specifiersOf(file).filter(
        (s) => s.includes('outcomes') && !s.endsWith('outcomes.types'),
      );
      expect(
        nonTypeSpecifiers,
        `${file} has an outcomes contact beyond the value-free .types module`,
      ).toEqual([]);
    }

    // Non-vacuity: the barrel and the display route really do import the
    // executable module, and the value-free outside contact really exists.
    expect(importers).toContain(CORE_DOMAIN_BARREL);
    expect(importers).toContain(OUTCOMES_ROUTE);
    expect(
      importers.some(
        (file) =>
          !isDisplaySurface(file) &&
          specifiersOf(file).some((s) => s.endsWith('outcomes.types')),
      ),
    ).toBe(true);
  });

  it('the calculation-outcome repository is reachable only from the data layer and its own route', () => {
    const importers = collectSourceFiles(path.resolve(REPO_ROOT, 'apps'))
      .concat(collectSourceFiles(path.resolve(REPO_ROOT, 'packages')))
      .filter((file) => specifiersOf(file).some((s) => s.includes('calculation-outcome')));

    const allowed = (file: string): boolean =>
      file.includes(`${path.sep}data-platform${path.sep}`) || // the data layer itself
      file === OUTCOMES_ROUTE;

    const outside = importers.filter((file) => !allowed(file));
    expect(
      outside,
      'the accuracy-breakdown repository leaked outside the outcomes surface',
    ).toEqual([]);
    // Non-vacuity: the outcomes route really does import it.
    expect(importers).toContain(OUTCOMES_ROUTE);
  });

  it('the pinned surfaces\u2019 own route files have no outcomes contact at all', () => {
    for (const route of ['calculator.routes.ts', 'unitprice.routes.ts', 'basket.routes.ts']) {
      const specifiers = specifiersOf(path.join(WORKER_ROUTES_DIR, route));
      for (const token of FORBIDDEN_TOKENS) {
        expect(
          specifiers.filter((s) => s.includes(token)),
          `${route} must not import ${token} — the pinned surface reads no ` +
            'accuracy statistic and no breakdown',
        ).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Output-identity fixtures — calculator/ranking/basket vs outcome state
// ---------------------------------------------------------------------------

const AGE = { 'x-age-confirmed': 'confirmed' };
const JSON_HEADERS = { 'content-type': 'application/json', ...AGE };

const LANDED_COST_BODY = {
  retailPriceCents: 350,
  transportCostCents: 500,
  exciseBase: { category: 'beer', volumeLitres: 0.33, alcoholByVolume: 0.047 },
  containerType: 'glass',
  containerVolumeLitres: 0.33,
  depositSystemVerified: false,
  transactionClass: 'distance-selling',
};

const OBSERVED_AT = '2026-01-15T10:00:00.000Z';
const TRANSPORT_OBSERVED_AT = '2026-09-01T00:00:00.000Z';
const TRANSPORT_OFFER_ID = 71;
const TRANSPORT_CARRIER = 'postnord';

function seedTaxRules(db: DatabaseSync): void {
  seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
  seedTaxRule(db, {
    id: 2,
    taxType: 'container_duty',
    productCategory: 'all_beverages',
    rate: 0.51,
  });
}

/**
 * Five same-shape beer products (the precedent's €/g landscape: cheapest
 * first 1,4,5,3,2 with the 4/5 exact tie) — the ranking surface's fixture —
 * plus everything the OTHER two pinned surfaces read: product 1's offer
 * feeds the basket optimizer, the tax rules feed calculator and basket,
 * and the transport offer + linked records feed the breakdown's carrier
 * join and the basket's transport estimation. EVERY element here is seeded
 * in BOTH compositions — only the outcome rows may differ (see module docs).
 */
function seedSharedCatalog(db: DatabaseSync): void {
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
  seedTaxRules(db);

  // Carrier-join fixture: one transport offer and twelve calculation
  // records, eleven linked to it (the harness seeds transport_offer_id as
  // NULL, so links are explicit test-side UPDATEs). Twelve outcomes clear
  // the endpoint's display floor (BREAKDOWN_MIN_CELL_N = 10), so both
  // breakdown cells surface a real share — the strongest non-vacuity: an
  // actual numeric breakdown value exists that could leak. The records
  // are read by no pinned surface (precedent: record existence never
  // moves their bytes).
  db.prepare(
    `INSERT INTO transport_offers (
       id, carrier, origin_country, destination_country, weight_min_kg,
       weight_max_kg, package_tier, price_cents, currency,
       seller_involvement_indicator, observed_at, refreshed_at, reliability_status
     ) VALUES (?, ?, 'SE', 'FI', 0.5, 20.0, 'parcel', 500, 'EUR', 0, ?, ?, 'ESTIMATED')`,
  ).run(TRANSPORT_OFFER_ID, TRANSPORT_CARRIER, TRANSPORT_OBSERVED_AT, TRANSPORT_OBSERVED_AT);
  for (let id = 1; id <= 12; id++) {
    seedCalculationRecord(db, { id, productMasterId: 1, totalCents: 1000 });
    if (id <= 11) {
      db.prepare('UPDATE calculation_records SET transport_offer_id = ? WHERE id = ?').run(
        TRANSPORT_OFFER_ID,
        id,
      );
    }
  }
  seedAccount(db, {
    id: 1,
    userId: 'user-outcome',
    email: 'outcome@example.invalid',
    tier: 'FREE',
  });
}

/**
 * Twelve outcomes: records 1–8 within the 5% margin (+2%), records 9–12
 * outside (+30%). Global share 8/12; the beer category cell covers all
 * twelve; the postnord carrier cell covers the eleven linked records
 * (8 within, 3 outside → 8/11). These rows are the ONLY data difference
 * between the two compositions.
 */
async function seedOutcomes(d1: ReturnType<typeof openMigratedD1>['d1']): Promise<void> {
  const repo = new D1CalculationOutcomeRepository(d1);
  for (let recordId = 1; recordId <= 12; recordId++) {
    await repo.create({
      calculationRecordId: recordId,
      reporterAccountId: 1,
      estimateDigest: { algorithm: 'sha256', digest: 'compliance-fixture' },
      estimatedTotalCents: 1000,
      reportedTotalCents: recordId <= 8 ? 1020 : 1300,
    });
  }
}

/**
 * Strip compute/read-time stamps — the top-level `calculationTimestamp`
 * and any nested `calculatedAt`/`computedAt` (e.g. the basket metadata's
 * calculation stamp, the excise mapping's freshness stamp). They differ in
 * milliseconds between two fetches and carry no calculated figure — the
 * same normalization decision the precedent suite makes. Everything else
 * must be byte-identical.
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

async function postLandedCost(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<Record<string, unknown>> {
  const res = await request(
    buildApp(),
    permissiveEnv(d1),
    '/api/v1/calculations/landed-cost',
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(LANDED_COST_BODY),
    },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const RANKING_PATH = '/api/v1/unitprice/ranking?category=beer';

interface RankingJson {
  items: { productId: number }[];
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

const BASKET_BODY = { items: [{ productId: 1, quantity: 2 }], destination: 'FI' };

async function postBasketOptimize(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<Record<string, unknown>> {
  const res = await request(
    buildApp(),
    permissiveEnv(d1),
    '/api/v1/basket/optimize',
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(BASKET_BODY),
    },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

interface AccuracyJson {
  count: number;
  withinMarginShare: number | null;
  dimension?: string;
  cells?: {
    key: string;
    count: number;
    withinMarginShare: number | null;
    state?: 'share' | 'count_only' | 'empty';
  }[];
  label: Record<string, string>;
}

async function getAccuracy(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<AccuracyJson> {
  const res = await request(buildApp(), permissiveEnv(d1), '/api/v1/accuracy');
  expect(res.status).toBe(200);
  return (await res.json()) as AccuracyJson;
}

async function getAccuracyBreakdown(
  d1: ReturnType<typeof openMigratedD1>['d1'],
  groupBy: 'category' | 'carrier',
): Promise<AccuracyJson> {
  const res = await request(
    buildApp(),
    permissiveEnv(d1),
    `/api/v1/accuracy?groupBy=${groupBy}`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as AccuracyJson;
}

/**
 * Fire every breakdown read path and return the three parsed bodies. Both
 * compositions run this — the "breakdowns active" state is not the extra
 * calls, it is the populated outcome rows the joins resolve.
 */
async function fireAccuracySurfaces(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<{ global: AccuracyJson; category: AccuracyJson; carrier: AccuracyJson }> {
  const global = await getAccuracy(d1);
  const category = await getAccuracyBreakdown(d1, 'category');
  const carrier = await getAccuracyBreakdown(d1, 'carrier');
  return { global, category, carrier };
}

/** Capture the three pinned surfaces in a fixed order (cache-state parity). */
async function capturePinnedSurfaces(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<{
  calculator: Record<string, unknown>;
  ranking: RankingJson;
  basket: Record<string, unknown>;
}> {
  const calculator = await postLandedCost(d1);
  const ranking = await getRanking(d1);
  const basket = await postBasketOptimize(d1);
  return { calculator, ranking, basket };
}

// ===========================================================================
// 2. Output-identity: breakdowns exercised vs outcomes table empty
// ===========================================================================

describe('breakdown read path exercised vs empty outcomes (fresh compute per composition)', () => {
  it('both breakdown dimensions populate while calculator, ranking, and basket stay byte-identical', async () => {
    // Composition A: the shared catalog, NO outcomes anywhere.
    const empty = openMigratedD1();
    seedSharedCatalog(empty.db);
    const emptyAccuracy = await fireAccuracySurfaces(empty.d1);
    expect(emptyAccuracy.global.count).toBe(0);
    expect(emptyAccuracy.global.withinMarginShare).toBeNull(); // honest empty state
    expect(emptyAccuracy.category.cells).toEqual([]); // no fabricated cells either
    expect(emptyAccuracy.carrier.cells).toEqual([]);
    const emptySurfaces = await capturePinnedSurfaces(empty.d1);

    // Composition B: identical seeds PLUS the two outcome rows — the
    // breakdown read path is now "active" (its joins resolve real rows).
    const seeded = openMigratedD1();
    seedSharedCatalog(seeded.db);
    await seedOutcomes(seeded.d1);
    const seededAccuracy = await fireAccuracySurfaces(seeded.d1);
    const seededSurfaces = await capturePinnedSurfaces(seeded.d1);

    // Non-vacuity, global: the statistic genuinely moved — count 0 → 12,
    // share null → 8/12 — under the user-reported labelling contract.
    expect(seededAccuracy.global.count).toBe(12);
    expect(seededAccuracy.global.withinMarginShare).toBe(8 / 12);
    expect(seededAccuracy.global.label.en?.toLowerCase()).toContain('user-reported');
    expect(seededAccuracy.global.label.fi?.length ?? 0).toBeGreaterThan(0);

    // Non-vacuity, category join (outcome → record → product_master):
    // all twelve outcomes land in the beer cell — above the display
    // floor, so the endpoint surfaces the real share (state 'share').
    expect(seededAccuracy.category.dimension).toBe('category');
    expect(seededAccuracy.category.cells).toEqual([
      { key: 'beer', count: 12, withinMarginShare: 8 / 12, state: 'share' },
    ]);

    // Non-vacuity, carrier join (outcome → record → transport_offers):
    // only the eleven linked records reach the cell (8 within, 3 outside)
    // — the carrier read path demonstrably executed its join, again in
    // the share state.
    expect(seededAccuracy.carrier.dimension).toBe('carrier');
    expect(seededAccuracy.carrier.cells).toEqual([
      { key: TRANSPORT_CARRIER, count: 11, withinMarginShare: 8 / 11, state: 'share' },
    ]);

    // The three pinned surfaces neither grew a key nor moved a figure —
    // byte-identical modulo compute-time stamps (spec
    // calculation-outcomes: "byte-identical (compliance-pinned)").
    expect(calculationBytes(seededSurfaces.calculator)).toBe(
      calculationBytes(emptySurfaces.calculator),
    );
    expect(Object.keys(seededSurfaces.calculator).sort()).toEqual(
      Object.keys(emptySurfaces.calculator).sort(),
    );

    expect(JSON.stringify(seededSurfaces.ranking)).toBe(
      JSON.stringify(emptySurfaces.ranking),
    );

    expect(calculationBytes(seededSurfaces.basket)).toBe(
      calculationBytes(emptySurfaces.basket),
    );
    expect(Object.keys(seededSurfaces.basket).sort()).toEqual(
      Object.keys(emptySurfaces.basket).sort(),
    );

    // Liveness of the pinned surfaces themselves: the ranking really
    // produced the precedent's €/g order and the basket really optimized.
    expect(seededSurfaces.ranking.items.map((i) => i.productId)).toEqual([
      1, 4, 5, 3, 2,
    ]);
    expect(typeof seededSurfaces.basket.totalCents).toBe('number');
    expect(
      Array.isArray(seededSurfaces.basket.shipments) &&
        (seededSurfaces.basket.shipments as unknown[]).length > 0,
    ).toBe(true);
  });
});
