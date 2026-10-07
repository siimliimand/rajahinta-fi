/**
 * D1 OutcomeMarginRepository — real-SQLite tests (task 1.2, change
 * hedge-dedup-confidence-meter) on the node:sqlite harness with the
 * committed migrations applied. Covers the pure cell enumeration
 * (hand-computed nearest-rank p80 per rung, below-floor cells skipped,
 * join-honest null attribution reaching only the global cell), the
 * attribution read over the stored outcome corpus, and the persistence
 * semantics (delete-then-insert replaces the whole ladder, an empty
 * corpus persists no rows, a re-run converges without duplicates).
 *
 * @module D1OutcomeMarginRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1OutcomeMarginRepository } from '../outcome-margin.repository';
import { computeOutcomeMarginCells } from '@rajahinta/core-domain';
import type { OutcomeMarginReport } from '@rajahinta/core-domain';

const AS_OF = new Date('2026-10-06T00:00:00.000Z');

/**
 * The hand-computed corpus as plain reports:
 *
 * - 10 beer×posti — errors 0.01 ×8, 0.03, 0.05 → p80 = 0.01
 *   (n = 10, nearest rank ⌈0.8·10⌉ = 8);
 * - 2 beer×matkahuolto — errors 0.02 ×2 → below the floor, no cell;
 * - 3 wine_still×posti — errors 0.05 ×3 → below the floor (same for
 *   the bare wine_still rung);
 * - 1 fully-unattributed report (pruned record) — error 0.05, counts
 *   only toward the global cell.
 *
 * Calibrating ladder: beer|posti (0.01, 10), beer (0.02, 12 — errors
 * 0.01 ×8, 0.02 ×2, 0.03, 0.05, rank ⌈0.8·12⌉ = 10), global (0.05, 16
 * — rank ⌈0.8·16⌉ = 13 over eight 0.01s, two 0.02s, one 0.03, five
 * 0.05s).
 */
function corpusReports(): OutcomeMarginReport[] {
  const beerPosti = (reportedTotalCents: number): OutcomeMarginReport => ({
    reportedTotalCents,
    estimatedTotalCents: 10_000,
    category: 'beer',
    carrier: 'posti',
  });
  return [
    ...Array.from({ length: 8 }, () => beerPosti(10_100)),
    beerPosti(10_300),
    beerPosti(10_500),
    { reportedTotalCents: 10_200, estimatedTotalCents: 10_000, category: 'beer', carrier: 'matkahuolto' },
    { reportedTotalCents: 10_200, estimatedTotalCents: 10_000, category: 'beer', carrier: 'matkahuolto' },
    { reportedTotalCents: 21_000, estimatedTotalCents: 20_000, category: 'wine_still', carrier: 'posti' },
    { reportedTotalCents: 21_000, estimatedTotalCents: 20_000, category: 'wine_still', carrier: 'posti' },
    { reportedTotalCents: 21_000, estimatedTotalCents: 20_000, category: 'wine_still', carrier: 'posti' },
    { reportedTotalCents: 21_000, estimatedTotalCents: 20_000, category: null, carrier: null },
  ];
}

// ---------------------------------------------------------------------------
// SQL-side fixture — the same corpus through the stored tables
// ---------------------------------------------------------------------------

/**
 * Seed the corpus reports as real rows. Attribution wiring: product 1
 * is beer, product 2 wine_still; transport offers 11 (posti) and 12
 * (matkahuolto) carry the carrier join; records 1–3 point at the three
 * attributed combinations, and the unattributed report references
 * record 999 — deliberately no row (calculation_record_id is not an
 * FK; records prune before outcomes).
 */
function seedCorpus(db: ReturnType<typeof openMigratedD1>['db']): void {
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
  const insert = db.prepare(
    `INSERT INTO calculation_outcomes (id, calculation_record_id,
        reporter_account_id, estimate_digest, estimated_total_cents,
        reported_total_cents, reported_at)
     VALUES (?, ?, ?, '{}', ?, ?, ?)`,
  );
  let id = 0;
  for (const report of corpusReports()) {
    id += 1;
    const recordId =
      report.category === null
        ? 999
        : report.category === 'beer'
          ? report.carrier === 'posti'
            ? 1
            : 2
          : 3;
    // One report per (record, account) is the duplicate guard — each
    // report carries its own reporter account.
    accounts.run(id, `user-${id}`, `user-${id}@test.invalid`);
    insert.run(id, recordId, id, report.estimatedTotalCents, report.reportedTotalCents, AS_OF.toISOString());
  }
}

/** The persisted ladder rows for the corpus, ladder order. */
function expectedRows(asOf: Date) {
  return [
    { dimension: 'category_carrier', cellKey: 'beer|posti', quantile: 0.01, sampleCount: 10, asOf },
    { dimension: 'category', cellKey: 'beer', quantile: 0.02, sampleCount: 12, asOf },
    { dimension: 'global', cellKey: 'global', quantile: 0.05, sampleCount: 16, asOf },
  ];
}

