/**
 * Compliance test: trip-feasibility affiliate neutrality (task 5.5,
 * change product-roadmap-phases-1-4; spec trip-feasibility-calculator
 * "Neutral affiliate slot" — "the calculation result SHALL be
 * byte-identical" with zero, one, or many affiliate rows; design R8 —
 * "calculation output is byte-identical whether or not affiliate rows
 * exist").
 *
 * Deliberately independent of the task-5.3 route-unit suite (the
 * compliance layer's second-opinion role, neutrality-compliance.test.ts
 * precedent). What this file adds:
 *
 * 1. **Byte-identity across database states, fresh compute each** — the
 *    IDENTICAL trip-feasibility request is fired against three fully
 *    separate compositions (migrated D1 + createApp +
 *    registerTripFeasibilityRoutes, exactly as
 *    tests/integration/d1/event-calc.d1.test.ts drives the stack), with
 *    0 / 1 / 3 PUBLISHED ferry_offers rows. Each run answers as a cache
 *    MISS, so the computation path itself is observed — the idempotency
 *    cache cannot mask a difference. The calculation portion (response
 *    minus the `ferryOffers` block) must be byte-identical, and the
 *    route's canonical X-Content-Hash (SHA-256 of the serialized
 *    calculation result) must match across all three. Non-vacuity: the
 *    ferry block itself must vary with the row count.
 * 2. **Empty-vs-seeded database on ONE composition** — the ferry table
 *    goes from empty to seeded between two identical requests; the
 *    second answer is a cache HIT (the cached half), its calculation
 *    bytes and hash unchanged, while the freshly-read ferry block
 *    reflects the new rows — the cache stores only the calculation.
 * 3. **Source level** — every INPUT type declaration in
 *    packages/core-domain/src/tripcalc/*.ts is read from disk and
 *    asserted free of affiliate/offers vocabulary (the price-alerts d1
 *    suite's readFileSync-scan pattern): the pure module's inputs
 *    structurally cannot carry affiliate data.
 *
 * Byte-proxy decision: `JSON.stringify` of the calculation projection is
 * the byte proxy — the same proxy the 5.3 route suite uses for this
 * exact requirement — plus the route's own X-Content-Hash as the
 * canonical cross-run digest. `TripCalcResult` is pure and deterministic
 * on identical inputs (no timestamp field; tripcalc module docs), and
 * only 200 bodies are compared (the error envelope's timestamp is not
 * involved), so the stringify proxy is faithful. R8's "calculation
 * output" is taken as the response body minus the separate `ferryOffers`
 * block — the split the 5.3 route builds by construction.
 *
 * Harness note: tests/compliance has no D1-harness precedent, so the
 * api-worker route-test harness is imported by relative path exactly the
 * way the integration d1 tests import it (the composition it builds IS
 * the code under test); tests/compliance/vitest.config.ts carries the
 * same alias/plugin block vitest.config.d1.ts uses for that import
 * graph.
 *
 * @module TripAffiliateNeutralityComplianceTest
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  createApp,
  openMigratedD1,
  permissiveEnv,
  request,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { registerTripFeasibilityRoutes } from '../../apps/api-worker/src/routes/trip-feasibility.routes';
import { D1TravellerAllowancesRepository } from '../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';
import { D1FerryOffersRepository } from '../../packages/data-platform/src/repositories/d1/ferry-offers.repository';
import type { Env } from '../../apps/api-worker/src/env';
import type { D1DatabaseLike } from '../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fixtures and composition — identical request in every run
// ---------------------------------------------------------------------------

const CITATION =
  'Commission Directive 2007/74/EC, Annex (https://eur-lex.europa.example/32007L0074)';

/** Append one allowance version and publish it — the only PUBLISHED path. */
async function seedPublishedAllowances(d1: D1DatabaseLike): Promise<void> {
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

/** The ONE request body fired unchanged in every scenario. */
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

/** Full production composition (index.ts wiring: flag gate + limiter + route). */
function tripApp(): ReturnType<typeof createApp> {
  const app = createApp();
  registerTripFeasibilityRoutes(app);
  return app;
}

function tripEnv(d1: D1DatabaseLike): Env {
  return permissiveEnv(d1, { FF_TRIP_CALCULATOR: 'true' });
}

async function postTrip(
  app: ReturnType<typeof createApp>,
  env: Env,
): Promise<Response> {
  return request(app, env, '/api/v1/trip-feasibility', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(TRIP),
  });
}

