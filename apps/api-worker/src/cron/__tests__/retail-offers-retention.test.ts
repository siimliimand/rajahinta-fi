/**
 * Retail-offers retention cron tests (task 3.1, change
 * d1-read-cost-reduction; design D4) — over the fake-D1 harness
 * (node:sqlite + committed migrations, the
 * merchant-reliability-aggregates.test.ts pattern):
 *
 * - dry-run is the default and deletes nothing;
 * - live mode deletes only superseded rows past the 30-day window — each
 *   pair's deterministic-latest row survives even when it is itself older
 *   than the window (pinned against migration 0035's own seed SELECT:
 *   the live aggregate is byte-equal before and after retention);
 * - in-window rows survive, including the cutoff boundary (strict <);
 * - batches are bounded: capped runs stop with candidates remaining and
 *   every DELETE is an id-list delete (no unbounded DELETE);
 * - re-runs are idempotent;
 * - the history contract holds: materialized summaries for deleted
 *   windows survive untouched, and the observation-log layout carries
 *   every copied LANDED_COST citation field.
 *
 * @module RetailOffersRetentionTest
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import {
  handleRetailOffersRetention,
  RETENTION_WINDOW_DAYS,
  RETAIL_OFFERS_RETENTION_CRON,
  LandedCostProvenanceRefusalError,
} from '../retail-offers-retention';
import { RETENTION_CRON } from '../retention-sweep';
import {
  parseObservationLog,
  serializeObservationLog,
} from '../../../../../packages/data-platform/src/d1/observation-log';
import type { ObservationLogRecord } from '../../../../../packages/data-platform/src/d1/observation-log';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger } from '../../logger';
import type { Env } from '../../env';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOG = createLogger('error');

/** The nightly tick — cutoff = 2026-09-25T03:30:00.000Z. */
const NOW = new Date('2026-10-25T03:30:00.000Z');
const DAY = 86_400_000;
const CUTOFF = new Date(+NOW - RETENTION_WINDOW_DAYS * DAY).toISOString();

const T_OLD_SUPERSEDED = new Date(+NOW - 40 * DAY).toISOString();
const T_OLD_LATEST = new Date(+NOW - 35 * DAY).toISOString();
const T_TIE = '2026-09-05T00:00:00.000Z';
const T_IN_WINDOW = new Date(+NOW - 20 * DAY).toISOString();
const T_FRESH = new Date(+NOW - 10 * DAY).toISOString();

function createDb(): { db: DatabaseSync; d1: D1DatabaseLike } {
  return openMigratedD1();
}

