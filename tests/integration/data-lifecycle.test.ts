/**
 * Integration test — data lifecycle coverage (task 8.3, change
 * technical-assessment-remediation, specs application-api "Calculation
 * record retention" + product-data-model "Price observations as a
 * TimescaleDB hypertable").
 *
 * Runs against a REAL PostgreSQL (timescale/timescaledb:2.16.1-pg16
 * image, migrations 0000-0016 applied — 0013 partitions the
 * calculation-record tables, 0014 converts price_observations to a
 * hypertable) and proves the lifecycle mechanics that plain unit tests
 * cannot:
 *
 *   1. Partition pruning correctness — the retention sweep
 *      (CalculationRecordRetentionService) prunes anonymous-session
 *      rows past the cutoff, drops fully-expired anonymous-only
 *      monthly partitions, keeps partitions holding authenticated
 *      history, stages DEFAULT-partition rows into newly created
 *      partitions, and EXPLAIN shows partition pruning rather than
 *      scans of every partition.
 *   2. Hypertable query parity — the same queries (watermark-shaped
 *      aggregation scan, range reads, earliest read) return identical
 *      results from the hypertable and from a plain-table fixture
 *      populated with the same rows; the timescaledb extension is
 *      installed and storage is chunked, with EXPLAIN showing chunk
 *      exclusion for range-bounded scans.
 *   3. Watermark scan — the real TimeSeriesAggregationWorker over the
 *      real Drizzle repositories advances the persisted aggregation
 *      watermark as observations are appended, picks up same-instant
 *      late appends through the inclusive boundary re-scan, and never
 *      regresses.
 *
 * ## TEST_DATABASE_URL gate
 *
 * Activates only when TEST_DATABASE_URL is set (schema applied),
 * exactly like gdpr-integration.test.ts. Without it the suites skip
 * with an explanatory message so CI without infrastructure stays
 * green.
 *
 * Every assertion compares database-sourced values against
 * database-sourced values (never against the JS Date that was
 * inserted), with raw-SQL timestamps cast to canonical UTC text
 * (`tsText`): node-pg parses `timestamp` columns as local wall time
 * while Drizzle maps them as UTC, so Date-object comparisons across
 * the two readers would break on any non-UTC host.
 *
 * @module DataLifecycleIntegrationTest
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';

import type { PriceObservation } from '@rajahinta/core-domain';
import {
  CalculationRecordRetentionService,
  DrizzleAggregationWatermarkRepository,
  DrizzleBasketCalculationRecordRepository,
  DrizzleCalculationRecordRepository,
  DrizzlePriceHistorySummaryRepository,
  DrizzlePriceObservationRepository,
  DrizzleProductRepository,
  DrizzleProvider,
  retailOffers,
  type DrizzleDatabase,
} from '@rajahinta/data-platform';
// Worker class is not re-exported from the application-api package
// index — deep import (same convention as historical-price-flow).
import {
  TimeSeriesAggregationWorker,
  startOfUtcDay,
  type TimeSeriesAggregationJobData,
} from '../../packages/application-api/src/jobs/workers/time-series-aggregation.worker';
import type { Job } from 'bullmq';
import { QUEUES } from '../../packages/data-acquisition/src/index';

// ---------------------------------------------------------------------------
// Infrastructure gate
// ---------------------------------------------------------------------------

const PG_URL = process.env.TEST_DATABASE_URL ?? null;

if (!PG_URL) {
  console.log(
    '\n  ⏭️  Data-lifecycle tests SKIPPED — TEST_DATABASE_URL not set.\n' +
      '  Apply migrations 0000-0016 to a timescale/timescaledb:2.16.1-pg16\n' +
      '  instance and export TEST_DATABASE_URL to run them.\n',
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** pg result rows helper — drizzle's execute returns the raw pg result. */
type Rows<T> = { rows: T[] };

async function raw<T>(db: DrizzleDatabase, query: string): Promise<T[]> {
  const result = (await db.execute(sql.raw(query))) as unknown as Rows<T>;
  return result.rows;
}

async function endPool(db: DrizzleDatabase): Promise<void> {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
}

function makeJob(data: TimeSeriesAggregationJobData): Job<TimeSeriesAggregationJobData> {
  return { data, attemptsMade: 0 } as unknown as Job<TimeSeriesAggregationJobData>;
}