/** Minimal response projection — exact-field pins live in the 5.3 suite. */
interface FerryRefJson {
  id: number;
  operator: string;
  routeLabel: string;
  redirectPath: string;
}

interface TripJson {
  status: string;
  ferryOffers?: FerryRefJson[];
}

/**
 * The calculation bytes: the response minus the separate ferry block —
 * the R8 "calculation output" (see module docs for the byte-proxy
 * decision).
 */
function calculationBytes(body: TripJson): string {
  const { ferryOffers: _ferry, ...calc } = body;
  return JSON.stringify(calc);
}

// ===========================================================================
// 1. Byte-identity with zero, one, many PUBLISHED ferry rows
//    (spec scenario: "Affiliate presence changes nothing")
// ===========================================================================

describe('calculation output vs ferry-row count (fresh compute per composition)', () => {
  it('is byte-identical with zero, one, and many PUBLISHED ferry rows while the ferry block itself varies', async () => {
    const runs: {
      ferryCount: number;
      hash: string | null;
      bytes: string;
      body: TripJson;
    }[] = [];

    for (const ferryCount of [0, 1, 3]) {
      // A fully separate composition per database state: own migrated D1,
      // own app, own DO namespaces — the request is answered by a FRESH
      // computation (MISS), never a cache lookup.
      const { d1 } = openMigratedD1();
      await seedPublishedAllowances(d1);
      for (let i = 0; i < ferryCount; i++) {
        await seedPublishedFerry(d1, {
          operator: `Operator ${i}`,
          url: `https://www.operator${i}.example/route`,
        });
      }
      const app = tripApp();

      const res = await postTrip(app, tripEnv(d1));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Cache')).toBe('MISS');
      const body = (await res.json()) as TripJson;
      runs.push({
        ferryCount,
        hash: res.headers.get('X-Content-Hash'),
        bytes: calculationBytes(body),
        body,
      });
    }

    const [zero, one, many] = runs;

    // The calculation bytes are identical across all three database states…
    expect(one.bytes).toBe(zero.bytes);
    expect(many.bytes).toBe(zero.bytes);
    // …and so is the route's canonical hash of the calculation result.
    expect(one.hash).not.toBeNull();
    expect(one.hash).toBe(zero.hash);
    expect(many.hash).toBe(zero.hash);

    // Non-vacuity: the ferry block itself varies with the row count —
    // the scenarios are genuinely different database states.
    expect(zero.body.ferryOffers).toEqual([]);
    expect(one.body.ferryOffers).toHaveLength(1);
    expect(many.body.ferryOffers).toHaveLength(3);
    expect(many.body.ferryOffers!.map((o) => o.operator)).toEqual([
      'Operator 0',
      'Operator 1',
      'Operator 2',
    ]);
    expect(JSON.stringify(zero.body)).not.toBe(JSON.stringify(one.body));
    expect(JSON.stringify(one.body)).not.toBe(JSON.stringify(many.body));
    expect(JSON.stringify(zero.body)).not.toBe(JSON.stringify(many.body));

    // The block exposes redirect paths only — no raw affiliate url ever
    // crosses into the public payload (R8).
    for (const run of [one, many]) {
      expect(JSON.stringify(run.body)).not.toContain('.example/route');
      for (const offer of run.body.ferryOffers ?? []) {
        expect(Object.keys(offer).sort()).toEqual([
          'id',
          'operator',
          'redirectPath',
          'routeLabel',
        ]);
      }
    }
  });
});

// ===========================================================================
// 2. Empty-vs-seeded database on ONE composition — cache HIT keeps the
//    calculation byte-identical while the ferry block is read fresh
// ===========================================================================

