/**
 * Compliance test: category-benchmark display-only neutrality (task 3.1,
 * change client-experience-improvement; spec price-benchmarks —
 * "Benchmarks SHALL NEVER enter a calculation total, a breakdown, or any
 * ranking input, proven by compliance byte-identity tests across zero,
 * one, and many benchmark rows").
 *
 * Deliberately independent of the task-3.1 route/repo suites (the
 * compliance layer's second-opinion role,
 * accuracy-unitprice-input-isolation.test.ts precedent). Two pins:
 *
 * 1. **Import-analysis** (static): no module that PRODUCES a ranking or
 *    calculation input (core-domain ranking / calculator / tax /
 *    optimizer / tripcalc, the product-search repository's ordering
 *    reads) may import the benchmark read-model
 *    (category-benchmarks.repository) or its display route. The
 *    repository is reachable only from the benchmarks route (and the
 *    data layer's own tests, excluded from the scan).
 * 2. **Output-identity** (dynamic): with the calculation's and the
 *    ranking's own inputs held constant, benchmark coverage is varied
 *    across fully separate compositions — zero extra benchmark rows,
 *    one, many (coverage grown ONLY through wine-category offers; the
 *    pinned beer inputs never move) — and the landed-cost calculation,
 *    the €/g ranking over beer, and the beer product's detail response
 *    are byte-identical in all three. The benchmarks endpoint itself
 *    proves the states genuinely differ (null → one figure → many) and
 *    that absence is `null`, never a zero.
 *
 * Byte-proxy decision: compute/read-time stamps (`calculationTimestamp`,
 * nested `calculatedAt`, the reliability embed's `computedAt`) are
 * normalized away — the same decision
 * accuracy-unitprice-input-isolation.test.ts makes; they are metadata,
 * not calculated figures. All seeds use fixed instants, so no other
 * volatility exists between compositions.
 *
 * Harness note: full app compositions via the api-worker route-test
 * harness by relative path (trip-affiliate-neutrality.test.ts
 * precedent); tests/compliance/vitest.config.ts resolves the graph.
 *
 * @module BenchmarksDisplayOnlyComplianceTest
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

// ---------------------------------------------------------------------------
// Import-analysis helpers (accuracy-unitprice-input-isolation pattern)
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

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

const BENCHMARKS_ROUTE = path.resolve(
  REPO_ROOT,
  'apps/api-worker/src/routes/benchmarks.routes.ts',
);

/** The modules whose OUTPUTS are ranking/calculation inputs. */
const INPUT_PRODUCING_FILES: readonly string[] = [
  ...CORE_INPUT_DIRS.flatMap((dir) => collectSourceFiles(dir)),
  PRODUCT_SEARCH_REPOSITORY,
];

/** Modules the input producers must never import (the benchmark read-model). */
const FORBIDDEN_TOKENS = ['category-benchmarks', 'benchmarks.routes'] as const;

// ===========================================================================
// 1. Import-analysis — the benchmark read-model is not an input
// ===========================================================================

