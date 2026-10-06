/**
 * Compliance test: empirical-margin neutrality (task 2.2, change
 * hedge-dedup-confidence-meter; spec deltas: calculation-outcomes
 * "Persisted empirical margins" + landed-cost-calculator display-only
 * additions — design D3/D4).
 *
 * Deliberately independent of the task-2.1/2.2 route suites (the
 * compliance layer's second-opinion role, alko-benchmark-neutrality
 * precedent). What this file adds over HTTP on the FULL composition:
 *
 * 1. **Byte-identity across margin-store states** — the IDENTICAL
 *    calculator request is fired against three fully separate
 *    compositions (migrated D1 + full createApp(), fresh DO namespaces,
 *    cache MISS each): an EMPTY margins store, a GLOBAL-ONLY ladder, and
 *    the FULL three-rung ladder. Every calculated figure — total,
 *    itemized breakdown (VAT clock stripped), confidence,
 *    classification — must be byte-identical; only the optional
 *    `empiricalMargin` field may vary.
 * 2. **Deepest-floored-rung resolution over the wire** — the full-ladder
 *    run resolves the category×carrier cell, the global-only run the
 *    global cell, the empty run no field at all (non-vacuity: the field
 *    genuinely tracks the store).
 * 3. **Exclusion from the numbers** — the total equals the sum of the
 *    itemized lines in the margin-present body, and no margin vocabulary
 *    exists anywhere inside the itemized array.
 * 4. **Endpoint honesty** — `GET /api/v1/accuracy/margins` serves the
 *    honest empty shape (`margins: [], asOf: null`) on an untouched
 *    store and the persisted ladder with the run asOf on top after a
 *    refresh; nothing fabricated in either state.
 *
 * Byte-proxy decision: JSON.stringify minus the inherently volatile
 * fields — `metadata.calculationTimestamp`, `calculationRecordId`, and
 * the import-VAT line's per-compute `calculatedAt` (task 4.3's line
 * shape; the same legitimate variance category the alko suite strips).
 *
 * Harness note: the api-worker route-test harness is imported by
 * relative path exactly the way alko-benchmark-neutrality.test.ts does
 * (the composition it builds IS the code under test).
 *
 * @module EmpiricalMarginNeutralityComplianceTest
 */

