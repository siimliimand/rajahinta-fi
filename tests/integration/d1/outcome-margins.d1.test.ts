/**
 * Integration test — outcome-margin persistence on D1 (task 1.2,
 * change hedge-dedup-confidence-meter, spec: calculation-outcomes
 * delta "Persisted empirical margins"). The D1 twin of the repository
 * + cron-handler Node suites: the real migration-0029 table on a real
 * SQLite engine, the outcome-margins step of the aggregation tick
 * writing through it, and the degrade/idempotency contracts.
 *
 * Pins:
 * - the outcome_margins DDL: composite (dimension, cell_key) primary
 *   key (one row per cell — a re-run can never duplicate), the
 *   dimension CHECK, and the non-negotiable value CHECKs (a negative
 *   quantile or a zero-sample margin is a calibration bug,
 *   unrepresentable at rest);
 * - aggregation with reports writes the hand-computed ladder
 *   (nearest-rank p80 per rung — beer|posti 0.01 @ 10, beer 0.02 @ 12,
 *   global 0.05 @ 16; the below-floor beer×matkahuolto and wine_still
 *   rungs persist nothing);
 * - aggregation with zero reports persists no rows and no synthesized
 *   values;
 * - re-run idempotency: the ladder is replaced, never duplicated;
 * - the margin write leaves the accuracy statistic byte-identical
 *   (AccuracyStat reads calculation_outcomes directly — pinned by
 *   value, not by argument).
 *
 * @module OutcomeMarginsD1IntegrationTest
 */

import { describe, it, expect } from 'vitest';

import { openMigratedD1 } from './harness';
import { handleOutcomeMargins } from '../../../apps/api-worker/src/cron/outcome-margins';
import { D1OutcomeMarginRepository } from '../../../packages/data-platform/src/repositories/d1/outcome-margin.repository';
import { D1CalculationOutcomeRepository } from '../../../packages/data-platform/src/repositories/d1/calculation-outcome.repository';
import { createLogger } from '../../../apps/api-worker/src/logger';
import type { Env } from '../../../apps/api-worker/src/env';
import type { DatabaseSync } from 'node:sqlite';

const LOG = createLogger('error');
const AS_OF = new Date('2026-10-06T00:00:00.000Z');

const EXPECTED_LADDER = [
  { dimension: 'category_carrier', cellKey: 'beer|posti', quantile: 0.01, sampleCount: 10, asOf: AS_OF },
  { dimension: 'category', cellKey: 'beer', quantile: 0.02, sampleCount: 12, asOf: AS_OF },
  { dimension: 'global', cellKey: 'global', quantile: 0.05, sampleCount: 16, asOf: AS_OF },
];

/**
 * The hand-computed corpus (see the repository suite for the
 * nearest-rank arithmetic), seeded as real rows. One report per
 * (record, account) is the duplicate guard — each report carries its
 * own reporter account; record 999 deliberately has no row.
 */