describe('computeOutcomeMarginCells — pure enumeration', () => {
  it('calibrates exactly the hand-computed ladder, below-floor cells skipped', () => {
    expect(computeOutcomeMarginCells(corpusReports(), AS_OF)).toEqual([
      { quantile: 0.01, sampleCount: 10, cell: { dimension: 'category_carrier', key: 'beer|posti' }, asOf: AS_OF },
      { quantile: 0.02, sampleCount: 12, cell: { dimension: 'category', key: 'beer' }, asOf: AS_OF },
      { quantile: 0.05, sampleCount: 16, cell: { dimension: 'global', key: 'global' }, asOf: AS_OF },
    ]);
  });

  it('enumerates no cells from an empty corpus', () => {
    expect(computeOutcomeMarginCells([], AS_OF)).toEqual([]);
  });
});

describe('D1OutcomeMarginRepository — attribution read', () => {
  it('reads every stored outcome with its join-honest keys', async () => {
    const { db, d1 } = openMigratedD1();
    seedCorpus(db);

    const reports = await new D1OutcomeMarginRepository(d1).readOutcomeMarginReports();
    // 16 rows, corpus order; the pruned record stays join-honest null.
    expect(reports).toHaveLength(16);
    expect(reports[0]).toEqual({
      reportedTotalCents: 10_100,
      estimatedTotalCents: 10_000,
      category: 'beer',
      carrier: 'posti',
    });
    expect(reports[15]).toEqual({
      reportedTotalCents: 21_000,
      estimatedTotalCents: 20_000,
      category: null,
      carrier: null,
    });
  });
});

describe('D1OutcomeMarginRepository — persistence', () => {
  it('persists the calibrated ladder and reads it back in ladder order', async () => {
    const { db, d1 } = openMigratedD1();
    seedCorpus(db);
    const repository = new D1OutcomeMarginRepository(d1);

    const reports = await repository.readOutcomeMarginReports();
    expect(await repository.persistMargins(computeOutcomeMarginCells(reports, AS_OF))).toBe(3);
    expect(await repository.findMargins()).toEqual(expectedRows(AS_OF));
  });

  it('persists nothing from an empty corpus', async () => {
    const { d1 } = openMigratedD1();
    const repository = new D1OutcomeMarginRepository(d1);

    expect(await repository.readOutcomeMarginReports()).toEqual([]);
    expect(await repository.persistMargins(computeOutcomeMarginCells([], AS_OF))).toBe(0);
    expect(await repository.findMargins()).toEqual([]);
  });

  it('converges on a re-run — the ladder is replaced, never duplicated', async () => {
    const { db, d1 } = openMigratedD1();
    seedCorpus(db);
    const repository = new D1OutcomeMarginRepository(d1);

    // The identical corpus + as-of rewrites the same three rows.
    const reports = await repository.readOutcomeMarginReports();
    await repository.persistMargins(computeOutcomeMarginCells(reports, AS_OF));
    await repository.persistMargins(computeOutcomeMarginCells(reports, AS_OF));
    expect(await repository.findMargins()).toEqual(expectedRows(AS_OF));

    // A GROWN corpus replaces the whole ladder: seven more wine×posti
    // outcomes lift BOTH wine rungs to the floor and move the global
    // count — no stale row survives the rewrite (all errors 0.05).
    // Fresh reporter accounts (the record×reporter duplicate guard).
    const grown = db.prepare(
      `INSERT INTO calculation_outcomes (id, calculation_record_id,
          reporter_account_id, estimate_digest, estimated_total_cents,
          reported_total_cents, reported_at)
       VALUES (?, 3, ?, '{}', 20000, 21000, ?)`,
    );
    for (let i = 0; i < 7; i += 1) {
      db.prepare(
        `INSERT INTO accounts (id, user_id, email) VALUES (?, ?, ?)`,
      ).run(100 + i, `user-${100 + i}`, `user-${100 + i}@test.invalid`);
      grown.run(100 + i, 100 + i, AS_OF.toISOString());
    }

    await repository.persistMargins(
      computeOutcomeMarginCells(await repository.readOutcomeMarginReports(), AS_OF),
    );
    expect(await repository.findMargins()).toEqual([
      { dimension: 'category_carrier', cellKey: 'beer|posti', quantile: 0.01, sampleCount: 10, asOf: AS_OF },
      { dimension: 'category_carrier', cellKey: 'wine_still|posti', quantile: 0.05, sampleCount: 10, asOf: AS_OF },
      { dimension: 'category', cellKey: 'beer', quantile: 0.02, sampleCount: 12, asOf: AS_OF },
      { dimension: 'category', cellKey: 'wine_still', quantile: 0.05, sampleCount: 10, asOf: AS_OF },
      { dimension: 'global', cellKey: 'global', quantile: 0.05, sampleCount: 23, asOf: AS_OF },
    ]);
  });
});