describe('empty-vs-seeded database on one composition', () => {
  it('keeps the cached calculation byte-identical when ferry rows appear; the block reflects them on the HIT', async () => {
    const { d1 } = openMigratedD1();
    await seedPublishedAllowances(d1);
    const app = tripApp();
    const env = tripEnv(d1);

    // Empty ferry table.
    const empty = await postTrip(app, env);
    expect(empty.status).toBe(200);
    expect(empty.headers.get('X-Cache')).toBe('MISS');
    const emptyBody = (await empty.json()) as TripJson;
    expect(emptyBody.ferryOffers).toEqual([]);
    const emptyBytes = calculationBytes(emptyBody);
    const emptyHash = empty.headers.get('X-Content-Hash');
    expect(emptyHash).not.toBeNull();

    // The table goes empty → seeded BETWEEN two IDENTICAL requests.
    await seedPublishedFerry(d1, {
      operator: 'Viking Line',
      url: 'https://www.vikingline.example/minifarty',
    });
    await seedPublishedFerry(d1, {
      operator: 'Eckerö Line',
      url: 'https://www.eckero.example/mini',
    });

    const seeded = await postTrip(app, env);
    expect(seeded.status).toBe(200);
    expect(seeded.headers.get('X-Cache')).toBe('HIT');
    const seededBody = (await seeded.json()) as TripJson;

    // The calculation half is untouched — same bytes, same canonical hash.
    expect(calculationBytes(seededBody)).toBe(emptyBytes);
    expect(seeded.headers.get('X-Content-Hash')).toBe(emptyHash);

    // Non-vacuity: the ferry block was read FRESH on the hit — it changed
    // under the identical cached calculation.
    expect(seededBody.ferryOffers).toHaveLength(2);
    expect(seededBody.ferryOffers!.map((o) => o.operator)).toEqual([
      'Eckerö Line',
      'Viking Line',
    ]);
    expect(JSON.stringify(seededBody)).not.toBe(JSON.stringify(emptyBody));
    expect(JSON.stringify(seededBody)).not.toContain('vikingline.example');
    expect(JSON.stringify(seededBody)).not.toContain('eckero.example');
  });
});

// ===========================================================================
// 3. Source level — the module's input types carry no affiliate vocabulary
//    (price-alerts d1 suite's readFileSync-scan pattern)
// ===========================================================================

/** The tripcalc module directory — the pure calculation module. */
const TRIPCALC_DIR = path.resolve(
  import.meta.dirname,
  '../../packages/core-domain/src/tripcalc',
);

/**
 * Every INPUT type of the module (tripcalc.types.ts): the trip facts +
 * prices carrier and its nested allowance/price rows. If one is renamed,
 * the "found" assertion below forces this list to be updated — the scan
 * cannot silently skip a renamed type.
 */
const TRIPCALC_INPUT_TYPES = [
  'TripAllowanceLimitRow',
  'TripResolvedAllowances',
  'TripCategoryPriceInput',
  'TripCalcInput',
] as const;

/** Affiliate/offers vocabulary — must never appear in an input type. */
const AFFILIATE_VOCABULARY =
  /affiliate|ferry|offer|partner|sponsor|promo|advertis|commission/i;

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

describe('tripcalc input types are affiliate-free at source level', () => {
  it('the vocabulary matcher itself can fire — the scan cannot pass vacuously', () => {
    expect(AFFILIATE_VOCABULARY.test('readonly ferryOffers: FerryRef[]')).toBe(
      true,
    );
    expect(AFFILIATE_VOCABULARY.test('affiliateUrl')).toBe(true);
    expect(AFFILIATE_VOCABULARY.test('readonly passengers: number')).toBe(
      false,
    );
  });

  it('no input type declaration in packages/core-domain/src/tripcalc/*.ts mentions affiliate/offers vocabulary', () => {
    const files = readdirSync(TRIPCALC_DIR)
      .filter((f) => f.endsWith('.ts'))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    const found = new Set<string>();
    for (const file of files) {
      const source = readFileSync(path.join(TRIPCALC_DIR, file), 'utf8');
      for (const name of TRIPCALC_INPUT_TYPES) {
        const block = extractDeclaration(source, name);
        if (block === null) continue;
        found.add(name);
        expect(
          block,
          `${file}::${name} must not carry affiliate/offers vocabulary — ` +
            'the calculation input structurally cannot include affiliate data (R8)',
        ).not.toMatch(AFFILIATE_VOCABULARY);
      }
    }

    // Every listed input type was actually located and scanned.
    expect([...found].sort()).toEqual([...TRIPCALC_INPUT_TYPES].sort());
  });
});
