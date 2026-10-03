/**
 * Savings-snapshot cron handler tests (task 2.2, change
 * insight-surfaces; task 4.1, change alko-reference-matching-pipeline)
 * — happy-path materialization over the real D1 repositories on the
 * fake-D1 harness (migrations applied), the non-qualifying no-row
 * contract, re-run idempotence via the keyed upsert, per-product failure
 * isolation, the handler-group sequencing after time-series aggregation,
 * and the v2 linked qualification: CONFIRMED reference links materialize
 * the foreign product against the linked Alko benchmark, PENDING and
 * REJECTED links stay inert, and the direct path wins the dedupe.
 *
 * @module SavingsSnapshotsCronTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  handleSavingsSnapshots,
  buildSavingsCalculator,
  SAVINGS_SNAPSHOT_CRON,
  SAVINGS_SNAPSHOT_CADENCE,
  type SavingsSnapshotDeps,
} from '../savings-snapshots';
import { handlersForCron } from '../router';
import { AGGREGATION_CRON } from '../time-series-aggregation';
import { computeSavingsGap } from '../../../../../packages/core-domain/src/savings/gap';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger, type Logger } from '../../logger';
import type { Env } from '../../env';

const LOG = createLogger('error');

const RUN_NOW = new Date('2026-09-08T09:30:00Z');
const AS_OF = '2026-09-08';

function createEnv(): { env: Env; db: DatabaseSync } {
  const { db, d1 } = openMigratedD1();
  return { env: { DB: d1 } as unknown as Env, db };
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
  productId: number,
  merchant: string,
  country: string,
  priceCents: number,
  observedAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
          currency, observed_at, reliability_status)
       VALUES (?, ?, ?, ?, ?, 'EUR', ?, ?)`,
    )
    .run(id, merchant, country, productId, priceCents, observedAt, 'VERIFIED');
}

/** One excise + one container-duty rule with DISTINCT version labels —
 *  pins the explainability join on the snapshot row. */
async function seedTaxRules(db: DatabaseSync): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tax_rules (id, tax_type, product_category, rate, effective_from,
          calculation_formula_reference, official_source, version_label)
       VALUES (1, 'excise', 'beer', 36.20, '2024-01-01T00:00:00Z',
               'PER_DEGREE_PLATO', 'Finnish Tax Administration (vero.fi)', 'v1.0-2024')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO tax_rules (id, tax_type, product_category, rate, effective_from,
          calculation_formula_reference, official_source, version_label)
       VALUES (2, 'container_duty', 'all_beverages', 0.51, '2024-01-01T00:00:00Z',
               'FLAT_PER_LITRE', 'Finnish Tax Administration (vero.fi)', 'v2.0-2025')`,
    )
    .run();
}

/** Products 1 and 2 qualify (best foreign offer + Alko reference);
 *  product 3 carries no Alko offer at all. */
async function seedQualifyingSet(db: DatabaseSync): Promise<void> {
  await seedTaxRules(db);
  await seedProduct(db, 1);
  await seedOffer(db, 11, 1, 'beverage-de', 'DE', 250, '2026-09-01T10:00:00.000Z');
  await seedOffer(db, 12, 1, 'alko', 'FI', 300, '2026-09-05T12:00:00.000Z');
  await seedProduct(db, 2);
  await seedOffer(db, 21, 2, 'vinos-es', 'ES', 400, '2026-09-02T10:00:00.000Z');
  await seedOffer(db, 22, 2, 'alko', 'FI', 500, '2026-09-06T12:00:00.000Z');
  await seedProduct(db, 3);
  await seedOffer(db, 31, 3, 'beverage-de', 'DE', 200, '2026-09-03T10:00:00.000Z');
}

/** One product_reference_links row — status decides everything (only
 *  CONFIRMED may carry attribution; the others are inert by law). The
 *  value set is the migration's CHECK: a link is never PENDING (that is
 *  the review queue's status) — the non-live states are REJECTED and
 *  SUPERSEDED. */
async function seedLink(
  db: DatabaseSync,
  id: number,
  foreignProductId: number,
  alkoProductId: number,
  status: 'CONFIRMED' | 'REJECTED' | 'SUPERSEDED',
): Promise<void> {
  const attribution =
    status === 'CONFIRMED' ? `, 'ops', '2026-09-07T08:00:00.000Z'` : `, NULL, NULL`;
  await db
    .prepare(
      `INSERT INTO product_reference_links (id, foreign_product_id, alko_product_id,
          status, confirmed_by, confirmed_at)
       VALUES (?, ?, ?, ?${attribution})`,
    )
    .run(id, foreignProductId, alkoProductId, status);
}

function snapshotRows(db: DatabaseSync): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT as_of, product_id, category, best_merchant, best_merchant_country,
              best_price_cents, best_observed_at, alko_reference_cents,
              alko_observed_at, landed_total_cents, landed_reliability, confidence,
              gap_cents, gap_basis_points, tax_dataset_version, reference_link_id
         FROM savings_snapshots ORDER BY product_id ASC`,
    )
    .all() as never;
}