function envWith(d1: D1DatabaseLike): Env {
  return { DB: d1 } as unknown as Env;
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

async function seedOffer(
  db: DatabaseSync,
  id: number,
  merchant: string,
  productId: number,
  observedAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
          currency, observed_at, reliability_status)
       VALUES (?, ?, 'DE', ?, 250, 'EUR', ?, 'ESTIMATED')`,
    )
    .run(id, merchant, productId, observedAt);
}

function offerIds(db: DatabaseSync): number[] {
  return (
    db.prepare('SELECT id FROM retail_offers ORDER BY id').all() as {
      id: number;
    }[]
  ).map((row) => row.id);
}

/**
 * The parity fixture: four (merchant, product_id) pairs.
 *
 * - (beverage-de, 1): 11 @ −40d superseded by 12 @ −35d — 11 is
 *   deletable; 12 is the pair's deterministic-latest AND older than the
 *   window, so it must survive;
 * - (beverage-de, 2): an observed_at TIE at T_TIE — `id DESC` keeps 22,
 *   21 is deletable;
 * - (vinoteka-fi, 3): 31 @ −20d is superseded but IN-window (survives),
 *   32 @ −10d is the latest;
 * - (vinoteka-fi, 4): 41 sits exactly AT the cutoff (not `< cutoff`, so
 *   not deletable) under 42 @ −1d.
 *
 * Deletable = {11, 21}; survivors = {12, 22, 31, 32, 41, 42}.
 */
async function seedParityCatalog(db: DatabaseSync): Promise<void> {
  for (const id of [1, 2, 3, 4]) await seedProduct(db, id);
  await seedOffer(db, 11, 'beverage-de', 1, T_OLD_SUPERSEDED);
  await seedOffer(db, 12, 'beverage-de', 1, T_OLD_LATEST);
  await seedOffer(db, 21, 'beverage-de', 2, T_TIE);
  await seedOffer(db, 22, 'beverage-de', 2, T_TIE);
  await seedOffer(db, 31, 'vinoteka-fi', 3, T_IN_WINDOW);
  await seedOffer(db, 32, 'vinoteka-fi', 3, T_FRESH);
  await seedOffer(db, 41, 'vinoteka-fi', 4, CUTOFF);
  await seedOffer(db, 42, 'vinoteka-fi', 4, new Date(+NOW - DAY).toISOString());
}

/** Seven pairs, each with one old superseded row and one fresh latest. */
async function seedBacklog(db: DatabaseSync): Promise<void> {
  for (let i = 1; i <= 7; i++) {
    await seedProduct(db, i);
    await seedOffer(db, i * 10, 'beverage-de', i, '2026-09-01T00:00:00.000Z');
    await seedOffer(db, i * 10 + 1, 'beverage-de', i, '2026-10-20T00:00:00.000Z');
  }
}

async function seedSummary(
  db: DatabaseSync,
  id: number,
  productId: number,
  periodStart: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO price_history_summaries (id, granularity, period_start, product_id,
          price_open_cents, price_close_cents, price_min_cents, price_max_cents, price_avg_cents,
          landed_cost_open_cents, landed_cost_close_cents, landed_cost_min_cents,
          landed_cost_max_cents, landed_cost_avg_cents, observation_count, strictest_reliability)
       VALUES (?, 'daily', ?, ?, 100, 110, 90, 120, 105, 200, 210, 190, 220, 205, 3, 'ESTIMATED')`,
    )
    .run(id, periodStart, productId);
}

// ---------------------------------------------------------------------------
// Migration 0035's own seed SELECT — the deterministic-latest reference
// ---------------------------------------------------------------------------

const MIGRATION_0035_SQL = new URL(
  '../../../../../packages/data-platform/src/d1/migrations/0035_merchant_reliability_aggregates.sql',
  import.meta.url,
).pathname;

/** The committed seed `WITH ranked AS (…) SELECT …`, read at test time. */
function readLiveAggregate(db: DatabaseSync): Array<Record<string, unknown>> {
  const seedStatement =
    readFileSync(MIGRATION_0035_SQL, 'utf8')
      .split('--> statement-breakpoint')
      .pop() ?? '';
  const cteStart = seedStatement.indexOf('WITH ranked AS (');
  if (cteStart < 0) {
    throw new Error('migration 0035: seed WITH…SELECT not found');
  }
  return db
    .prepare(seedStatement.slice(cteStart).trim().replace(/;$/, ''))
    .all() as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Dry-run first — the default deletes nothing
// ---------------------------------------------------------------------------

describe('handleRetailOffersRetention — dry-run first', () => {
  it('defaults to dry-run: reports candidates and window bounds, deletes nothing', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);

    const result = await handleRetailOffersRetention(envWith(d1), LOG, {
      now: NOW,
    });

    expect(result.mode).toBe('dry-run');
    expect(result.deleted).toBe(0);
    expect(result.candidates).toBe(2);
    expect(result.cutoffIso).toBe(CUTOFF);
    expect(result.exhausted).toBe(true);
    expect(offerIds(db)).toEqual([11, 12, 21, 22, 31, 32, 41, 42]);
  });
});

// ---------------------------------------------------------------------------
// Live mode — only superseded past-window rows go
// ---------------------------------------------------------------------------