import type { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';

import {
  buildApp,
  byteProxyWithoutMargin,
  MARGIN_LADDER_AS_OF,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedMarginLadder,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { handleOutcomeMargins } from '../../apps/api-worker/src/cron/outcome-margins';
import { createLogger } from '../../apps/api-worker/src/logger';
import { D1CalculationOutcomeRepository } from '../../packages/data-platform/src/repositories/d1/calculation-outcome.repository';
import type { D1DatabaseLike } from '../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Fixtures — the ONE calculation request, fired unchanged in every state
// ---------------------------------------------------------------------------

const AGE = { 'x-age-confirmed': 'confirmed' };

const CALC_BODY = JSON.stringify({
  productId: 1,
  quantity: 1,
  destination: 'FI',
  transportMethod: 'posti',
});

/**
 * The calculable dataset: beer product, foreign retail offer, both tax
 * rules, and the posti transport offer the request matches (DE → FI,
 * parcel up to 1 kg, seller-carried — a DistanceSelling result whose
 * import-VAT line the byte proxy clocks out).
 */
function seedSharedDataset(db: DatabaseSync): void {
  seedProduct(db, { id: 1, depositSystemStatus: 0 });
  seedOffer(db, {
    id: 11,
    productId: 1,
    merchant: 'kauppa',
    country: 'DE',
    priceCents: 250,
    observedAt: '2026-08-06T10:00:00.000Z',
  });
  seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
  seedTaxRule(db, {
    id: 2,
    taxType: 'container_duty',
    productCategory: 'all_beverages',
    rate: 0.51,
    verified: false,
    versionLabel: 'v2.0-2025',
  });
  db.prepare(
    `INSERT INTO transport_offers (id, carrier, origin_country, destination_country,
        weight_min_kg, weight_max_kg, package_tier, price_cents, seller_involvement_indicator)
     VALUES (90, 'posti', 'DE', 'FI', 0, 1, 'parcel', 150, 1)`,
  ).run();
}

/**
 * A global-only ladder: ten global-attributed reports (a pruned record —
 * no row 999 — carries no category/carrier) at 1% ⇒ exactly the global
 * cell (0.01, 10) calibrates; every deeper rung stays under the floor.
 */
async function seedGlobalOnlyLadder(
  db: DatabaseSync,
  d1: D1DatabaseLike,
): Promise<void> {
  let reporter = 300;
  for (let i = 0; i < 10; i += 1) {
    reporter += 1;
    seedAccount(db, {
      id: reporter,
      userId: `global-only-${reporter}`,
      email: `global-only-${reporter}@example.invalid`,
      tier: 'FREE',
    });
    await new D1CalculationOutcomeRepository(d1).create({
      calculationRecordId: 999,
      reporterAccountId: reporter,
      estimateDigest: { totalCents: 10_000 },
      estimatedTotalCents: 10_000,
      reportedTotalCents: 10_100,
    });
  }
  await handleOutcomeMargins(
    { DB: d1 } as never,
    createLogger('error'),
    { asOf: MARGIN_LADDER_AS_OF },
  );
}

/** Minimal response face — exact-field pins live in the route suites. */
interface CalcResponseJson {
  itemizedCosts: Array<{ label: string; category: string; cents: number }>;
  totalCents: number;
  currency: string;
  confidence: string;
  metadata: Record<string, unknown>;
  calculationRecordId: number;
  empiricalMargin?: Record<string, unknown>;
}

/** The per-run volatile fields the byte proxy strips (module doc). */
const VOLATILE = (clone: Record<string, any>): void => {
  clone.metadata.calculationTimestamp = '';
  clone.calculationRecordId = 0;
  for (const line of clone.itemizedCosts ?? []) {
    if (line.category === 'importVatEstimate') line.calculatedAt = '';
  }
};

/** Itemized lines with the import-VAT line's per-compute clock removed. */
function stableLines(
  body: CalcResponseJson,
): Array<Record<string, unknown>> {
  return body.itemizedCosts.map((line) => {
    const wide = line as Record<string, unknown>;
    if (wide.category !== 'importVatEstimate') return wide;
    const { calculatedAt: _vatClock, ...rest } = wide;
    return rest;
  });
}

/** Metadata without the per-compute clock read. */
function stableMetadata(body: CalcResponseJson): Record<string, unknown> {
  const { calculationTimestamp: _clock, ...rest } =
    body.metadata as Record<string, unknown>;
  return rest;
}

/** One full composition (own migrated D1 + app + fresh DO namespaces). */
async function runScenario(
  store: 'empty' | 'global-only' | 'full',
): Promise<CalcResponseJson> {
  const { db, d1 } = openMigratedD1();
  seedSharedDataset(db);
  if (store === 'global-only') await seedGlobalOnlyLadder(db, d1);
  if (store === 'full') await seedMarginLadder(db, d1);
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
// 1–2. Byte-identity across margin-store states + deepest-rung resolution
// ===========================================================================

describe('calculation output vs margin-store state (fresh compute per composition)', () => {
  it('is byte-identical across empty, global-only, and full ladders while only empiricalMargin varies', async () => {
    const empty = await runScenario('empty');
    const globalOnly = await runScenario('global-only');
    const full = await runScenario('full');

    // The calculation bytes are identical across all three store states —
    // totals, breakdown, confidence, classification never move.
    expect(byteProxyWithoutMargin(empty, VOLATILE)).toBe(
      byteProxyWithoutMargin(full, VOLATILE),
    );
    expect(byteProxyWithoutMargin(globalOnly, VOLATILE)).toBe(
      byteProxyWithoutMargin(full, VOLATILE),
    );

    // Named projections, pinned explicitly against the empty-store run
    // (clock-free faces — the clocks legitimately differ per compute).
    for (const run of [globalOnly, full]) {
      expect(run.totalCents).toBe(empty.totalCents);
      expect(run.currency).toBe(empty.currency);
      expect(run.confidence).toBe(empty.confidence);
      expect(stableMetadata(run)).toEqual(stableMetadata(empty));
      expect(stableLines(run)).toEqual(stableLines(empty));
    }

    // Non-vacuity — the field genuinely tracks the store: absent on an
    // empty ladder, the global cell on a global-only ladder, and the
    // DEEPEST floored rung (category×carrier) on the full ladder.
    expect(empty).not.toHaveProperty('empiricalMargin');
    expect(globalOnly.empiricalMargin).toEqual({
      quantile: 0.01,
      sampleCount: 10,
      cell: { dimension: 'global', key: 'global' },
      asOf: MARGIN_LADDER_AS_OF.toISOString(),
    });
    expect(full.empiricalMargin).toEqual({
      quantile: 0.01,
      sampleCount: 10,
      cell: { dimension: 'category_carrier', key: 'beer|posti' },
      asOf: MARGIN_LADDER_AS_OF.toISOString(),
    });
  });

  it('never lets the margin enter the numbers — the total is the itemized sum with the field present', async () => {
    const full = await runScenario('full');
    // The total is exactly the itemized sum, and no margin vocabulary
    // exists anywhere in the breakdown.
    const itemizedSum = full.itemizedCosts.reduce((sum, line) => sum + line.cents, 0);
    expect(full.totalCents).toBe(itemizedSum);
    expect(JSON.stringify(full.itemizedCosts)).not.toContain('empiricalMargin');
    expect(JSON.stringify(full.itemizedCosts)).not.toContain('quantile');
  });
});

// ===========================================================================
// 3. Endpoint honesty — GET /api/v1/accuracy/margins
// ===========================================================================

describe('GET /api/v1/accuracy/margins — honest states', () => {
  it('serves the honest empty shape on an untouched store', async () => {
    const { d1 } = openMigratedD1();
    const res = await request(buildApp(), permissiveEnv(d1), '/api/v1/accuracy/margins');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ margins: [], asOf: null });
  });

  it('serves the persisted ladder deepest-first with the run asOf on top', async () => {
    const { db, d1 } = openMigratedD1();
    await seedMarginLadder(db, d1);

    const res = await request(buildApp(), permissiveEnv(d1), '/api/v1/accuracy/margins');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      margins: [
        { dimension: 'category_carrier', key: 'beer|posti', quantile: 0.01, sampleCount: 10, asOf: MARGIN_LADDER_AS_OF.toISOString() },
        { dimension: 'category', key: 'beer', quantile: 0.02, sampleCount: 12, asOf: MARGIN_LADDER_AS_OF.toISOString() },
        { dimension: 'global', key: 'global', quantile: 0.05, sampleCount: 16, asOf: MARGIN_LADDER_AS_OF.toISOString() },
      ],
      asOf: MARGIN_LADDER_AS_OF.toISOString(),
    });
  });
});