function captureErrors(): { log: Logger; errors: string[] } {
  const errors: string[] = [];
  const log: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (fields) => {
      errors.push(fields.message);
    },
  };
  return { log, errors };
}

describe('handleSavingsSnapshots', () => {
  it('materializes one keyed row per qualifying product with the full landed cost vs the Alko reference', async () => {
    const { env, db } = createEnv();
    await seedQualifyingSet(db);

    const result = await handleSavingsSnapshots(env, LOG, {
      now: () => RUN_NOW,
    });

    expect(result).toEqual({
      asOf: AS_OF,
      qualifyingProducts: 2,
      rowsWritten: 2,
      skipped: 0,
      failed: 0,
    });

    const rows = snapshotRows(db);
    expect(rows).toHaveLength(2);

    const row = rows.find((r) => r.product_id === 1)!;
    expect(row.as_of).toBe(AS_OF);
    expect(row.category).toBe('beer');
    expect(row.best_merchant).toBe('beverage-de');
    expect(row.best_merchant_country).toBe('DE');
    expect(row.best_price_cents).toBe(250);
    expect(row.best_observed_at).toBe('2026-09-01T10:00:00.000Z');
    expect(row.alko_reference_cents).toBe(300);
    expect(row.alko_observed_at).toBe('2026-09-05T12:00:00.000Z');
    // Full landed cost (retail + taxes; transport unavailable on the
    // empty transport table → 0) — never the retail price alone.
    const landed = row.landed_total_cents as number;
    expect(Number.isInteger(landed)).toBe(true);
    expect(landed).toBeGreaterThanOrEqual(250);
    expect(row.landed_reliability).toBe('UNAVAILABLE');
    expect(row.confidence).toMatch(/^(HIGH|MEDIUM|LOW)$/);
    // The row's gap figures match the pure gap computation over its own
    // inputs, and the tax dataset versions that produced the figures
    // are carried on the row (explainability invariant).
    const expectedGap = computeSavingsGap({
      productId: 1,
      productName: 'Product 1',
      landedTotalCents: landed,
      alkoReferenceCents: 300,
    });
    expect(row.gap_cents).toBe(expectedGap.gapCents);
    expect(row.gap_basis_points).toBe(expectedGap.gapBasisPoints);
    // Task 4.3: the landed figure now includes import VAT for the DE
    // seller, so its provenance names the VAT dataset version too.
    expect(row.tax_dataset_version).toBe(
      'v1.0-2024+v2.0-2025+import-vat-2024.2',
    );
  });

  it('writes no row for products without a qualifying Alko reference', async () => {
    const { env, db } = createEnv();
    await seedTaxRules(db);
    await seedProduct(db, 3);
    await seedOffer(db, 31, 3, 'beverage-de', 'DE', 200, '2026-09-03T10:00:00.000Z');
    // Product 4 has an Alko row (so the enumeration surfaces it) whose
    // offer read carries NO observation timestamp — the exact
    // resolveAlkoBenchmark disqualifier.
    await seedProduct(db, 4);
    await seedOffer(db, 41, 4, 'alko', 'FI', 300, '2026-09-05T12:00:00.000Z');

    const offersForProduct = (productId: number) =>
      productId === 4
        ? Promise.resolve([
            {
              id: 41,
              priceCents: 300,
              merchant: 'alko',
              country: 'FI',
              reliabilityStatus: 'VERIFIED' as const,
            },
          ])
        : Promise.resolve([]);

    const result = await handleSavingsSnapshots(env, LOG, {
      now: () => RUN_NOW,
      offersForProduct,
    });

    expect(result.rowsWritten).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(snapshotRows(db)).toHaveLength(0);
  });

  it('is idempotent on re-run for the same as-of day', async () => {
    const { env, db } = createEnv();
    await seedQualifyingSet(db);
    const deps: SavingsSnapshotDeps = { now: () => RUN_NOW };

    const first = await handleSavingsSnapshots(env, LOG, deps);
    const rowsAfterFirst = snapshotRows(db);
    const second = await handleSavingsSnapshots(env, LOG, deps);
    const rowsAfterSecond = snapshotRows(db);

    expect(first.rowsWritten).toBe(2);
    expect(second.rowsWritten).toBe(2);
    expect(rowsAfterSecond).toEqual(rowsAfterFirst);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM savings_snapshots').get() as { n: number },
    ).toEqual({ n: 2 });
  });

  it('isolates per-product failures — the remaining products still materialize', async () => {
    const { env, db } = createEnv();
    await seedQualifyingSet(db);
    const real = buildSavingsCalculator(env.DB);
    const { log, errors } = captureErrors();

    const result = await handleSavingsSnapshots(env, log, {
      now: () => RUN_NOW,
      calculator: {
        calculate: (input) =>
          input.productId === 1
            ? Promise.reject(new Error('calculator exploded'))
            : real.calculate(input),
      },
    });

    expect(result.qualifyingProducts).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.rowsWritten).toBe(1);
    expect(errors.some((m) => m.includes('product 1'))).toBe(true);

    const rows = snapshotRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].product_id).toBe(2);
  });
});

