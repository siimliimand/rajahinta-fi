/**
 * Compliance test: distance-selling badge display-only neutrality (task
 * 4.2, change client-experience-improvement; spec product-catalog —
 * "Distance-selling status guidance": the badge SHALL be an additive
 * display field that never enters a calculation or ranking input, and
 * calculation/ranking output SHALL be byte-identical across zero, one,
 * and many status badges present).
 *
 * Second-opinion layer, deliberately independent of the task-4.2 display
 * work (benchmarks-display-only.test.ts precedent). Three pins:
 *
 * 1. **Import-analysis** (static): no module that PRODUCES a ranking or
 *    calculation input (core-domain ranking / calculator / tax /
 *    optimizer / tripcalc, the product-search repository's ordering
 *    reads) and nothing in the backend trees references the badge
 *    component. The badge module is reachable only from display
 *    components under the product-detail and compare scopes.
 * 2. **Derivation-source pin** (static): the badge module's seller
 *    signal is exactly the published country equality (`country === 'FI'`)
 *    — the component reads no other input, so no hidden data path can
 *    exist by construction.
 * 3. **Output-identity** (dynamic): with the calculation's and ranking's
 *    own inputs held constant, the seller-country signal varies across
 *    fully separate compositions — a domestic FI seller (zero foreign
 *    badges), one foreign seller (one badge), many foreign sellers
 *    (badges on two countries) — and the landed-cost calculation, the
 *    €/g ranking over beer, and the beer product's detail response are
 *    byte-identical in all three. The varying product's own detail
 *    payload genuinely moves (FI → EE → EE+DE), proving the badge inputs
 *    varied while nothing else did (benchmarks-display-only non-vacuity
 *    pattern).
 *
 * Byte-proxy decision: compute/read-time stamps (`calculationTimestamp`,
 * nested `calculatedAt`, the reliability embed's `computedAt`) are
 * normalized away — the same decision
 * accuracy-unitprice-input-isolation.test.ts makes.
 *
 * Harness note: full app compositions via the api-worker route-test
 * harness by relative path; tests/compliance/vitest.config.ts resolves
 * the graph.
 *
 * @module DistanceSellingBadgesDisplayOnlyComplianceTest
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
} from '../../apps/api-worker/src/routes/__tests__/harness';

// ---------------------------------------------------------------------------
// Import-analysis helpers (accuracy-unitprice-input-isolation pattern)
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** Recursively collect non-test source files. */
function collectSourceFiles(
  dir: string,
  extensions: readonly string[] = ['.ts'],
  out: string[] = [],
): string[] {
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
      collectSourceFiles(full, extensions, out);
    } else if (
      extensions.some((ext) => entry.name.endsWith(ext)) &&
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

/** The modules whose OUTPUTS are ranking/calculation inputs. */
const INPUT_PRODUCING_FILES: readonly string[] = [
  ...CORE_INPUT_DIRS.flatMap((dir) => collectSourceFiles(dir)),
  PRODUCT_SEARCH_REPOSITORY,
];

const BADGE_MODULE = path.resolve(
  REPO_ROOT,
  'apps/frontend/src/app/[locale]/compare/components/SellingDistanceBadge.tsx',
);

/** The display scopes the badge module may be imported from. */
const BADGE_DISPLAY_SCOPES = [
  path.resolve(REPO_ROOT, 'apps/frontend/src/app/[locale]/products'),
  path.resolve(REPO_ROOT, 'apps/frontend/src/app/[locale]/compare'),
] as const;

/** Tokens that must never appear outside the display scopes. */
const BADGE_TOKENS = ['SellingDistanceBadge', 'sellingDistanceStatusOf'] as const;

// ===========================================================================
// 1. Import-analysis — the badge is display-only
// ===========================================================================

describe('import-analysis: ranking/calculation input producers never reference the distance-selling badge', () => {
  it('the specifier matcher itself can fire — the scan cannot pass vacuously', () => {
    expect(
      importedSpecifiers(
        `import { X } from './SellingDistanceBadge';\nexport * from './compare/SellingDistanceBadge';`,
      ),
    ).toEqual(['./SellingDistanceBadge', './compare/SellingDistanceBadge']);
    // Comments are stripped — prose may mention the component freely.
    expect(
      importedSpecifiers(`// renders SellingDistanceBadge\nconst x = 1;`),
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

  it('the badge module exists (the pins are not vacuous)', () => {
    expect(readFileSync(BADGE_MODULE, 'utf8')).toContain(
      'sellingDistanceStatusOf',
    );
  });

  it('no input-producing module references the badge component or its derivation', () => {
    for (const file of INPUT_PRODUCING_FILES) {
      const clean = stripComments(readFileSync(file, 'utf8'));
      for (const token of BADGE_TOKENS) {
        expect(
          clean.includes(token),
          `${file} must not reference ${token} — the badge is a display ` +
            'field, never a ranking/calculation input',
        ).toBe(false);
      }
    }
  });

  it('nothing in the backend trees references the badge component', () => {
    const backendFiles = collectSourceFiles(
      path.resolve(REPO_ROOT, 'apps/api-worker/src'),
      ['.ts', '.tsx'],
    ).concat(
      collectSourceFiles(path.resolve(REPO_ROOT, 'packages'), [
        '.ts',
        '.tsx',
      ]),
    );
    expect(backendFiles.length).toBeGreaterThan(0);
    for (const file of backendFiles) {
      const clean = stripComments(readFileSync(file, 'utf8'));
      for (const token of BADGE_TOKENS) {
        expect(clean.includes(token), `${file} must not reference ${token}`).toBe(
          false,
        );
      }
    }
  });

  it('the badge module is imported only from the display scopes', () => {
    const frontendFiles = collectSourceFiles(
      path.resolve(REPO_ROOT, 'apps/frontend/src'),
      ['.ts', '.tsx'],
    ).filter((file) => file !== BADGE_MODULE);

    const importers = frontendFiles.filter((file) =>
      specifiersOf(file).some((s) => s.includes('SellingDistanceBadge')),
    );
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) {
      expect(
        BADGE_DISPLAY_SCOPES.some((scope) => file.startsWith(scope)),
        `${file} imports the badge outside its display scopes`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// 2. Derivation-source pin — the signal is the published country only
// ===========================================================================

describe('derivation source: the badge reads the seller country and nothing else', () => {
  const source = stripComments(readFileSync(BADGE_MODULE, 'utf8'));

  it('the derivation is exactly the FI-seller equality', () => {
    expect(source).toContain("country === 'FI'");
    // No other comparison against a country literal can exist — a second
    // signal would make the derivation something other than the
    // seller-country signal the spec names.
    const literals = [...source.matchAll(/===\s*'([A-Z]{2})'/g)].map(
      (m) => m[1],
    );
    expect(literals).toEqual(['FI']);
  });

  it('the badge module imports display-layer modules only', () => {
    for (const specifier of specifiersOf(BADGE_MODULE)) {
      expect(
        // Relative display siblings, react, and the frontend-internal
        // '@/' alias (i18n navigation link + UI primitives) only — never
        // a backend or data-layer module specifier.
        /^\.{1,2}\//.test(specifier) ||
          specifier === 'react' ||
          specifier.startsWith('@/'),
        `unexpected import '${specifier}'`,
      ).toBe(true);
      expect(specifier.startsWith('@/lib/api'), 'no data-fetch layer').toBe(
        false,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Output-identity fixtures — calculation/ranking vs seller-country signal
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

/**
 * The CONSTANT input slice: one beer product with one domestic Alko
 * offer — the €/g ranking's beer input set and the beer product's entire
 * offer set, identical in every composition.
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
 * The VARYING badge slice — one display product whose SELLER COUNTRY
 * varies across the states (the exact signal the badges derive from):
 * - "zero": a domestic FI seller — the product page would show zero
 *   Etäosto badges (Etämyynti only);
 * - "one": one foreign (EE) seller — one Etäosto badge;
 * - "many": foreign sellers in EE and DE — badges on two countries.
 * The pinned beer inputs never move.
 */
function seedBadgeSignal(
  db: ReturnType<typeof openMigratedD1>['db'],
  states: readonly string[],
): void {
  seedProduct(db, { id: 2, name: 'Koevi Viini', category: 'wine_still', unitVolume: 0.75 });
  for (const [index, country] of states.entries()) {
    seedOffer(db, {
      id: 21 + index,
      productId: 2,
      merchant: `kauppa-${country.toLowerCase()}`,
      country,
      priceCents: 600 + index * 50,
      observedAt: '2026-02-01T10:00:00.000Z',
      reliabilityStatus: 'ESTIMATED',
    });
  }
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

// ===========================================================================
// 3. Output-identity: calculation and ranking vs badge signal
// ===========================================================================

describe('seller-country signal vs calculation/ranking output (fresh composition per state)', () => {
  it('zero, one, and many foreign-seller badges keep the calculation, ranking, and pinned detail byte-identical', async () => {
    const states = {
      zero: ['FI'],
      one: ['EE'],
      many: ['EE', 'DE'],
    } as const;
    const captured = new Map<
      keyof typeof states,
      {
        landedCost: Record<string, unknown>;
        ranking: Record<string, unknown>;
        detail: Record<string, unknown>;
        badgeSignalDetail: Record<string, unknown>;
      }
    >();

    for (const [state, countries] of Object.entries(states)) {
      const composition = openMigratedD1();
      seedConstantBeerSlice(composition.db);
      seedBadgeSignal(composition.db, countries);

      captured.set(state as keyof typeof states, {
        landedCost: await fire(composition.d1, '/api/v1/calculations/landed-cost', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...AGE },
          body: JSON.stringify(LANDED_COST_BODY),
        }),
        ranking: await fire(composition.d1, '/api/v1/unitprice/ranking?category=beer'),
        detail: await fire(composition.d1, '/api/v1/products/1'),
        badgeSignalDetail: await fire(composition.d1, '/api/v1/products/2'),
      });
    }

    const zero = captured.get('zero')!;

    // The three pinned outputs are byte-identical across ALL states —
    // the seller-country badge signal neither grew a key nor moved a
    // figure.
    for (const surface of ['landedCost', 'ranking', 'detail'] as const) {
      for (const state of ['one', 'many'] as const) {
        expect(bytes(captured.get(state)![surface]), `${surface}: ${state} vs zero`).toBe(
          bytes(zero[surface]),
        );
      }
    }
    // …and the keys themselves never grew — an additive leak would show
    // up as a new top-level field, not only a changed value.
    const landedCost = captured.get('one')!.landedCost;
    expect(Object.keys(landedCost).sort()).toEqual(Object.keys(zero.landedCost).sort());

    // Non-vacuity: the badge signal genuinely moved between the states —
    // the varying product's seller countries FI → EE → EE+DE — proving
    // these are different database states while the pinned outputs did
    // not move.
    const countriesOf = (body: Record<string, unknown>): string[] =>
      (body.offers as Array<{ country: string }>)
        .map((o) => o.country)
        .sort();

    expect(countriesOf(zero.badgeSignalDetail)).toEqual(['FI']);
    expect(countriesOf(captured.get('one')!.badgeSignalDetail)).toEqual(['EE']);
    expect(countriesOf(captured.get('many')!.badgeSignalDetail)).toEqual([
      'DE',
      'EE',
    ]);
    expect(bytes(zero.badgeSignalDetail)).not.toBe(
      bytes(captured.get('one')!.badgeSignalDetail),
    );
    expect(bytes(captured.get('one')!.badgeSignalDetail)).not.toBe(
      bytes(captured.get('many')!.badgeSignalDetail),
    );
  });
});