describe('handleRetailOffersRetention — live mode', () => {
  it('deletes superseded rows past the window; the deterministic-latest row survives even when old', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);

    const result = await handleRetailOffersRetention(envWith(d1), LOG, {
      now: NOW,
      mode: 'live',
    });

    expect(result.mode).toBe('live');
    expect(result.deleted).toBe(2);
    // 12 survived despite being 35 days old — it is its pair's rn=1 row;
    // the T_TIE pair kept the higher id (22), the migration-0035 tie-break.
    expect(offerIds(db)).toEqual([12, 22, 31, 32, 41, 42]);
    // The real pre-flight audit ran and holds (recorded finding).
    expect(result.provenance.holds).toBe(true);
  });

  it('keeps in-window superseded rows, including exactly at the cutoff boundary', async () => {
    const { db, d1 } = createDb();
    for (const id of [1, 2, 3]) await seedProduct(db, id);
    await seedOffer(db, 1, 'beverage-de', 1, '2026-09-25T03:29:59.999Z'); // < cutoff → deletable
    await seedOffer(db, 2, 'beverage-de', 1, CUTOFF); // superseded, but not < cutoff
    await seedOffer(db, 3, 'beverage-de', 1, new Date(+NOW - DAY).toISOString());

    const result = await handleRetailOffersRetention(envWith(d1), LOG, {
      now: NOW,
      mode: 'live',
    });

    expect(result.deleted).toBe(1);
    expect(offerIds(db)).toEqual([2, 3]);
  });

  it('leaves the migration-0035 live aggregate byte-equal — retention never moves rn=1', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);
    const before = readLiveAggregate(db);
    expect(before.length).toBeGreaterThan(0);

    await handleRetailOffersRetention(envWith(d1), LOG, {
      now: NOW,
      mode: 'live',
    });

    expect(readLiveAggregate(db).map(({ computed_at: _ignored, ...row }) => row)).toEqual(
      before.map(({ computed_at: _ignored, ...row }) => row),
    );
  });
});

// ---------------------------------------------------------------------------
// Bounded batches — capped sweeps and id-list deletes only
// ---------------------------------------------------------------------------

/** Wrap the harness so every prepared statement's SQL is recorded. */
function recordingD1(d1: D1DatabaseLike): {
  d1: D1DatabaseLike;
  statements: () => string[];
} {
  const recorded: string[] = [];
  const wrapped: D1DatabaseLike = {
    prepare(sql: string) {
      recorded.push(sql);
      return d1.prepare(sql);
    },
    batch: (statements) => d1.batch(statements),
  };
  return { d1: wrapped, statements: () => recorded };
}

describe('handleRetailOffersRetention — batch bounds', () => {
  it('stops at the batch cap with candidates remaining; every DELETE is a bounded id list', async () => {
    const { db, d1 } = createDb();
    await seedBacklog(db);
    const recorder = recordingD1(d1);

    const result = await handleRetailOffersRetention(envWith(d1), LOG, {
      db: recorder.d1,
      now: NOW,
      mode: 'live',
      batchSize: 3,
      maxBatches: 2,
    });

    expect(result.batchesRun).toBe(2);
    expect(result.deleted).toBe(6);
    expect(result.candidates).toBe(6);
    expect(result.exhausted).toBe(false);

    const deletes = recorder
      .statements()
      .filter((sql) => sql.startsWith('DELETE FROM retail_offers'));
    expect(deletes).toHaveLength(2);
    for (const sql of deletes) {
      // Bounded id-list delete — never a table-wide DELETE.
      expect(sql).toMatch(/^DELETE FROM retail_offers WHERE id IN \(\?(?:, \?)*\)$/);
      expect((sql.match(/\?/g) ?? []).length).toBe(3);
    }
    // 7 deletable rows existed; the cap left exactly one.
    expect(offerIds(db)).toHaveLength(14 - 6);
  });

  it('drains the capped remainder on the next run', async () => {
    const { db, d1 } = createDb();
    await seedBacklog(db);

    await handleRetailOffersRetention(envWith(d1), LOG, {
      now: NOW,
      mode: 'live',
      batchSize: 3,
      maxBatches: 2,
    });
    const second = await handleRetailOffersRetention(envWith(d1), LOG, {
      now: NOW,
      mode: 'live',
      batchSize: 3,
    });

    expect(second.deleted).toBe(1);
    expect(second.exhausted).toBe(true);
    expect(offerIds(db)).toEqual(
      Array.from({ length: 7 }, (_, i) => i * 10 + 11),
    );
  });
});

// ---------------------------------------------------------------------------
// Idempotent re-run
// ---------------------------------------------------------------------------

describe('handleRetailOffersRetention — idempotent re-run', () => {
  it('deletes nothing on a second live run over the converged table', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);

    const first = await handleRetailOffersRetention(envWith(d1), LOG, {
      now: NOW,
      mode: 'live',
    });
    const afterFirst = offerIds(db);
    const second = await handleRetailOffersRetention(envWith(d1), LOG, {
      now: NOW,
      mode: 'live',
    });

    expect(first.deleted).toBe(2);
    expect(second.deleted).toBe(0);
    expect(second.candidates).toBe(0);
    expect(second.exhausted).toBe(true);
    expect(offerIds(db)).toEqual(afterFirst);
  });
});