function seedOutcomeCorpus(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category,
        unit_volume, container_type, regulatory_classification)
     VALUES (1, 'Beer', 'B', 'B', 'beer', 0.33, 'can', 'beer'),
            (2, 'Wine', 'W', 'W', 'wine_still', 0.75, 'glass', 'wine')`,
  ).run();
  db.prepare(
    `INSERT INTO transport_offers (id, carrier, origin_country,
        destination_country, package_tier, price_cents)
     VALUES (11, 'posti', 'EE', 'FI', 'parcel', 500),
            (12, 'matkahuolto', 'EE', 'FI', 'parcel', 500)`,
  ).run();
  db.prepare(
    `INSERT INTO calculation_records (id, product_master_id, retail_offer_ids,
        transport_offer_id, total_cents, breakdown, confidence, quantity,
        destination, disclaimer, calculated_at)
     VALUES (1, 1, '[]', 11, 873, '[]', 'MEDIUM', 1, 'FI', '{}', ?),
            (2, 1, '[]', 12, 873, '[]', 'MEDIUM', 1, 'FI', '{}', ?),
            (3, 2, '[]', 11, 1730, '[]', 'MEDIUM', 1, 'FI', '{}', ?)`,
  ).run(AS_OF.toISOString(), AS_OF.toISOString(), AS_OF.toISOString());

  const reports: Array<{ recordId: number; estimated: number; reported: number }> = [
    ...Array.from({ length: 8 }, () => ({ recordId: 1, estimated: 10_000, reported: 10_100 })),
    { recordId: 1, estimated: 10_000, reported: 10_300 },
    { recordId: 1, estimated: 10_000, reported: 10_500 },
    { recordId: 2, estimated: 10_000, reported: 10_200 },
    { recordId: 2, estimated: 10_000, reported: 10_200 },
    { recordId: 3, estimated: 20_000, reported: 21_000 },
    { recordId: 3, estimated: 20_000, reported: 21_000 },
    { recordId: 3, estimated: 20_000, reported: 21_000 },
    { recordId: 999, estimated: 20_000, reported: 21_000 },
  ];
  const accounts = db.prepare(
    `INSERT INTO accounts (id, user_id, email) VALUES (?, ?, ?)`,
  );
  const outcomes = db.prepare(
    `INSERT INTO calculation_outcomes (id, calculation_record_id,
        reporter_account_id, estimate_digest, estimated_total_cents,
        reported_total_cents, reported_at)
     VALUES (?, ?, ?, '{}', ?, ?, ?)`,
  );
  let id = 0;
  for (const report of reports) {
    id += 1;
    accounts.run(id, `user-${id}`, `user-${id}@test.invalid`);
    outcomes.run(id, report.recordId, id, report.estimated, report.reported, AS_OF.toISOString());
  }
}

describe('migration 0029 — outcome_margins', () => {
  const { db } = openMigratedD1();

  it('creates the table keyed on (dimension, cell_key)', () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outcome_margins'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('outcome_margins');

    const pk = db
      .prepare('PRAGMA table_info(outcome_margins)')
      .all() as Array<{ name: string; pk: number }>;
    expect(pk.filter((column) => column.pk > 0).map((column) => column.name)).toEqual([
      'dimension',
      'cell_key',
    ]);
  });

  it('enforces the cell contract at rest', () => {
    const insert = db.prepare(
      `INSERT INTO outcome_margins (dimension, cell_key, quantile, sample_count, as_of)
       VALUES (?, ?, ?, ?, ?)`,
    );
    // The honest row goes in.
    expect(() =>
      insert.run('category_carrier', 'beer|posti', 0.01, 10, AS_OF.toISOString()),
    ).not.toThrow();
    // An unknown dimension is not a ladder rung.
    expect(() => insert.run('carrier', 'posti', 0.05, 16, AS_OF.toISOString())).toThrow(/CHECK/);
    // A negative quantile is not a relative error.
    expect(() => insert.run('category', 'beer', -0.01, 16, AS_OF.toISOString())).toThrow(/CHECK/);
    // A zero-sample margin does not exist.
    expect(() => insert.run('category', 'wine_still', 0.05, 0, AS_OF.toISOString())).toThrow(/CHECK/);
    // A blank key is a calibration bug.
    expect(() => insert.run('category', '', 0.05, 16, AS_OF.toISOString())).toThrow(/CHECK/);
    // One row per cell — the primary key refuses the duplicate.
    expect(() =>
      insert.run('category_carrier', 'beer|posti', 0.06, 11, AS_OF.toISOString()),
    ).toThrow(/UNIQUE/);
  });
});

describe('outcome aggregation margin persistence on D1', () => {
  function env(): ReturnType<typeof openMigratedD1> {
    return openMigratedD1();
  }

  it('aggregation with reports writes the expected margin rows', async () => {
    const { db, d1 } = env();
    seedOutcomeCorpus(db);

    const result = await handleOutcomeMargins({ DB: d1 } as unknown as Env, LOG, {
      asOf: AS_OF,
    });
    expect(result).toEqual({ reports: 16, cellsWritten: 3, asOf: AS_OF.toISOString() });
    expect(await new D1OutcomeMarginRepository(d1).findMargins()).toEqual(EXPECTED_LADDER);
  });

  it('aggregation with zero reports persists no rows', async () => {
    const { d1 } = env();

    const result = await handleOutcomeMargins({ DB: d1 } as unknown as Env, LOG, {
      asOf: AS_OF,
    });
    expect(result).toEqual({ reports: 0, cellsWritten: 0, asOf: AS_OF.toISOString() });
    expect(await new D1OutcomeMarginRepository(d1).findMargins()).toEqual([]);
  });

  it('re-run idempotency — the ladder is replaced, never duplicated', async () => {
    const { db, d1 } = env();
    seedOutcomeCorpus(db);
    const binding = { DB: d1 } as unknown as Env;
    const repository = new D1OutcomeMarginRepository(d1);

    await handleOutcomeMargins(binding, LOG, { asOf: AS_OF });
    await handleOutcomeMargins(binding, LOG, { asOf: AS_OF });

    const rows = await repository.findMargins();
    expect(rows).toEqual(EXPECTED_LADDER);
    // One row per calibrated cell, whatever the run count.
    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM outcome_margins').get() as { c: number }).c,
    ).toBe(3);
  });

  it('the margin write leaves the accuracy statistic untouched', async () => {
    const { db, d1 } = env();
    seedOutcomeCorpus(db);
    const accuracy = new D1CalculationOutcomeRepository(d1);

    const before = await accuracy.findAccuracyStatistic({}, AS_OF);
    await handleOutcomeMargins({ DB: d1 } as unknown as Env, LOG, { asOf: AS_OF });
    const after = await accuracy.findAccuracyStatistic({}, AS_OF);

    expect(after).toEqual(before);
    expect(after.count).toBe(16);
    expect(after.withinMarginShare).not.toBeNull();
  });
});
