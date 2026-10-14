/**
 * Merchant-reliability aggregate materialization tests (task 2.2, change
 * merchant-reliability-materialized-aggregates) — the 2026-10 D1 billing
 * incident's core invariant, pinned:

 * - FIGURE PARITY: the rows `handleMerchantReliabilityAggregates`
 *   materializes are byte-equal to the live per-merchant aggregate — the
 *   seed SELECT is read from the committed migration 0035 at test time
 *   (NOT an inline copy: if the migration's seed query is ever reworded,
 *   this test follows it instead of drifting, and a broken extraction
 *   fails loudly) — including the deterministic-latest rule (one row per
 *   merchant×product by `observed_at DESC, id DESC`, the ROW_NUMBER()
 *   translation of the pg DISTINCT ON query), the NULL-safe `IS NOT`
 *   ESTIMATED arm, and counts summing to offer_count;
 * - one `computed_at` instant across every row of a refresh, from the
 *   injected `now` (the seed's `strftime('now')` is the documented
 *   deviation — dropped field-wise before comparison);
 * - idempotent re-run converges: same rows, no duplicates, `computed_at`
 *   advances to the second `now`;
 * - a merchant whose offers all disappear loses its row same-tick;
 * - an empty catalog leaves the table honestly empty, reporting 0.
 *
 * Runs over the fake-D1 harness (node:sqlite + committed migrations),
 * the established pattern of freshness-ageing.test.ts.
 *
 * @module MerchantReliabilityAggregatesTest
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { handleMerchantReliabilityAggregates } from '../merchant-reliability-aggregates';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger } from '../../logger';
import type { Env } from '../../env';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Refresh instants — TICK_TWO is the next 30-minute aggregation tick. */
const TICK_ONE = '2026-09-01T12:00:00.000Z';
const TICK_TWO = '2026-09-01T12:30:00.000Z';

/** Observation instants, oldest to newest — lexical ISO order is the sort order. */
const T0 = '2026-08-10T00:00:00.000Z';
const T1 = '2026-08-11T00:00:00.000Z';
const T2 = '2026-08-12T00:00:00.000Z';
const T3 = '2026-08-13T00:00:00.000Z';

const LOG = createLogger('error');

function createDb(): { db: DatabaseSync; d1: ReturnType<typeof openMigratedD1>['d1'] } {
  const { db, d1 } = openMigratedD1();
  return { db, d1 };
}

async function seedProduct(db: DatabaseSync, id: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          alcohol_by_volume, unit_volume, container_type, regulatory_classification)
       VALUES (?, ?, 'Brewery', 'Brand', 'beer', 0.05, 0.33, 'can', 'beer')`,
    )
    .run(id, `Product ${id}`);
}

/** Seed one retail offer — only the columns the aggregate reads matter. */
async function seedOffer(
  db: DatabaseSync,
  id: number,
  merchant: string,
  productId: number,
  observedAt: string,
  status: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE',
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
          currency, observed_at, reliability_status)
       VALUES (?, ?, 'DE', ?, 250, 'EUR', ?, ?)`,
    )
    .run(id, merchant, productId, observedAt, status);
}

/**
 * The parity fixture: two merchants, two products each.
 *
 * - beverage-de product 1 has two observations — the later one (T3,
 *   ESTIMATED) must win over the older VERIFIED one;
 * - beverage-de product 2 has an `observed_at` TIE (T2) between an
 *   older-id STALE and a higher-id VERIFIED offer — `id DESC` must pick
 *   the VERIFIED one;
 * - vinoteka-fi product 4 has an older VERIFIED observation that must
 *   lose to the newer STALE one.
 *
 * Expected outcome: beverage-de = (2 offers: 1 verified, 1 estimated,
 * freshest T3), vinoteka-fi = (2 offers: 1 stale, 1 unavailable,
 * freshest T2). All four statuses appear; every row's counts sum to its
 * offer_count (the table's CHECK would reject the batch otherwise).
 */
async function seedParityCatalog(db: DatabaseSync): Promise<void> {
  for (const id of [1, 2, 3, 4]) await seedProduct(db, id);
  await seedOffer(db, 11, 'beverage-de', 1, T1, 'VERIFIED');
  await seedOffer(db, 12, 'beverage-de', 1, T3, 'ESTIMATED');
  await seedOffer(db, 21, 'beverage-de', 2, T2, 'STALE');
  await seedOffer(db, 22, 'beverage-de', 2, T2, 'VERIFIED');
  await seedOffer(db, 31, 'vinoteka-fi', 3, T2, 'UNAVAILABLE');
  await seedOffer(db, 32, 'vinoteka-fi', 4, T1, 'STALE');
  await seedOffer(db, 33, 'vinoteka-fi', 4, T0, 'VERIFIED');
}