describe('import-analysis: ranking/calculation input producers never import the benchmark read-model', () => {
  it('the specifier matcher itself can fire — the scan cannot pass vacuously', () => {
    expect(
      importedSpecifiers(
        `import { X } from './category-benchmarks.repository';\nexport * from './benchmarks.routes';`,
      ),
    ).toEqual(['./category-benchmarks.repository', './benchmarks.routes']);
    // Comments are stripped — prose may mention the modules freely.
    expect(
      importedSpecifiers(`// feeds the category benchmarks\nconst x = 1;`),
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

  it('no input-producing module imports the benchmark repository or its route', () => {
    for (const file of INPUT_PRODUCING_FILES) {
      const specifiers = specifiersOf(file);
      for (const token of FORBIDDEN_TOKENS) {
        expect(
          specifiers.filter((s) => s.includes(token)),
          `${file} must not import ${token} — benchmarks are display-only, ` +
            'never ranking/calculation inputs',
        ).toEqual([]);
      }
    }
  });

  it('the benchmark repository is reachable only from its display route', () => {
    const importers = collectSourceFiles(path.resolve(REPO_ROOT, 'apps'))
      .concat(collectSourceFiles(path.resolve(REPO_ROOT, 'packages')))
      .filter((file) => specifiersOf(file).some((s) => s.includes('category-benchmarks')));

    const outside = importers.filter((file) => file !== BENCHMARKS_ROUTE);
    expect(
      outside,
      'the benchmark read-model leaked outside its display route — it must ' +
        'never feed calculation totals, breakdowns, or ranking inputs',
    ).toEqual([]);
    // Non-vacuity: the display route really does import it.
    expect(
      specifiersOf(BENCHMARKS_ROUTE).some((s) => s.includes('category-benchmarks')),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Output-identity fixtures — calculation/ranking vs benchmark coverage
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

/**
 * The CONSTANT input slice: one beer product with one domestic Alko
 * offer. This is the €/g ranking's entire beer input set and the beer
 * product's entire offer set — identical in every composition.
 */
function seedConstantBeerSlice(db: ReturnType<typeof openMigratedD1>['db']): void {
  seedProduct(db, { id: 1, name: 'Karhu III', category: 'beer', unitVolume: 0.5 });
  seedOffer(db, {
    id: 11,
    productId: 1,
    merchant: 'alko',
    country: 'FI',
    priceCents: 250,
    observedAt: '2026-01-15T10:00:00.000Z',
  });
}

/**
 * The VARYING benchmark slice — coverage grows ONLY through cross-border
 * webshop offers (never the `alko` merchant: the detail route's
 * merchantReliability embed aggregates per MERCHANT, so an alko offer on
 * any product would legitimately move it — the embed is offer data, not
 * a benchmark surface). The pinned beer inputs never move:
 * - state "zero": no benchmark rows — every non-beer category reports null;
 * - state "one": a single cross-border wine offer — one segment figure;
 * - state "many": cross-border wine offers across two categories.
 */
function seedBenchmarkRows(
  db: ReturnType<typeof openMigratedD1>['db'],
  coverage: 'zero' | 'one' | 'many',
): void {
  if (coverage === 'zero') return;
  seedProduct(db, { id: 2, name: 'Benchmark Viini', category: 'wine_still', unitVolume: 0.75 });
  seedOffer(db, {
    id: 21,
    productId: 2,
    merchant: 'viinikauppa',
    country: 'EE',
    priceCents: 600,
    observedAt: '2026-02-01T10:00:00.000Z',
    reliabilityStatus: 'ESTIMATED',
  });
  if (coverage === 'one') return;
  seedOffer(db, {
    id: 22,
    productId: 2,
    merchant: 'saksoinet',
    country: 'DE',
    priceCents: 750,
    observedAt: '2026-02-02T10:00:00.000Z',
  });
  seedProduct(db, {
    id: 3,
    name: 'Benchmark Kumppani',
    category: 'wine_sparkling',
    unitVolume: 0.75,
  });
  seedOffer(db, {
    id: 31,
    productId: 3,
    merchant: 'viinikauppa',
    country: 'EE',
    priceCents: 1500,
    observedAt: '2026-02-03T10:00:00.000Z',
  });
}

/**
 * Remove the compute/read-time stamps — see the byte-proxy decision in
 * the module docs.
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

function bytes(body: unknown): string {
  return JSON.stringify(normalizeStamps(body));
}

async function fire(
  d1: ReturnType<typeof openMigratedD1>['d1'],
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const res = await request(buildApp(), permissiveEnv(d1), path, {
    headers: AGE,
    ...init,
  });
  expect(res.status, `${path} must answer 200`).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function postLandedCost(
  d1: ReturnType<typeof openMigratedD1>['d1'],
): Promise<Record<string, unknown>> {
  return fire(d1, '/api/v1/calculations/landed-cost', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AGE },
    body: JSON.stringify(LANDED_COST_BODY),
  });
}

interface BenchmarksJson {
  categories: {
    category: string;
    alko: { averageCentsPerLitre: number } | null;
    crossBorder: { averageCentsPerLitre: number } | null;
  }[];
}

// ===========================================================================
// 2. Output-identity: calculation and ranking vs benchmark coverage
// ===========================================================================

describe('benchmark coverage vs calculation/ranking output (fresh composition per state)', () => {
  it('zero, one, and many benchmark rows produce byte-identical calculation, ranking, and detail output', async () => {
    const states = ['zero', 'one', 'many'] as const;
    const captured = new Map<
      (typeof states)[number],
      {
        landedCost: Record<string, unknown>;
        ranking: Record<string, unknown>;
        detail: Record<string, unknown>;
        benchmarks: BenchmarksJson;
      }
    >();

    for (const coverage of states) {
      const composition = openMigratedD1();
      seedTaxRules(composition.db);
      seedConstantBeerSlice(composition.db);
      seedBenchmarkRows(composition.db, coverage);

      captured.set(coverage, {
        landedCost: await postLandedCost(composition.d1),
        ranking: await fire(composition.d1, '/api/v1/unitprice/ranking?category=beer'),
        detail: await fire(composition.d1, '/api/v1/products/1'),
        benchmarks: (await fire(
          composition.d1,
          '/api/v1/benchmarks/category-averages',
        )) as unknown as BenchmarksJson,
      });
    }

    const zero = captured.get('zero')!;

    // The three pinned outputs are byte-identical across ALL states —
    // the benchmark data neither grew a key nor moved a figure.
    for (const surface of ['landedCost', 'ranking', 'detail'] as const) {
      for (const coverage of ['one', 'many'] as const) {
        expect(bytes(captured.get(coverage)![surface]), `${surface}: ${coverage} vs zero`).toBe(
          bytes(zero[surface]),
        );
      }
    }
    // …and the keys themselves never grew — an additive leak would show
    // up as a new top-level field, not only a changed value.
    const landedCost = captured.get('one')!.landedCost;
    expect(Object.keys(landedCost).sort()).toEqual(Object.keys(zero.landedCost).sort());

    // Non-vacuity: the benchmarks endpoint genuinely moved between the
    // states — coverage null → one figure → many figures — proving the
    // compositions are different database states, while nothing else did.
    const benchmarks = {
      zero: zero.benchmarks,
      one: captured.get('one')!.benchmarks,
      many: captured.get('many')!.benchmarks,
    };

    // zero: wine_still has no coverage on either segment — honest
    // absence (null), never a zero average.
    const zeroWine = benchmarks.zero.categories.find((c) => c.category === 'wine_still')!;
    expect(zeroWine.alko).toBeNull();
    expect(zeroWine.crossBorder).toBeNull();
    // zero: the constant beer slice still prices the beer Alko segment —
    // the endpoint is live in every state.
    const zeroBeer = benchmarks.zero.categories.find((c) => c.category === 'beer')!;
    expect(zeroBeer.alko).not.toBeNull();
    expect(zeroBeer.crossBorder).toBeNull();

    // one: exactly one extra figure exists — the cross-border wine
    // average; the domestic segment stays honestly absent (coverage was
    // grown through webshop offers only).
    const oneWine = benchmarks.one.categories.find((c) => c.category === 'wine_still')!;
    expect(oneWine.alko).toBeNull();
    expect(oneWine.crossBorder?.averageCentsPerLitre).toBe(800); // 600/0.75
    expect(JSON.stringify(benchmarks.one)).not.toBe(JSON.stringify(benchmarks.zero));

    // many: the wine average moved and a third category appeared.
    const manyWine = benchmarks.many.categories.find((c) => c.category === 'wine_still')!;
    expect(manyWine.alko).toBeNull();
    expect(manyWine.crossBorder?.averageCentsPerLitre).toBe(900); // mean(600, 750)/0.75
    const manySparkling = benchmarks.many.categories.find(
      (c) => c.category === 'wine_sparkling',
    )!;
    expect(manySparkling.alko).toBeNull();
    expect(manySparkling.crossBorder?.averageCentsPerLitre).toBe(2000); // 1500/0.75
    expect(JSON.stringify(benchmarks.many)).not.toBe(JSON.stringify(benchmarks.one));
  });
});
