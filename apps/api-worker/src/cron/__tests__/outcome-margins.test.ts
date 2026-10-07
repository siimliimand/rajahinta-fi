/**
 * Outcome-margins cron handler tests (task 1.2, change
 * hedge-dedup-confidence-meter) — the margin-ladder refresh over the
 * real D1 repository on the fake-D1 harness: the handler seam (clock +
 * repository overrides), the honest degrade (an empty outcome corpus
 * persists no rows), the hand-computed ladder write, re-run
 * idempotency, and the guarantee the write never touches the accuracy
 * statistic's inputs (AccuracyStat reads calculation_outcomes — a
 * margin run cannot alter it by construction; pinned by value).
 *
 * @module OutcomeMarginsCronTest
 */

import { describe, it, expect } from 'vitest';
import { handleOutcomeMargins } from '../outcome-margins';
import { D1OutcomeMarginRepository } from '../../../../../packages/data-platform/src/repositories/d1/outcome-margin.repository';
import { D1CalculationOutcomeRepository } from '../../../../../packages/data-platform/src/repositories/d1/calculation-outcome.repository';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger } from '../../logger';
import type { Env } from '../../env';
import type { DatabaseSync } from 'node:sqlite';

const LOG = createLogger('error');
const AS_OF = new Date('2026-10-06T00:00:00.000Z');

/** Fresh migrated in-memory DB + minimal Env binding. */
function setup(): { db: DatabaseSync; d1: ReturnType<typeof openMigratedD1>['d1'] } {
  return openMigratedD1();
}

/**
 * Seed the hand-computed corpus through the outcome repository (the
 * same write path the API route uses). Attribution wiring: product 1
 * beer, product 2 wine_still; offers 11 posti, 12 matkahuolto; record
 * 999 deliberately has no row (pruned record — join-honest null
 * attribution). One report per (record, account) is the duplicate
 * guard, so every report carries its own reporter account. See the
 * repository test for the full nearest-rank arithmetic; the ladder
 * this must calibrate is beer|posti (0.01, 10), beer (0.02, 12),
 * global (0.05, 16).
 */
async function seedOutcomeCorpus(db: DatabaseSync, d1: ReturnType<typeof openMigratedD1>['d1']): Promise<void> {
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

  const accounts = db.prepare(
    `INSERT INTO accounts (id, user_id, email) VALUES (?, ?, ?)`,
  );
  const outcomes = new D1CalculationOutcomeRepository(d1);
  let reporter = 0;
  const report = async (
    calculationRecordId: number,
    estimatedTotalCents: number,
    reportedTotalCents: number,
  ): Promise<void> => {
    reporter += 1;
    accounts.run(reporter, `user-${reporter}`, `user-${reporter}@test.invalid`);
    await outcomes.create({
      calculationRecordId,
      reporterAccountId: reporter,
      estimateDigest: { totalCents: estimatedTotalCents },
      estimatedTotalCents,
      reportedTotalCents,
    });
  };

  const beerPosti: Array<[number, number]> = [
    ...Array.from({ length: 8 }, () => [10_000, 10_100] as [number, number]),
    [10_000, 10_300],
    [10_000, 10_500],
  ];
  for (const [estimated, reported] of beerPosti) {
    await report(1, estimated, reported);
  }
  for (let i = 0; i < 2; i += 1) {
    await report(2, 10_000, 10_200);
  }
  for (let i = 0; i < 3; i += 1) {
    await report(3, 20_000, 21_000);
  }
  // The pruned-record outcome (record 999 has no row).
  await report(999, 20_000, 21_000);
}

describe('handleOutcomeMargins', () => {
  it('persists the hand-computed ladder with the injected as-of', async () => {
    const { db, d1 } = setup();
    await seedOutcomeCorpus(db, d1);

    const result = await handleOutcomeMargins({ DB: d1 } as unknown as Env, LOG, {
      asOf: AS_OF,
    });

    expect(result).toEqual({ reports: 16, cellsWritten: 3, asOf: AS_OF.toISOString() });
    expect(await new D1OutcomeMarginRepository(d1).findMargins()).toEqual([
      { dimension: 'category_carrier', cellKey: 'beer|posti', quantile: 0.01, sampleCount: 10, asOf: AS_OF },
      { dimension: 'category', cellKey: 'beer', quantile: 0.02, sampleCount: 12, asOf: AS_OF },
      { dimension: 'global', cellKey: 'global', quantile: 0.05, sampleCount: 16, asOf: AS_OF },
    ]);
  });

  it('degrades to no rows on an empty outcome corpus', async () => {
    const { d1 } = setup();

    const result = await handleOutcomeMargins({ DB: d1 } as unknown as Env, LOG, {
      asOf: AS_OF,
    });

    expect(result).toEqual({ reports: 0, cellsWritten: 0, asOf: AS_OF.toISOString() });
    expect(await new D1OutcomeMarginRepository(d1).findMargins()).toEqual([]);
  });

  it('re-runs converge — the ladder is replaced, never duplicated', async () => {
    const { db, d1 } = setup();
    await seedOutcomeCorpus(db, d1);
    const env = { DB: d1 } as unknown as Env;
    const repository = new D1OutcomeMarginRepository(d1);

    await handleOutcomeMargins(env, LOG, { asOf: AS_OF });
    await handleOutcomeMargins(env, LOG, { asOf: AS_OF });

    expect(await repository.findMargins()).toEqual([
      { dimension: 'category_carrier', cellKey: 'beer|posti', quantile: 0.01, sampleCount: 10, asOf: AS_OF },
      { dimension: 'category', cellKey: 'beer', quantile: 0.02, sampleCount: 12, asOf: AS_OF },
      { dimension: 'global', cellKey: 'global', quantile: 0.05, sampleCount: 16, asOf: AS_OF },
    ]);
  });

  it('never alters the accuracy statistic the margin run reads', async () => {
    const { db, d1 } = setup();
    await seedOutcomeCorpus(db, d1);
    const env = { DB: d1 } as unknown as Env;
    const accuracy = new D1CalculationOutcomeRepository(d1);

    const before = await accuracy.findAccuracyStatistic({}, AS_OF);
    await handleOutcomeMargins(env, LOG, { asOf: AS_OF });
    const after = await accuracy.findAccuracyStatistic({}, AS_OF);

    expect(after).toEqual(before);
    expect(after.count).toBe(16);
  });
});