// ---------------------------------------------------------------------------
// The live aggregate — migration 0035's seed SELECT, read at test time
// ---------------------------------------------------------------------------

/** Path of the committed migration whose seed query the handler re-runs. */
const MIGRATION_0035_SQL = new URL(
  '../../../../../packages/data-platform/src/d1/migrations/0035_merchant_reliability_aggregates.sql',
  import.meta.url,
).pathname;

/**
 * The migration-0035 seed `WITH ranked AS (…) SELECT …`, extracted from
 * the INSERT statement at test time — the parity reference. The seed's
 * `strftime('now')` computed_at arm rides along but is dropped field-wise
 * before comparison (the documented handler deviation; the table's
 * computed_at is asserted against the injected clock instead).
 */
function migrationSeedSelect(): string {
  const seedStatement =
    readFileSync(MIGRATION_0035_SQL, 'utf8')
      .split('--> statement-breakpoint')
      .pop() ?? '';
  const cteStart = seedStatement.indexOf('WITH ranked AS (');
  if (cteStart < 0) {
    throw new Error(
      'migration 0035: seed WITH…SELECT not found — the extraction must follow the migration',
    );
  }
  return seedStatement.slice(cteStart).trim().replace(/;$/, '');
}

/** One row of the migration seed SELECT (its computed_at is wall clock — ignored). */
interface SeedRow {
  readonly merchant: string;
  readonly offer_count: number;
  readonly verified_count: number;
  readonly estimated_count: number;
  readonly stale_count: number;
  readonly unavailable_count: number;
  readonly freshest_observed_at: string;
  readonly computed_at: string;
}

/** One materialized row — the aggregate table's full column set. */
interface AggregateRow {
  readonly merchant: string;
  readonly offer_count: number;
  readonly verified_count: number;
  readonly estimated_count: number;
  readonly stale_count: number;
  readonly unavailable_count: number;
  readonly freshest_observed_at: string;
  readonly computed_at: string;
}

/** Run the migration's own seed SELECT against the same DB — the live aggregate. */
function readLiveAggregate(db: DatabaseSync): SeedRow[] {
  return db.prepare(migrationSeedSelect()).all() as unknown as SeedRow[];
}

function readAggregateTable(db: DatabaseSync): AggregateRow[] {
  return db
    .prepare(`SELECT * FROM merchant_reliability_aggregates ORDER BY merchant ASC`)
    .all() as unknown as AggregateRow[];
}

/** The live rows as they must sit in the table, at the injected instant. */
function materializedExpectation(live: readonly SeedRow[], computedAt: string): AggregateRow[] {
  return live.map((row) => ({ ...row, computed_at: computedAt }));
}

/** The seven data columns — what survives a refresh unchanged. */
function dataColumns(row: AggregateRow): Omit<AggregateRow, 'computed_at'> {
  return {
    merchant: row.merchant,
    offer_count: row.offer_count,
    verified_count: row.verified_count,
    estimated_count: row.estimated_count,
    stale_count: row.stale_count,
    unavailable_count: row.unavailable_count,
    freshest_observed_at: row.freshest_observed_at,
  };
}

/** One refresh at a fixed instant — the handler's test seam (deps.db, deps.now). */
function runRefresh(d1: ReturnType<typeof openMigratedD1>['d1'], instant: string) {
  return handleMerchantReliabilityAggregates({ DB: d1 } as unknown as Env, LOG, {
    db: d1,
    now: () => new Date(instant),
  });
}

// ---------------------------------------------------------------------------
// Figure parity — the incident's core invariant
// ---------------------------------------------------------------------------