/** UTC first-of-month instant `offset` months from `now`. */
function monthStart(now: Date, offset: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

/** YYYY_MM partition tag for a first-of-month instant. */
function monthTag(start: Date): string {
  return start.toISOString().slice(0, 7).replace('-', '_');
}

/** SQL timestamp literal ('YYYY-MM-DD HH:MM:SS') from a JS instant. */
function tsLiteral(instant: Date): string {
  return instant.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Canonical UTC text for a timestamp expression in raw SQL.
 *
 * Raw db.execute rows are parsed by node-pg (local timezone) while
 * Drizzle maps the same column as UTC — comparing Date objects across
 * the two readers breaks on any non-UTC host. Casting to text in SQL
 * pins both sides to the stored UTC wall-clock string, which matches
 * `date.toISOString().slice(0, 23)` of any Drizzle-read value.
 */
const TS_TEXT = "to_char(%s, 'YYYY-MM-DD\"T\"HH24:MI:SS.MS')";
const tsText = (expr: string) => TS_TEXT.replace('%s', expr);
/** The comparable string form of a Drizzle-read timestamp Date. */
const tsString = (date: Date) => date.toISOString().slice(0, 23);

async function relationExists(db: DrizzleDatabase, name: string): Promise<boolean> {
  const rows = await raw<{ present: boolean }>(
    db,
    `SELECT to_regclass('${name}') IS NOT NULL AS present`,
  );
  return rows[0].present;
}

/** Monthly partitions of a table (excluding DEFAULT), with parsed range ends. */
async function listPartitions(
  db: DrizzleDatabase,
  table: string,
): Promise<{ name: string; rangeEnd: Date }[]> {
  const rows = await raw<{ name: string; bound: string }>(
    db,
    `SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
     FROM pg_inherits i
     JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = '${table}'::regclass
       AND c.relkind = 'r'
       AND c.relname <> '${table}_default'`,
  );
  return rows.flatMap((row) => {
    const match = /FOR VALUES FROM \('([^']+)'\) TO \('([^']+)'\)/.exec(row.bound);
    return match ? [{ name: row.name, rangeEnd: new Date(match[2]) }] : [];
  });
}

async function createMonthlyPartition(
  db: DrizzleDatabase,
  table: string,
  start: Date,
): Promise<void> {
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "${table}_${monthTag(start)}" PARTITION OF "${table}" ` +
        `FOR VALUES FROM ('${start.toISOString().slice(0, 10)}') TO ('${end.toISOString().slice(0, 10)}')`,
    ),
  );
}

async function dropPartitionIfExists(db: DrizzleDatabase, name: string): Promise<void> {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${name}"`));
}

/** Seed a product row; returns its id. */
async function seedProduct(db: DrizzleDatabase, name: string): Promise<number> {
  const repo = new DrizzleProductRepository(db);
  const product = await repo.create({
    name,
    manufacturer: 'Lifecycle Fixture Brewery',
    brand: 'Lifecycle Fixture',
    category: 'beer',
    alcoholByVolume: '0.0500',
    unitVolume: '0.5000',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: null,
  });
  return product.id;
}

/** Seed a retail offer; returns its id. */
async function seedOffer(db: DrizzleDatabase, productId: number): Promise<number> {
  const [offer] = await db
    .insert(retailOffers)
    .values({
      merchant: 'lifecycle-fixture-merchant',
      country: 'DE',
      productId,
      priceCents: 199,
      currency: 'EUR',
      availability: 'in_stock',
      sourceUrl: 'https://merchant.example.com/lifecycle-fixture',
      reliabilityStatus: 'VERIFIED',
    })
    .returning({ id: retailOffers.id });
  return offer.id;
}

/** Observation fixture for the real repository append path. */
function observation(
  productId: number,
  retailOfferId: number,
  merchant: string,
  observedAt: Date,
  priceCents: number,
): PriceObservation {
  return {
    productId,
    merchant,
    retailOfferId,
    observedAt,
    foreignRetailPriceCents: priceCents,
    transportOfferId: null,
    transportCostCents: 0,
    exciseRuleVersion: null,
    containerDutyRuleVersion: null,
    landedCostCents: priceCents + 100,
    inputReliability: {
      retailPrice: 'VERIFIED',
      transport: 'VERIFIED',
      exciseRule: 'VERIFIED',
      containerDutyRule: 'VERIFIED',
    },
    confidence: 'HIGH',
  };
}

// ===========================================================================
// Suite 1 — calculation-record partition lifecycle (retention policy)
// ===========================================================================