// ---------------------------------------------------------------------------
// History contract — summaries survive, the log layout carries citations
// ---------------------------------------------------------------------------

describe('handleRetailOffersRetention — history contract', () => {
  it('leaves materialized summaries for deleted windows untouched', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);
    // Summaries over a window the sweep deletes offers from.
    await seedSummary(db, 1, 1, '2026-09-01');
    await seedSummary(db, 2, 1, '2026-09-02');
    const before = db
      .prepare('SELECT * FROM price_history_summaries ORDER BY id')
      .all();

    await handleRetailOffersRetention(envWith(d1), LOG, {
      now: NOW,
      mode: 'live',
    });

    expect(offerIds(db)).not.toContain(11);
    expect(
      db.prepare('SELECT * FROM price_history_summaries ORDER BY id').all(),
    ).toEqual(before);
  });

  it('the observation-log layout alone carries every copied citation field', async () => {
    // Residual: the R2 bucket itself is a runtime binding absent from the
    // D1 harness — the contract asserted here is the log LAYOUT (the
    // same level the cutover ETL and aggregation consumers code
    // against): a serialized record round-trips with every
    // LANDED_COST citation field intact, so citations never need the
    // deleted retail_offers row.
    const record: ObservationLogRecord = {
      id: 11,
      product_id: 1,
      merchant: 'beverage-de',
      retail_offer_id: 11,
      observed_at: T_OLD_SUPERSEDED,
      foreign_retail_price_cents: 250,
      transport_cost_cents: 500,
      transport_offer_id: null,
      excise_rule_version_id: null,
      container_duty_rule_version_id: null,
      landed_cost_cents: 1_000,
      input_reliability: {
        retailPrice: 'ESTIMATED',
        transport: 'UNAVAILABLE',
        exciseRule: 'ESTIMATED',
        containerDutyRule: 'ESTIMATED',
      },
      confidence: 'LOW',
    };

    const parsed = parseObservationLog(serializeObservationLog([record]));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(record);
  });
});

// ---------------------------------------------------------------------------
// Pre-flight refusal — live mode gated on the provenance audit
// ---------------------------------------------------------------------------

describe('handleRetailOffersRetention — provenance refusal', () => {
  it('refuses live mode with the typed error and deletes nothing when the audit fails', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);

    await expect(
      handleRetailOffersRetention(envWith(d1), LOG, {
        now: NOW,
        mode: 'live',
        provenance: { holds: false, detail: 'forced failure' },
      }),
    ).rejects.toMatchObject({
      name: 'LandedCostProvenanceRefusalError',
      message: expect.stringContaining('forced failure'),
    });
    expect(offerIds(db)).toEqual([11, 12, 21, 22, 31, 32, 41, 42]);
    expect(new LandedCostProvenanceRefusalError('x')).toBeInstanceOf(Error);
  });

  it('dry-run still reports through a failed audit (no refusal, nothing deleted)', async () => {
    const { db, d1 } = createDb();
    await seedParityCatalog(db);

    const result = await handleRetailOffersRetention(envWith(d1), LOG, {
      now: NOW,
      provenance: { holds: false, detail: 'forced failure' },
    });

    expect(result.mode).toBe('dry-run');
    expect(result.deleted).toBe(0);
    expect(result.provenance.holds).toBe(false);
    expect(offerIds(db)).toEqual([11, 12, 21, 22, 31, 32, 41, 42]);
  });
});

// ---------------------------------------------------------------------------
// Constants — the spec-pinned window and the registration pattern
// ---------------------------------------------------------------------------

describe('retail-offers retention constants', () => {
  it('pins the 30-day window and the shared retention cron pattern', () => {
    expect(RETENTION_WINDOW_DAYS).toBe(30);
    expect(RETAIL_OFFERS_RETENTION_CRON).toBe(RETENTION_CRON);
    expect(RETAIL_OFFERS_RETENTION_CRON).toBe('30 3 * * *');
  });
});