describe('handleMerchantReliabilityAggregates — figure parity', () => {
  it('materializes rows byte-equal to the migration-0035 seed SELECT', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);

    const result = await runRefresh(d1, TICK_ONE);

    expect(result.merchantsMaterialized).toBe(2);
    expect(result.computedAt).toBe(TICK_ONE);
    expect(readAggregateTable(db)).toEqual(
      materializedExpectation(readLiveAggregate(db), TICK_ONE),
    );
  });

  it('resolves the deterministic-latest rule: later observation wins, observed_at ties break by id DESC', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);

    await runRefresh(d1, TICK_ONE);

    const byMerchant = new Map(
      readAggregateTable(db).map((row) => [row.merchant, row]),
    );
    // beverage-de: product 1's later ESTIMATED (T3) beat the older
    // VERIFIED (T1); product 2's T2 tie went to the higher id (VERIFIED) —
    // an id ASC regression would flip this to stale_count 1.
    expect(byMerchant.get('beverage-de')).toEqual({
      merchant: 'beverage-de',
      offer_count: 2,
      verified_count: 1,
      estimated_count: 1,
      stale_count: 0,
      unavailable_count: 0,
      freshest_observed_at: T3,
      computed_at: TICK_ONE,
    });
    // vinoteka-fi: product 4's older VERIFIED (T0) lost to the newer
    // STALE (T1); the UNAVAILABLE observation on product 3 stands alone.
    expect(byMerchant.get('vinoteka-fi')).toEqual({
      merchant: 'vinoteka-fi',
      offer_count: 2,
      verified_count: 0,
      estimated_count: 0,
      stale_count: 1,
      unavailable_count: 1,
      freshest_observed_at: T2,
      computed_at: TICK_ONE,
    });
  });

  it('carries one computed_at instant per refresh, counts summing to offer_count', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);

    await runRefresh(d1, TICK_ONE);

    const table = readAggregateTable(db);
    expect(table.length).toBeGreaterThan(0);
    expect(new Set(table.map((row) => row.computed_at))).toEqual(
      new Set([TICK_ONE]),
    );
    for (const row of table) {
      expect(
        row.verified_count +
          row.estimated_count +
          row.stale_count +
          row.unavailable_count,
      ).toBe(row.offer_count);
    }
  });
});

// ---------------------------------------------------------------------------
// Idempotent re-run — convergence, no duplicates
// ---------------------------------------------------------------------------

describe('handleMerchantReliabilityAggregates — idempotent re-run', () => {
  it('converges: a second run yields the same rows with no duplicates, computed_at advanced', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);

    await runRefresh(d1, TICK_ONE);
    const afterFirst = readAggregateTable(db);

    await runRefresh(d1, TICK_TWO);
    const afterSecond = readAggregateTable(db);

    expect(afterSecond.map(dataColumns)).toEqual(afterFirst.map(dataColumns));
    // No duplicates: exactly one row per merchant, PK holds.
    expect(afterSecond).toHaveLength(afterFirst.length);
    expect(new Set(afterSecond.map((row) => row.merchant))).toEqual(
      new Set(['beverage-de', 'vinoteka-fi']),
    );
    // The refresh re-stamps the whole table at the new instant.
    expect(new Set(afterSecond.map((row) => row.computed_at))).toEqual(
      new Set([TICK_TWO]),
    );
  });
});

// ---------------------------------------------------------------------------
// Merchants whose offers disappear — dropped same-tick, others intact
// ---------------------------------------------------------------------------

describe('handleMerchantReliabilityAggregates — merchants dropped', () => {
  it('drops a merchant once its last offer is gone, leaving the others untouched', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);
    await runRefresh(d1, TICK_ONE);
    const afterFirst = readAggregateTable(db);

    await db.prepare(`DELETE FROM retail_offers WHERE merchant = 'vinoteka-fi'`).run();
    const result = await runRefresh(d1, TICK_TWO);

    expect(result.merchantsMaterialized).toBe(1);
    const table = readAggregateTable(db);
    expect(table.map((row) => row.merchant)).toEqual(['beverage-de']);
    // The surviving row is unchanged in its figures and re-stamped only
    // in computed_at — the full refresh touched nothing else.
    expect(table.map(dataColumns)).toEqual(
      afterFirst.filter((row) => row.merchant === 'beverage-de').map(dataColumns),
    );
    expect(table[0]?.computed_at).toBe(TICK_TWO);
  });
});

// ---------------------------------------------------------------------------
// Empty catalog — the table empties honestly, nothing synthesized
// ---------------------------------------------------------------------------

describe('handleMerchantReliabilityAggregates — empty catalog', () => {
  it('leaves the table empty with no error and reports 0 materialized', async () => {
    const { db, d1 } = createDb(); // no offers seeded at all

    const result = await runRefresh(d1, TICK_ONE);

    expect(result.merchantsMaterialized).toBe(0);
    expect(result.computedAt).toBe(TICK_ONE);
    expect(readAggregateTable(db)).toEqual([]);
  });
});