describe.skipIf(!PG_URL)('calculation-record partition lifecycle — retention sweep', () => {
  const MARKER_PRODUCT = 'Data Lifecycle Partition Fixture (lifecycle-test)';
  const MARKER_DESTINATION = 'lifecycle-partition-test';
  const SESSION_AUTH_OLD = 'lifecycle-test:auth-old';
  const SESSION_AUTH_RECENT = 'lifecycle-test:auth-recent';
  const SESSION_AUTH_STAGED = 'lifecycle-test:auth-staged';
  const RETENTION_DAYS = 30;

  const now = new Date();
  /** Anonymous-only, fully expired → dropped by the sweep. */
  const monthA = monthStart(now, -4);
  /** Expired but holds an authenticated row → kept by the sweep. */
  const monthB = monthStart(now, -3);
  /** No dedicated partition → anonymous row here exercises row-level pruning. */
  const monthDefaultOld = monthStart(now, -5);
  /** Future partition the sweep must create, staging DEFAULT rows into it. */
  const monthAhead = monthStart(now, 2);

  const CALC = 'calculation_records';
  const BASKET = 'basket_calculation_records';

  let db: DrizzleDatabase;
  let calcRepo: DrizzleCalculationRecordRepository;
  let basketRepo: DrizzleBasketCalculationRecordRepository;
  let retention: CalculationRecordRetentionService;
  let productId: number;
  let run1: Awaited<ReturnType<CalculationRecordRetentionService['runRetention']>>;
  let run2: Awaited<ReturnType<CalculationRecordRetentionService['runRetention']>>;

  const cutoff = (): Date => new Date(now.getTime() - RETENTION_DAYS * 86_400_000);

  const calcFixture = (calculatedAt: Date, sessionId: string | null) => ({
    productMasterId: productId,
    retailOfferIds: null,
    transportOfferId: null,
    exciseRuleVersionId: null,
    containerDutyRuleVersionId: null,
    totalCents: 100,
    breakdown: {},
    confidence: 'HIGH',
    quantity: 1,
    destination: 'FI',
    disclaimer: 'integration fixture',
    sessionId,
    calculatedAt,
  });

  const basketFixture = (createdAt: Date, sessionId: string | null) => ({
    sessionId,
    destination: MARKER_DESTINATION,
    transportArrangement: 'SELF_ARRANGEMENT',
    inputBasket: {},
    shipmentBreakdown: {},
    totalCents: 100,
    confidence: 'HIGH',
    disclaimer: 'integration fixture',
    createdAt,
  });

  beforeAll(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = PG_URL;
    try {
      db = DrizzleProvider.useFactory();
      calcRepo = new DrizzleCalculationRecordRepository(db);
      basketRepo = new DrizzleBasketCalculationRecordRepository(db);
      retention = new CalculationRecordRetentionService(db);

      // --- Pre-clean any leftovers from an earlier run of this suite ---
      // Old-month partitions can only be fixture leftovers (nothing in
      // production creates past partitions); drop every partition whose
      // range lies entirely in the past.
      for (const table of [CALC, BASKET]) {
        for (const partition of await listPartitions(db, table)) {
          if (partition.rangeEnd.getTime() < now.getTime()) {
            await dropPartitionIfExists(db, partition.name);
          }
        }
        // The sweep-lead partition from an earlier run — drop so THIS
        // run observes the service creating it (migration only creates
        // the current and next month).
        await dropPartitionIfExists(db, `${table}_${monthTag(monthAhead)}`);
      }
      await db.execute(
        sql`DELETE FROM calculation_records WHERE product_master_id IN (SELECT id FROM product_master WHERE name = ${MARKER_PRODUCT})`,
      );
      await db.execute(
        sql`DELETE FROM basket_calculation_records WHERE destination = ${MARKER_DESTINATION}`,
      );
      await db.execute(
        sql`DELETE FROM product_master WHERE name = ${MARKER_PRODUCT}`,
      );

      // --- Seed fixtures ---
      productId = await seedProduct(db, MARKER_PRODUCT);
      await createMonthlyPartition(db, CALC, monthA);
      await createMonthlyPartition(db, CALC, monthB);
      await createMonthlyPartition(db, BASKET, monthA);
      await createMonthlyPartition(db, BASKET, monthB);

      const dayOf = (start: Date) => new Date(start.getTime() + 86_400_000);
      // calculation_records — six rows across four policy positions.
      await calcRepo.create(calcFixture(dayOf(monthA), null)); // expired anonymous → pruned (partition A then dropped)
      await calcRepo.create(calcFixture(new Date(monthA.getTime() + 2 * 86_400_000), null)); // expired anonymous → pruned
      await calcRepo.create(calcFixture(dayOf(monthB), null)); // expired anonymous → pruned (partition B kept: authenticated row)
      await calcRepo.create(calcFixture(new Date(monthB.getTime() + 2 * 86_400_000), SESSION_AUTH_OLD)); // expired authenticated → kept
      await calcRepo.create(calcFixture(dayOf(monthDefaultOld), null)); // expired anonymous in DEFAULT → pruned
      await calcRepo.create(calcFixture(now, null)); // recent anonymous → kept
      await calcRepo.create(calcFixture(now, SESSION_AUTH_RECENT)); // recent authenticated → kept
      await calcRepo.create(calcFixture(dayOf(monthAhead), SESSION_AUTH_STAGED)); // future row in DEFAULT → staged into new partition
      // basket_calculation_records — mirrored four prunable positions.
      await basketRepo.create(basketFixture(dayOf(monthA), null));
      await basketRepo.create(basketFixture(new Date(monthA.getTime() + 2 * 86_400_000), null));
      await basketRepo.create(basketFixture(dayOf(monthB), null));
      await basketRepo.create(basketFixture(new Date(monthB.getTime() + 2 * 86_400_000), SESSION_AUTH_OLD));
      await basketRepo.create(basketFixture(dayOf(monthDefaultOld), null));
      await basketRepo.create(basketFixture(now, null));
      await basketRepo.create(basketFixture(now, SESSION_AUTH_RECENT));
      await basketRepo.create(basketFixture(dayOf(monthAhead), SESSION_AUTH_STAGED));

      // --- The sweep under test (fixed clock: month math and cutoff
      // stay consistent with the fixture instants above) ---
      run1 = await retention.runRetention({ now, retentionDays: RETENTION_DAYS });
      run2 = await retention.runRetention({ now, retentionDays: RETENTION_DAYS });
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  afterAll(async () => {
    if (db === undefined) return;
    try {
      // Remove fixture rows (parent deletes route to every partition)…
      await db.execute(
        sql`DELETE FROM calculation_records WHERE product_master_id = ${productId}`,
      );
      await db.execute(
        sql`DELETE FROM basket_calculation_records WHERE destination = ${MARKER_DESTINATION}`,
      );
      // …then restore the partition baseline the migration created:
      // drop the fixture partitions (monthA is already gone) and the
      // sweep-lead partitions this run created.
      for (const table of [CALC, BASKET]) {
        await dropPartitionIfExists(db, `${table}_${monthTag(monthA)}`);
        await dropPartitionIfExists(db, `${table}_${monthTag(monthB)}`);
        await dropPartitionIfExists(db, `${table}_${monthTag(monthAhead)}`);
      }
      await db.execute(sql`DELETE FROM product_master WHERE id = ${productId}`);
    } finally {
      await endPool(db);
    }
  });

  it('creates monthly partitions for the current and future months ahead of the write head', async () => {
    for (const table of [CALC, BASKET]) {
      for (const offset of [0, 1, 2]) {
        const start = monthStart(now, offset);
        expect(
          await relationExists(db, `${table}_${monthTag(start)}`),
          `${table}_${monthTag(start)} should exist after the sweep`,
        ).toBe(true);
      }
    }
    // Migration 0013 created the current and next month; the +2 lead
    // partition is the sweep's own work.
    expect(run1.createdPartitions).toContain(`${CALC}_${monthTag(monthAhead)}`);
    expect(run1.createdPartitions).toContain(`${BASKET}_${monthTag(monthAhead)}`);
  });

  it('stages DEFAULT-partition rows into the newly created partition that takes over their range', async () => {
    const stagedPartition = `${CALC}_${monthTag(monthAhead)}`;
    // The row moved out of the DEFAULT partition…
    const [inDefault] = await raw<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM ${CALC}_default WHERE session_id = '${SESSION_AUTH_STAGED}'`,
    );
    expect(Number(inDefault.count)).toBe(0);
    // …into the dedicated monthly partition, byte-identical…
    const [inPartition] = await raw<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM ${stagedPartition} WHERE session_id = '${SESSION_AUTH_STAGED}'`,
    );
    expect(Number(inPartition.count)).toBe(1);
    // …and still readable through the parent table by the repository.
    const rows = await calcRepo.findBySession(SESSION_AUTH_STAGED);
    expect(rows).toHaveLength(1);
    expect(rows[0].calculatedAt.getTime()).toBe(
      new Date(monthAhead.getTime() + 86_400_000).getTime(),
    );
  });

  it('prunes exactly the anonymous rows past the cutoff and keeps authenticated and recent rows', async () => {
    // Four expired anonymous rows per table: two in partition A, one in
    // partition B, one in the DEFAULT partition.
    expect(run1.prunedAnonymous[CALC]).toBe(4);
    expect(run1.prunedAnonymous[BASKET]).toBe(4);

    // Nothing anonymous survives below the cutoff…
    const [calcAnon] = await raw<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM ${CALC} WHERE session_id IS NULL AND calculated_at < '${tsLiteral(cutoff())}'`,
    );
    expect(Number(calcAnon.count)).toBe(0);
    const [basketAnon] = await raw<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM ${BASKET} WHERE session_id IS NULL AND created_at < '${tsLiteral(cutoff())}'`,
    );
    expect(Number(basketAnon.count)).toBe(0);

    // …while the expired authenticated row and both recent rows remain.
    expect(await calcRepo.findBySession(SESSION_AUTH_OLD)).toHaveLength(1);
    expect(await calcRepo.findBySession(SESSION_AUTH_RECENT)).toHaveLength(1);
    const [recentAnon] = await raw<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM ${CALC} WHERE session_id IS NULL AND calculated_at >= '${tsLiteral(cutoff())}'`,
    );
    expect(Number(recentAnon.count)).toBe(1);
  });

  it('drops fully-expired anonymous-only partitions and keeps expired partitions with authenticated history', async () => {
    // Partition A (anonymous-only, expired) is dropped for both tables.
    expect(run1.droppedPartitions).toContain(`${CALC}_${monthTag(monthA)}`);
    expect(run1.droppedPartitions).toContain(`${BASKET}_${monthTag(monthA)}`);
    expect(await relationExists(db, `${CALC}_${monthTag(monthA)}`)).toBe(false);

    // Partition B (expired but holds the authenticated row) survives.
    expect(run1.droppedPartitions).not.toContain(`${CALC}_${monthTag(monthB)}`);
    expect(await relationExists(db, `${CALC}_${monthTag(monthB)}`)).toBe(true);
    expect(await calcRepo.findBySession(SESSION_AUTH_OLD)).toHaveLength(1);
  });

  it('a second sweep is idempotent — nothing new pruned, dropped, or created', async () => {
    expect(run2.createdPartitions).toEqual([]);
    expect(run2.droppedPartitions).toEqual([]);
    expect(run2.prunedAnonymous[CALC]).toBe(0);
    expect(run2.prunedAnonymous[BASKET]).toBe(0);
    // The authenticated history is still there after the second sweep.
    expect(await calcRepo.findBySession(SESSION_AUTH_OLD)).toHaveLength(1);
    expect(await calcRepo.findBySession(SESSION_AUTH_STAGED)).toHaveLength(1);
  });

  it('prunes partitions in the plan instead of scanning every partition', async () => {
    // EXPLAIN (no ANALYZE — nothing executes) of the exact prune shape
    // the retention service runs.
    const planRows = await raw<{ 'QUERY PLAN': string }>(
      db,
      `EXPLAIN DELETE FROM ${CALC} WHERE session_id IS NULL AND calculated_at < '${tsLiteral(cutoff())}'`,
    );
    const plan = planRows.map((row) => row['QUERY PLAN']).join('\n');

    // The scan cannot skip the DEFAULT partition (it can hold any
    // range) nor partition B (its range overlaps the cutoff)…
    expect(plan).toContain(`${CALC}_default`);
    expect(plan).toContain(`${CALC}_${monthTag(monthB)}`);
    // …but the current and future monthly partitions — whose ranges lie
    // entirely at/after the cutoff — must be pruned from the plan
    // rather than scanned.
    for (const offset of [0, 1, 2]) {
      expect(plan).not.toContain(`${CALC}_${monthTag(monthStart(now, offset))}`);
    }
    // The ModifyTable node carries one "Delete on <partition>" entry per
    // NON-pruned partition — exactly the two that can hold matching rows.
    const scanned = plan.match(/Delete on calculation_records_\S+/g) ?? [];
    expect(scanned).toHaveLength(2);
    // …while the partitioned table itself has all five partitions: the
    // current month, two ahead, month B, and the DEFAULT. The three
    // absent ones were pruned from the plan at planning time (Postgres
    // omits plan-time-pruned subplans entirely rather than reporting
    // them as "Subplans Removed", which only covers executor-time
    // pruning).
    const partitionsTotal = (await listPartitions(db, CALC)).length + 1; // + DEFAULT
    expect(partitionsTotal).toBeGreaterThanOrEqual(5);
  });});

// ===========================================================================
// Suite 2 — price_observations hypertable parity + watermark scan
// ===========================================================================

describe.skipIf(!PG_URL)('price_observations hypertable — chunking, parity, watermark', () => {
  const MARKER_PRODUCT = 'Data Lifecycle Hypertable Fixture (lifecycle-test)';
  const PLAIN_TABLE = 'price_observations_plain_lifecycle';
  const DAY_MS = 86_400_000;

  let db: DrizzleDatabase;
  let productId: number;
  let offerId: number;
  let observations: DrizzlePriceObservationRepository;
  let summaries: DrizzlePriceHistorySummaryRepository;
  let watermarks: DrizzleAggregationWatermarkRepository;
  let worker: TimeSeriesAggregationWorker;

  beforeAll(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = PG_URL;
    try {
      db = DrizzleProvider.useFactory();
      observations = new DrizzlePriceObservationRepository(db);
      summaries = new DrizzlePriceHistorySummaryRepository(db);
      watermarks = new DrizzleAggregationWatermarkRepository(db);
      worker = new TimeSeriesAggregationWorker(observations, summaries, watermarks);

      // --- Pre-clean leftovers from an earlier run of this suite ---
      await db.execute(sql.raw(`DROP TABLE IF EXISTS ${PLAIN_TABLE}`));
      await db.execute(
        sql`DELETE FROM price_history_summaries WHERE product_id IN (SELECT id FROM product_master WHERE name = ${MARKER_PRODUCT})`,
      );
      await db.execute(
        sql`DELETE FROM price_observations WHERE product_id IN (SELECT id FROM product_master WHERE name = ${MARKER_PRODUCT})`,
      );
      await db.execute(
        sql`DELETE FROM aggregation_watermarks WHERE job_name = ${QUEUES.TIME_SERIES_AGGREGATION}`,
      );
      await db.execute(
        sql`DELETE FROM retail_offers WHERE merchant = 'lifecycle-fixture-merchant'`,
      );
      await db.execute(
        sql`DELETE FROM product_master WHERE name = ${MARKER_PRODUCT}`,
      );

      // --- Seed: five observations across ≥ 3 chunks (7-day chunking) ---
      productId = await seedProduct(db, MARKER_PRODUCT);
      offerId = await seedOffer(db, productId);
      const anchor = Date.now();
      const parityRows: readonly [number, string, number][] = [
        [anchor - 25 * DAY_MS, 'parity-merchant-a', 200],
        [anchor - 18 * DAY_MS, 'parity-merchant-b', 210],
        [anchor - 11 * DAY_MS, 'parity-merchant-a', 220],
        [anchor - 4 * DAY_MS, 'parity-merchant-b', 230],
        [anchor - 1 * 3_600_000, 'parity-merchant-a', 240],
      ];
      for (const [at, merchant, price] of parityRows) {
        await observations.append(
          observation(productId, offerId, merchant, new Date(at), price),
        );
      }

      // --- Plain-table fixture: same rows, no hypertable machinery ---
      await db.execute(
        sql.raw(
          `CREATE TABLE ${PLAIN_TABLE} AS SELECT * FROM price_observations WHERE product_id = ${productId}`,
        ),
      );
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  afterAll(async () => {
    if (db === undefined) return;
    try {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS ${PLAIN_TABLE}`));
      await db.execute(
        sql`DELETE FROM price_history_summaries WHERE product_id = ${productId}`,
      );
      await db.execute(sql`DELETE FROM price_observations WHERE product_id = ${productId}`);
      await db.execute(
        sql`DELETE FROM aggregation_watermarks WHERE job_name = ${QUEUES.TIME_SERIES_AGGREGATION}`,
      );
      await db.execute(
        sql`DELETE FROM retail_offers WHERE id = ${offerId}`,
      );
      await db.execute(sql`DELETE FROM product_master WHERE id = ${productId}`);
    } finally {
      await endPool(db);
    }
  });

  // ------------------------------------------------------------------
  // Extension + registration + chunking
  // ------------------------------------------------------------------

  it('has the timescaledb extension installed and price_observations registered as a hypertable', async () => {
    const extensions = await raw<{ extname: string }>(
      db,
      `SELECT extname FROM pg_extension WHERE extname = 'timescaledb'`,
    );
    expect(extensions).toHaveLength(1);

    const hypertables = await raw<{ hypertable_name: string }>(
      db,
      `SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'price_observations'`,
    );
    expect(hypertables).toHaveLength(1);
  });

  it('stores the fixture across multiple time chunks (7-day chunk interval)', async () => {
    const chunks = await raw<{ chunk_name: string; range_start: Date; range_end: Date }>(
      db,
      `SELECT chunk_name, range_start, range_end FROM timescaledb_information.chunks
       WHERE hypertable_name = 'price_observations' ORDER BY range_start`,
    );
    // 25 days of fixtures at a 7-day interval → at least 4 chunks.
    expect(chunks.length).toBeGreaterThanOrEqual(4);
  });

  // ------------------------------------------------------------------
  // Query parity — hypertable vs plain table, repository vs SQL
  // ------------------------------------------------------------------

  it('returns identical watermark-shaped aggregation scans from the hypertable and a plain table', async () => {
    const since = tsLiteral(new Date(Date.now() - 30 * DAY_MS));
    const query = (table: string) =>
      raw<{ product_id: number; first_observed_at: string; last_observed_at: string }>(
        db,
        `SELECT product_id, ${tsText('min(observed_at)')} AS first_observed_at, ${tsText('max(observed_at)')} AS last_observed_at
         FROM ${table} WHERE observed_at >= '${since}'
         GROUP BY product_id ORDER BY product_id`,
      );

    const fromHypertable = await query('price_observations');
    const fromPlain = await query(PLAIN_TABLE);
    expect(fromHypertable).toEqual(fromPlain);
    expect(fromHypertable).toHaveLength(1);

    // The repository's findProductActivitySince (the worker's actual
    // watermark scan) agrees with the same SQL on the hypertable.
    const activity = await observations.findProductActivitySince(new Date(Date.now() - 30 * DAY_MS));
    expect(activity).toHaveLength(1);
    expect(activity[0].productId).toBe(fromHypertable[0].product_id);
    expect(tsString(activity[0].firstObservedAt)).toBe(fromHypertable[0].first_observed_at);
    expect(tsString(activity[0].lastObservedAt)).toBe(fromHypertable[0].last_observed_at);
  });

  it('returns identical range reads from the hypertable and a plain table', async () => {
    const from = tsLiteral(new Date(Date.now() - 30 * DAY_MS));
    const to = tsLiteral(new Date(Date.now() + DAY_MS));

    const rangeQuery = (table: string, merchant?: string) =>
      raw<{
        id: number;
        merchant: string;
        observed_at: string;
        foreign_retail_price_cents: number;
        landed_cost_cents: number;
      }>(
        db,
        `SELECT id, merchant, ${tsText('observed_at')} AS observed_at, foreign_retail_price_cents, landed_cost_cents
         FROM ${table}
         WHERE product_id = ${productId} AND observed_at >= '${from}' AND observed_at < '${to}'` +
          (merchant ? ` AND merchant = '${merchant}'` : '') +
          ` ORDER BY observed_at ASC, id ASC`,
      );

    // Product-wide range read.
    expect(await rangeQuery('price_observations')).toEqual(await rangeQuery(PLAIN_TABLE));
    // Merchant-filtered range read.
    expect(
      await rangeQuery('price_observations', 'parity-merchant-a'),
    ).toEqual(await rangeQuery(PLAIN_TABLE, 'parity-merchant-a'));

    // The repository's range read agrees with the same SQL on the
    // hypertable (order and values, including the id tiebreak).
    const repoRows = await observations.findByProductRange(
      productId,
      new Date(Date.now() - 30 * DAY_MS),
      new Date(Date.now() + DAY_MS),
    );
    const sqlRows = await rangeQuery('price_observations');
    expect(repoRows.map((r) => [r.id, r.merchant, tsString(r.observedAt), r.foreignRetailPriceCents, r.landedCostCents]))
      .toEqual(sqlRows.map((r) => [r.id, r.merchant, r.observed_at, r.foreign_retail_price_cents, r.landed_cost_cents]));

    // Earliest-observation read — the API's attribution lower bound.
    const earliestRepo = await observations.findEarliestObservedAt(productId);
    const [earliestSql] = await raw<{ observed_at: string }>(
      db,
      `SELECT ${tsText('observed_at')} AS observed_at FROM ${PLAIN_TABLE} WHERE product_id = ${productId} ORDER BY observed_at ASC LIMIT 1`,
    );
    expect(earliestRepo ? tsString(earliestRepo) : null).toBe(earliestSql.observed_at);
  });

  it('excludes out-of-range chunks from range-bounded scan plans', async () => {
    const chunks = await raw<{ chunk_name: string; range_start: Date; range_end: Date }>(
      db,
      `SELECT chunk_name, range_start, range_end FROM timescaledb_information.chunks
       WHERE hypertable_name = 'price_observations' ORDER BY range_start`,
    );
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // A window strictly inside ONE middle chunk.
    const middle = chunks[Math.floor(chunks.length / 2)];
    const windowFrom = tsLiteral(new Date(new Date(middle.range_start).getTime() + 60_000));
    const windowTo = tsLiteral(new Date(new Date(middle.range_end).getTime() - 60_000));

    const planRows = await raw<{ 'QUERY PLAN': string }>(
      db,
      `EXPLAIN SELECT * FROM price_observations WHERE observed_at >= '${windowFrom}' AND observed_at < '${windowTo}'`,
    );
    const plan = planRows.map((row) => row['QUERY PLAN']).join('\n');

    // The one overlapping chunk is scanned…
    expect(plan).toContain(middle.chunk_name);
    // …and no other chunk appears in the plan — they were excluded.
    for (const chunk of chunks) {
      if (chunk.chunk_name !== middle.chunk_name) {
        expect(plan).not.toContain(chunk.chunk_name);
      }
    }
  });

  // ------------------------------------------------------------------
  // Watermark scan — real worker, real repositories, real table
  // ------------------------------------------------------------------

  it('advances the watermark from null to the log high-water mark on the first run', async () => {
    await worker.process(makeJob({}));

    const [maxRow] = await raw<{ max: string | null }>(
      db,
      `SELECT ${tsText('max(observed_at)')} AS max FROM price_observations`,
    );
    const persisted = await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION);
    expect(persisted ? tsString(persisted) : null).toBe(maxRow.max);

    // Every fixture day has a materialized daily summary bucket.
    const days = await raw<{ d: string }>(
      db,
      `SELECT DISTINCT to_char(observed_at, 'YYYY-MM-DD') AS d FROM price_observations WHERE product_id = ${productId} ORDER BY d`,
    );
    expect(days).toHaveLength(5);
    for (const { d } of days) {
      const rows = await summaries.findByProductRange(productId, 'daily', d, d);
      expect(rows, `daily bucket ${d}`).toHaveLength(1);
      expect(rows[0].observationCount).toBe(1);
    }
  });

  it('advances the watermark further as newer observations are appended', async () => {
    const before = await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION);

    const appended = await observations.append(
      observation(productId, offerId, 'watermark-merchant', new Date(Date.now() - 30 * 60_000), 250),
    );
    expect(appended.id).toBeGreaterThan(0);

    await worker.process(makeJob({}));

    const [maxRow] = await raw<{ max: string | null }>(
      db,
      `SELECT ${tsText('max(observed_at)')} AS max FROM price_observations`,
    );
    const after = await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION);
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    expect(tsString(after!)).toBe(maxRow.max);
  });

  it('picks up a same-instant late append via the inclusive boundary re-scan without regressing or advancing the watermark', async () => {
    const before = await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION);
    expect(before).not.toBeNull();

    // Append at EXACTLY the watermark instant — strictly-bounded scans
    // would permanently miss it; the inclusive >= watermark must not.
    const instant = new Date(before!.getTime());
    await observations.append(
      observation(productId, offerId, 'watermark-merchant', instant, 260),
    );

    await worker.process(makeJob({}));

    // Watermark neither regressed nor advanced past the instant.
    const after = await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION);
    expect(after!.getTime()).toBe(before!.getTime());

    // The bucket containing the instant absorbed the late row: the
    // product-wide daily summary reflects BOTH observations now.
    const day = startOfUtcDay(instant);
    const dayStr = day.toISOString().slice(0, 10);
    const [expectedCount] = await raw<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM price_observations
       WHERE product_id = ${productId} AND observed_at >= '${tsLiteral(day)}' AND observed_at < '${tsLiteral(new Date(day.getTime() + DAY_MS))}'`,
    );
    const rows = await summaries.findByProductRange(productId, 'daily', dayStr, dayStr);
    expect(rows).toHaveLength(1);
    expect(rows[0].observationCount).toBe(Number(expectedCount.count));
    // The late append sorts last within the instant (higher id), so it
    // sets the close price.
    expect(rows[0].priceCloseCents).toBe(260);
  });

  it('leaves the watermark unchanged when a run finds no new observations', async () => {
    const before = await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION);
    await worker.process(makeJob({}));
    const after = await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION);
    expect(after!.getTime()).toBe(before!.getTime());
  });
});