describe('handleSavingsSnapshots — linked qualification (v2)', () => {
  /** Foreign product 5 (own foreign offer only), Alko product 6 (own
   *  alko offer), CONFIRMED link 5 → 6. */
  async function seedLinkedPair(db: DatabaseSync): Promise<void> {
    await seedTaxRules(db);
    await seedProduct(db, 5);
    await seedOffer(db, 51, 5, 'beverage-de', 'DE', 200, '2026-09-03T10:00:00.000Z');
    await seedProduct(db, 6);
    await seedOffer(db, 61, 6, 'alko', 'FI', 300, '2026-09-05T12:00:00.000Z');
    await seedLink(db, 55, 5, 6, 'CONFIRMED');
  }

  it('materializes the linked foreign product against the linked Alko benchmark, with the reference link id on the row', async () => {
    const { env, db } = createEnv();
    await seedLinkedPair(db);

    const result = await handleSavingsSnapshots(env, LOG, {
      now: () => RUN_NOW,
    });

    // Product 6 qualifies directly (its own alko offer), product 5 only
    // through the link — both evaluate exactly once.
    expect(result).toEqual({
      asOf: AS_OF,
      qualifyingProducts: 2,
      rowsWritten: 2,
      skipped: 0,
      failed: 0,
    });

    const rows = snapshotRows(db);
    expect(rows).toHaveLength(2);

    // The linked row: landed cost on the FOREIGN offer, reference from
    // the LINKED Alko product's offers, provenance link id on the row.
    const linked = rows.find((r) => r.product_id === 5)!;
    expect(linked.category).toBe('beer');
    expect(linked.best_merchant).toBe('beverage-de');
    expect(linked.best_merchant_country).toBe('DE');
    expect(linked.best_price_cents).toBe(200);
    expect(linked.alko_reference_cents).toBe(300);
    expect(linked.alko_observed_at).toBe('2026-09-05T12:00:00.000Z');
    expect(linked.reference_link_id).toBe(55);
    const linkedLanded = linked.landed_total_cents as number;
    expect(Number.isInteger(linkedLanded)).toBe(true);
    expect(linkedLanded).toBeGreaterThanOrEqual(200);
    const expectedGap = computeSavingsGap({
      productId: 5,
      productName: 'Product 5',
      landedTotalCents: linkedLanded,
      alkoReferenceCents: 300,
    });
    expect(linked.gap_cents).toBe(expectedGap.gapCents);
    expect(linked.gap_basis_points).toBe(expectedGap.gapBasisPoints);

    // The directly-qualified Alko-side product carries no link provenance.
    const direct = rows.find((r) => r.product_id === 6)!;
    expect(direct.reference_link_id).toBeNull();
  });

  it('leaves non-CONFIRMED links fully inert — no row, no evaluation', async () => {
    const { env, db } = createEnv();
    await seedTaxRules(db);
    await seedProduct(db, 5);
    await seedOffer(db, 51, 5, 'beverage-de', 'DE', 200, '2026-09-03T10:00:00.000Z');
    // The link targets exist (FK parents) but carry no offers — the only
    // path to a row for product 5 would be reading a non-CONFIRMED link.
    // (A link is never PENDING — that is the review queue's status; the
    // non-live link states are REJECTED and SUPERSEDED.)
    await seedProduct(db, 6);
    await seedProduct(db, 7);
    await seedLink(db, 56, 5, 6, 'REJECTED');
    await seedLink(db, 57, 5, 7, 'SUPERSEDED');

    const result = await handleSavingsSnapshots(env, LOG, {
      now: () => RUN_NOW,
    });

    expect(result.qualifyingProducts).toBe(0);
    expect(result.rowsWritten).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(snapshotRows(db)).toHaveLength(0);
    // The non-CONFIRMED rows ARE in the table — the sweep read is what
    // filters them (status = 'CONFIRMED' in listConfirmed's WHERE).
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM product_reference_links').get() as { n: number },
    ).toEqual({ n: 2 });
  });

  it('evaluates a product carrying both a direct Alko offer and a CONFIRMED link exactly once via the direct path', async () => {
    const { env, db } = createEnv();
    await seedTaxRules(db);
    await seedProduct(db, 7);
    await seedOffer(db, 71, 7, 'beverage-de', 'DE', 250, '2026-09-01T10:00:00.000Z');
    await seedOffer(db, 72, 7, 'alko', 'FI', 400, '2026-09-05T12:00:00.000Z');
    await seedProduct(db, 8);
    await seedOffer(db, 81, 8, 'alko', 'FI', 300, '2026-09-05T12:00:00.000Z');
    await seedLink(db, 58, 7, 8, 'CONFIRMED');

    const result = await handleSavingsSnapshots(env, LOG, {
      now: () => RUN_NOW,
    });

    expect(result.qualifyingProducts).toBe(2); // 7 and 8, once each
    expect(result.rowsWritten).toBe(2);

    const rowsFor7 = snapshotRows(db).filter((r) => r.product_id === 7);
    expect(rowsFor7).toHaveLength(1);
    // Direct path wins: the reference is the product's OWN alko offer
    // (400), not the linked Alko product's (300) — and no link provenance.
    expect(rowsFor7[0].alko_reference_cents).toBe(400);
    expect(rowsFor7[0].reference_link_id).toBeNull();
  });

  it('skips a linked product whose linked Alko product has no usable benchmark — honest absence', async () => {
    const { env, db } = createEnv();
    await seedTaxRules(db);
    await seedProduct(db, 9);
    await seedOffer(db, 91, 9, 'beverage-de', 'DE', 200, '2026-09-03T10:00:00.000Z');
    await seedProduct(db, 10); // link target with NO offers at all
    await seedLink(db, 59, 9, 10, 'CONFIRMED');

    const result = await handleSavingsSnapshots(env, LOG, {
      now: () => RUN_NOW,
    });

    expect(result.qualifyingProducts).toBe(1);
    expect(result.rowsWritten).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(snapshotRows(db)).toHaveLength(0);
  });

  it('isolates a linked product failure — direct products still materialize', async () => {
    const { env, db } = createEnv();
    await seedLinkedPair(db);
    const real = buildSavingsCalculator(env.DB);
    const { log, errors } = captureErrors();

    const result = await handleSavingsSnapshots(env, log, {
      now: () => RUN_NOW,
      calculator: {
        calculate: (input) =>
          // Product 5 is the LINKED evaluation — its failure must not
          // drop product 6's direct row.
          input.productId === 5
            ? Promise.reject(new Error('linked calculator exploded'))
            : real.calculate(input),
      },
    });

    expect(result.qualifyingProducts).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.rowsWritten).toBe(1);
    expect(errors.some((m) => m.includes('product 5'))).toBe(true);

    const rows = snapshotRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].product_id).toBe(6);
  });
});

describe('savings-snapshots registration', () => {
  it('rides the aggregation tick, registered after time-series aggregation, with the daily cadence constant', () => {
    expect(SAVINGS_SNAPSHOT_CRON).toBe(AGGREGATION_CRON);
    expect(SAVINGS_SNAPSHOT_CADENCE).toBe('daily');

    const names = handlersForCron(AGGREGATION_CRON).map((handler) => handler.name);
    expect(names.indexOf('savings-snapshots')).toBeGreaterThan(
      names.indexOf('time-series-aggregation'),
    );
  });
});
