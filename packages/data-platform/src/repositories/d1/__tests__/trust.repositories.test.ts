/**
 * D1 trust repositories — real-SQLite tests (task 1.3, change
 * trust-and-reach-roadmap) on the node:sqlite harness with the
 * committed migrations applied. Covers the shop-report CRUD and its
 * OPEN → LINKED/REJECTED moderation transitions, the blacklist-entry
 * publish/appeal/resolve lifecycle with its public-visibility rule,
 * the outcome duplicate guard (one per record+account → typed 409
 * error) and the read-side accuracy aggregation (empty state, valued
 * state, inclusive margin boundary, half-open period bounds), plus the
 * read-time accuracy breakdowns by product category and transport
 * carrier (join-based filters; unattributable outcomes never counted
 * into a cell; honest empty state on zero matches).
 *
 * @module D1TrustRepositoriesTest
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1ShopReportRepository,
} from '../shop-report.repository';
import { D1BlacklistRepository } from '../blacklist.repository';
import {
  D1CalculationOutcomeRepository,
} from '../calculation-outcome.repository';
import { DuplicateOutcomeError } from '../../../abstracts';

const { db, d1 } = openMigratedD1();
const reports = new D1ShopReportRepository(d1);
const entries = new D1BlacklistRepository(d1);
const outcomes = new D1CalculationOutcomeRepository(d1);

/** Fresh DB per test would be cleaner; ids stay unique per test instead. */
let accountIdSeq = 400;
async function seedAccount(): Promise<number> {
  const id = ++accountIdSeq;
  db.prepare(
    `INSERT INTO accounts (id, user_id, email) VALUES (?, ?, ?)`,
  ).run(id, `user-${id}@test.invalid`, `user-${id}@test.invalid`);
  return id;
}

let identitySeq = 0;
function nextIdentity() {
  const n = ++identitySeq;
  return {
    domain: `shop-${n}.example`,
    name: `shop ${n} oy`,
  };
}

interface ReportFixture {
  readonly merchantDomain: string;
  readonly merchantNameNormalized: string;
  readonly orderReference: string;
  readonly correspondenceSummary: string;
  readonly reporterAccountId: number;
}

async function seedReport(overrides: Partial<ReportFixture> = {}) {
  const identity = nextIdentity();
  return reports.create({
    merchantDomain: identity.domain,
    merchantNameNormalized: identity.name,
    orderReference: `ORD-${Date.now()}-${++identitySeq}`,
    correspondenceSummary: 'Merchant never shipped; no refund after reminders.',
    reporterAccountId: await seedAccount(),
    ...overrides,
  });
}

describe('D1ShopReportRepository', () => {
  it('creates a report as OPEN with null linked entry and readable back', async () => {
    const reporter = await seedAccount();
    const identity = nextIdentity();
    const row = await reports.create({
      merchantDomain: identity.domain,
      merchantNameNormalized: identity.name,
      orderReference: 'ORD-1001',
      correspondenceSummary: 'Paid, never delivered.',
      reporterAccountId: reporter,
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.merchantDomain).toBe(identity.domain);
    expect(row.merchantNameNormalized).toBe(identity.name);
    expect(row.orderReference).toBe('ORD-1001');
    expect(row.status).toBe('OPEN');
    expect(row.linkedEntryId).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);

    const read = await reports.findById(row.id);
    expect(read).toEqual(row);
  });

  it('rejects blank evidence fields at the schema level', async () => {
    const reporter = await seedAccount();
    const identity = nextIdentity();
    await expect(
      reports.create({
        merchantDomain: identity.domain,
        merchantNameNormalized: identity.name,
        orderReference: '',
        correspondenceSummary: 'summary',
        reporterAccountId: reporter,
      }),
    ).rejects.toThrow();
  });

  it('enforces the reporter account FK — an unknown account cannot report', async () => {
    const identity = nextIdentity();
    await expect(
      reports.create({
        merchantDomain: identity.domain,
        merchantNameNormalized: identity.name,
        orderReference: 'ORD-1002',
        correspondenceSummary: 'summary',
        reporterAccountId: 9_999_999,
      }),
    ).rejects.toThrow();
  });

  it('groups reports by merchant identity and lists one account’s own reports', async () => {
    const identity = nextIdentity();
    const r1 = await seedReport({
      merchantDomain: identity.domain,
      merchantNameNormalized: identity.name,
    });
    const r2 = await seedReport({
      merchantDomain: identity.domain,
      merchantNameNormalized: identity.name,
    });
    await seedReport(); // different merchant

    const byMerchant = await reports.findByMerchantIdentity({
      domain: identity.domain,
      name: identity.name,
    });
    expect(byMerchant.map((r) => r.id)).toEqual([r1.id, r2.id]);

    const mine = await reports.findByReporterAccountId(r1.reporterAccountId);
    expect(mine.map((r) => r.id)).toEqual([r1.id]);
  });

  it('serves the OPEN queue oldest-first (created_at, then id)', async () => {
    const older = await seedReport();
    const newer = await seedReport();
    // Backdate so "oldest" is decided by data, not insert speed.
    db.prepare('UPDATE shop_reports SET created_at = ? WHERE id = ?').run(
      '2026-01-01T00:00:00.000Z',
      newer.id,
    );
    db.prepare('UPDATE shop_reports SET created_at = ? WHERE id = ?').run(
      '2026-02-01T00:00:00.000Z',
      older.id,
    );

    const openIds = (await reports.findOpen()).map((r) => r.id);
    expect(openIds).toContain(newer.id);
    expect(openIds.indexOf(newer.id)).toBeLessThan(openIds.indexOf(older.id));
  });

  it('rejects an OPEN report once (REJECTED is terminal)', async () => {
    const report = await seedReport();

    const rejected = await reports.reject(report.id);
    expect(rejected!.status).toBe('REJECTED');
    expect(rejected!.linkedEntryId).toBeNull();

    await expect(reports.reject(report.id)).resolves.toBeNull();
    await expect(reports.linkToEntry(report.id, 1)).resolves.toBeNull();
  });

  it('links an OPEN report to a published entry exactly once', async () => {
    const report = await seedReport();
    const entry = await entries.publish({
      merchantIdentity: {
        domain: report.merchantDomain,
        name: report.merchantNameNormalized,
      },
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops@test.invalid',
    });

    // A link to a nonexistent entry violates the FK — the guard is in SQL.
    await expect(reports.linkToEntry(report.id, 9_999_999)).rejects.toThrow();

    const linked = await reports.linkToEntry(report.id, entry.id);
    expect(linked!.status).toBe('LINKED');
    expect(linked!.linkedEntryId).toBe(entry.id);

    // Terminal: a second link (even to another entry) matches no row.
    await expect(reports.linkToEntry(report.id, entry.id)).resolves.toBeNull();
    await expect(reports.reject(report.id)).resolves.toBeNull();
  });
});

describe('D1BlacklistRepository', () => {
  it('publishes an entry PUBLISHED with operator provenance', async () => {
    const identity = nextIdentity();
    const entry = await entries.publish({
      merchantIdentity: identity,
      standardMet: 'CONFIRMED_INVALID_BUSINESS_REGISTRATION',
      publishedBy: 'ops@test.invalid',
    });

    expect(entry.id).toBeGreaterThan(0);
    expect(entry.merchantDomain).toBe(identity.domain);
    expect(entry.merchantNameNormalized).toBe(identity.name);
    expect(entry.status).toBe('PUBLISHED');
    expect(entry.publishedAt).toBeInstanceOf(Date);
    expect(entry.publishedBy).toBe('ops@test.invalid');
    expect(entry.appealedAt).toBeNull();
    expect(entry.appealReason).toBeNull();

    const read = await entries.findById(entry.id);
    expect(read).toEqual(entry);
  });

  it('refuses a blank standard_met at the schema level', async () => {
    await expect(
      entries.publish({
        merchantIdentity: nextIdentity(),
        standardMet: '',
        publishedBy: 'ops@test.invalid',
      }),
    ).rejects.toThrow();
  });

  it('lists entries deterministically and filters the public view to exactly PUBLISHED', async () => {
    const identity = nextIdentity();
    const published = await entries.publish({
      merchantIdentity: identity,
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops@test.invalid',
    });

    expect((await entries.findPublishedByIdentity(identity)).map((e) => e.id))
      .toEqual([published.id]);

    const appeal = await entries.appeal(published.id, {
      appealedAt: new Date('2026-03-01T00:00:00.000Z'),
      appealReason: 'The delivery was delayed, not refused.',
    });
    expect(appeal!.status).toBe('REOPENED');
    expect(appeal!.appealedAt!.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(appeal!.appealReason).toBe('The delivery was delayed, not refused.');

    // Hidden from public display immediately while an appeal is pending…
    await expect(entries.findPublishedByIdentity(identity)).resolves.toEqual([]);
    // …but still in the console list.
    const listed = await entries.list();
    expect(listed.map((e) => e.status)).toContain('REOPENED');

    // Appeal denied: back to PUBLISHED, visible again.
    const republished = await entries.resolveRepublish(published.id);
    expect(republished!.status).toBe('PUBLISHED');
    expect((await entries.findPublishedByIdentity(identity)).map((e) => e.id))
      .toEqual([published.id]);
  });

  it('transitions are state-guarded: wrong-state attempts match no row', async () => {
    const published = await entries.publish({
      merchantIdentity: nextIdentity(),
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops@test.invalid',
    });

    // resolve* only from REOPENED…
    await expect(entries.resolveRepublish(published.id)).resolves.toBeNull();
    await expect(entries.resolveReject(published.id)).resolves.toBeNull();
    // …appeal only from PUBLISHED (once).
    await expect(
      entries.appeal(published.id, {
        appealedAt: new Date(),
        appealReason: 'first',
      }),
    ).resolves.not.toBeNull();
    await expect(
      entries.appeal(published.id, {
        appealedAt: new Date(),
        appealReason: 'second',
      }),
    ).resolves.toBeNull();
  });

  it('ends an appeal as REJECTED — terminal, never displayed again', async () => {
    const identity = nextIdentity();
    const entry = await entries.publish({
      merchantIdentity: identity,
      standardMet: 'CONFIRMED_NON_DELIVERY_REPORTS',
      publishedBy: 'ops@test.invalid',
    });
    await entries.appeal(entry.id, {
      appealedAt: new Date(),
      appealReason: 'Registry extract attached.',
    });

    const rejected = await entries.resolveReject(entry.id);
    expect(rejected!.status).toBe('REJECTED');

    await expect(entries.resolveRepublish(entry.id)).resolves.toBeNull();
    await expect(entries.resolveReject(entry.id)).resolves.toBeNull();
    await expect(entries.findPublishedByIdentity(identity)).resolves.toEqual([]);
  });
});

describe('D1CalculationOutcomeRepository', () => {
  let recordSeq = 5_000;
  function nextRecordId(): number {
    return ++recordSeq;
  }

  it('creates an outcome and reads it back with a parsed estimate digest', async () => {
    const recordId = nextRecordId();
    const reporter = await seedAccount();
    const digest = { totalCents: 1234, quantity: 6, destination: 'FI' };

    const row = await outcomes.create({
      calculationRecordId: recordId,
      reporterAccountId: reporter,
      estimateDigest: digest,
      estimatedTotalCents: 1234,
      reportedTotalCents: 1190,
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.calculationRecordId).toBe(recordId);
    expect(row.reporterAccountId).toBe(reporter);
    expect(row.estimateDigest).toEqual(digest);
    expect(row.estimatedTotalCents).toBe(1234);
    expect(row.reportedTotalCents).toBe(1190);
    expect(row.reportedAt).toBeInstanceOf(Date);

    const read = await outcomes.findById(row.id);
    expect(read).toEqual(row);

    const byRecord = await outcomes.findByCalculationRecordId(recordId);
    expect(byRecord.map((o) => o.id)).toEqual([row.id]);
    const byReporter = await outcomes.findByReporterAccountId(reporter);
    expect(byReporter.map((o) => o.id)).toEqual([row.id]);
  });

  it('rejects a second outcome for the same (record, account) with the typed 409 error', async () => {
    const recordId = nextRecordId();
    const reporter = await seedAccount();
    const input = {
      calculationRecordId: recordId,
      reporterAccountId: reporter,
      estimateDigest: { totalCents: 1000 },
      estimatedTotalCents: 1000,
      reportedTotalCents: 1010,
    };
    await outcomes.create(input);

    await expect(outcomes.create(input)).rejects.toThrow(DuplicateOutcomeError);
    // Independence is the PAIR: same record different account, and same
    // account different record, are both fine.
    await expect(
      outcomes.create({ ...input, reporterAccountId: await seedAccount() }),
    ).resolves.not.toBeNull();
    await expect(
      outcomes.create({ ...input, calculationRecordId: nextRecordId() }),
    ).resolves.not.toBeNull();
  });

  it('rejects non-positive totals at the schema level', async () => {
    const reporter = await seedAccount();
    for (const cents of [0, -5]) {
      await expect(
        outcomes.create({
          calculationRecordId: nextRecordId(),
          reporterAccountId: reporter,
          estimateDigest: {},
          estimatedTotalCents: 1000,
          reportedTotalCents: cents,
        }),
      ).rejects.toThrow();
    }
  });
});

/**
 * The aggregation helpers read unbounded tables, so they run against
 * their own migrated database — the shared DB above carries rows from
 * every other test, which would make "empty state" and exact counts
 * meaningless.
 */
describe('D1CalculationOutcomeRepository — accuracy aggregation', () => {
  const isolated = openMigratedD1();
  const isoOutcomes = new D1CalculationOutcomeRepository(isolated.d1);

  let isoRecordSeq = 9_000;
  async function isoOutcome(
    estimatedTotalCents: number,
    reportedTotalCents: number,
  ) {
    // The outcomes FK targets accounts — seed the isolated DB's one reporter.
    isolated.db
      .prepare(
        `INSERT OR IGNORE INTO accounts (id, user_id, email) VALUES (1, 'agg@test.invalid', 'agg@test.invalid')`,
      )
      .run();
    return isoOutcomes.create({
      calculationRecordId: ++isoRecordSeq,
      reporterAccountId: 1,
      estimateDigest: {},
      estimatedTotalCents,
      reportedTotalCents,
    });
  }

  it('the empty state is count 0 and a null share — never a fabricated percentage', async () => {
    const asOf = new Date('2026-06-01T00:00:00.000Z');
    await expect(isoOutcomes.countByPeriod({})).resolves.toBe(0);
    await expect(isoOutcomes.findAccuracyStatistic({}, asOf)).resolves.toEqual({
      count: 0,
      withinMarginShare: null,
      asOf,
    });
  });

  it('aggregates count and within-margin share with an inclusive 5% boundary', async () => {
    // Estimates all 1000¢ → the within-margin band is |Δ| ≤ 50¢
    // (inclusive, WITHIN_MARGIN_FRACTION = 0.05).
    await isoOutcome(1000, 1049); // inside
    await isoOutcome(1000, 1050); // exactly at the boundary — inclusive
    await isoOutcome(1000, 1051); // outside
    // Under-estimate deviations count too (the band is symmetric).
    await isoOutcome(1000, 950); // inside

    const asOf = new Date('2026-06-01T00:00:00.000Z');
    const stat = await isoOutcomes.findAccuracyStatistic({}, asOf);
    expect(stat.count).toBe(4);
    expect(stat.withinMarginShare).toBeCloseTo(3 / 4, 12);
    expect(stat.asOf).toBe(asOf);
    await expect(isoOutcomes.countByPeriod({})).resolves.toBe(4);
  });
});

/**
 * The one-sided period assertions need a table whose EVERY row is
 * backdated into the test window's neighborhood, so this describe gets
 * its own database too (the valued-aggregate rows above would otherwise
 * leak into open-ended bounds with their now-stamped reported_at).
 */
describe('D1CalculationOutcomeRepository — half-open period bounds', () => {
  const isolated = openMigratedD1();
  const isoOutcomes = new D1CalculationOutcomeRepository(isolated.d1);

  let isoRecordSeq = 90_000;
  async function backdatedOutcome(reportedAtIso: string) {
    isolated.db
      .prepare(
        `INSERT OR IGNORE INTO accounts (id, user_id, email) VALUES (1, 'periods@test.invalid', 'periods@test.invalid')`,
      )
      .run();
    const row = await isoOutcomes.create({
      calculationRecordId: ++isoRecordSeq,
      reporterAccountId: 1,
      estimateDigest: {},
      estimatedTotalCents: 1000,
      reportedTotalCents: 1000,
    });
    isolated.db
      .prepare('UPDATE calculation_outcomes SET reported_at = ? WHERE id = ?')
      .run(reportedAtIso, row.id);
    return row;
  }

  it('bounds are inclusive from, exclusive to, and one-sided forms work', async () => {
    await backdatedOutcome('2021-01-10T00:00:00.000Z'); // January
    await backdatedOutcome('2021-02-10T00:00:00.000Z'); // February
    await backdatedOutcome('2021-03-10T00:00:00.000Z'); // March

    const asOf = new Date('2026-06-01T00:00:00.000Z');
    // Only February is inside [Feb 1, Mar 1).
    const febWindow = {
      from: new Date('2021-02-01T00:00:00.000Z'),
      to: new Date('2021-03-01T00:00:00.000Z'),
    };
    const februaryOnly = await isoOutcomes.findAccuracyStatistic(febWindow, asOf);
    expect(februaryOnly.count).toBe(1);
    expect(februaryOnly.withinMarginShare).toBe(1);

    // The lower bound is inclusive, the upper exclusive.
    const edge = {
      from: new Date('2021-02-10T00:00:00.000Z'),
      to: new Date('2021-03-10T00:00:00.000Z'),
    };
    await expect(isoOutcomes.countByPeriod(edge)).resolves.toBe(1);

    // One-sided bounds: [Feb 1, ∞) is February + March.
    await expect(
      isoOutcomes.countByPeriod({ from: new Date('2021-02-01T00:00:00.000Z') }),
    ).resolves.toBe(2);
    // (∞, Feb 1) is January only.
    await expect(
      isoOutcomes.countByPeriod({ to: new Date('2021-02-01T00:00:00.000Z') }),
    ).resolves.toBe(1);
    // Unbounded is everything.
    await expect(isoOutcomes.countByPeriod({})).resolves.toBe(3);
  });
});

/**
 * The breakdown joins read across outcomes, calculation records,
 * products, and transport offers, so every assertion below needs to
 * know exactly which rows exist — this describe gets its own migrated
 * database with a fixed fixture graph (design D5: splits are read-time
 * joins, no materialization).
 */
describe('D1CalculationOutcomeRepository — accuracy breakdowns', () => {
  const isolated = openMigratedD1();
  const isoOutcomes = new D1CalculationOutcomeRepository(isolated.d1);
  const asOf = new Date('2026-08-01T00:00:00.000Z');

  function seedProduct(id: number, category: string): void {
    isolated.db
      .prepare(
        `INSERT INTO product_master
           (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, `product-${id}`, 'm', 'b', category, 0.5, 'glass', 'unknown');
  }

  function seedTransportOffer(id: number, carrier: string): void {
    isolated.db
      .prepare(
        `INSERT INTO transport_offers (id, carrier, origin_country, package_tier, price_cents)
         VALUES (?, ?, 'EE', 'parcel', 500)`,
      )
      .run(id, carrier);
  }

  function seedCalculationRecord(
    id: number,
    productId: number,
    transportOfferId: number | null,
  ): void {
    isolated.db
      .prepare(
        `INSERT INTO calculation_records
           (id, product_master_id, transport_offer_id, total_cents, breakdown, confidence, quantity, destination, disclaimer)
         VALUES (?, ?, ?, 1000, '{}', 'HIGH', 1, 'FI', 'disclaimer')`,
      )
      .run(id, productId, transportOfferId);
  }

  /**
   * One outcome per seeded record (the (record, account) unique index
   * allows no more), all estimating 1000¢. Record 901 is deliberately
   * never stored: calculation_record_id is a convention, not an FK, so
   * an outcome can outlive its record — the join-honesty case.
   * Reported timestamps are fixed so the period-bounds assertions are
   * deterministic (2020-06 batch, with 101 backdated out of it).
   */
  function seedOutcome(
    calculationRecordId: number,
    reportedTotalCents: number,
    reportedAt = '2020-06-01T00:00:00.000Z',
  ): void {
    isolated.db
      .prepare(
        `INSERT INTO calculation_outcomes
           (calculation_record_id, reporter_account_id, estimate_digest, estimated_total_cents, reported_total_cents, reported_at)
         VALUES (?, 1, '{}', 1000, ?, ?)`,
      )
      .run(calculationRecordId, reportedTotalCents, reportedAt);
  }

  beforeAll(() => {
    isolated.db
      .prepare(
        `INSERT OR IGNORE INTO accounts (id, user_id, email) VALUES (1, 'breakdowns@test.invalid', 'breakdowns@test.invalid')`,
      )
      .run();
    seedProduct(11, 'beer');
    seedProduct(12, 'wine_still');
    seedTransportOffer(21, 'posti');
    seedTransportOffer(22, 'matkahuolto');
    seedCalculationRecord(101, 11, 21); // beer × posti
    seedCalculationRecord(102, 11, 21); // beer × posti
    seedCalculationRecord(103, 11, 22); // beer × matkahuolto
    seedCalculationRecord(104, 12, 21); // wine_still × posti
    seedCalculationRecord(105, 12, null); // wine_still, no transport offer
    seedOutcome(101, 1020, '2019-06-01T00:00:00.000Z'); // within, outside the period window
    seedOutcome(102, 2000); // outside (beer/posti)
    seedOutcome(103, 980); // within (beer/matkahuolto)
    seedOutcome(104, 1000); // within (wine_still/posti)
    seedOutcome(105, 5000); // outside (wine_still, no offer)
    seedOutcome(901, 1000); // within, record pruned — unattributable
  });

  it('the global two-arg statistic is unchanged by the breakdown support', async () => {
    const stat = await isoOutcomes.findAccuracyStatistic({}, asOf);
    expect(stat).toEqual({
      count: 6,
      withinMarginShare: 4 / 6,
      asOf,
    });
    expect(stat.asOf).toBe(asOf);
  });

  it('filters the statistic by product category through the record join', async () => {
    await expect(
      isoOutcomes.findAccuracyStatistic({}, asOf, { category: 'beer' }),
    ).resolves.toEqual({ count: 3, withinMarginShare: 2 / 3, asOf });
    await expect(
      isoOutcomes.findAccuracyStatistic({}, asOf, { category: 'wine_still' }),
    ).resolves.toEqual({ count: 2, withinMarginShare: 1 / 2, asOf });
  });

  it('an empty filtered sample keeps the honest empty state (count 0, null share)', async () => {
    await expect(
      isoOutcomes.findAccuracyStatistic({}, asOf, { category: 'spirits' }),
    ).resolves.toEqual({ count: 0, withinMarginShare: null, asOf });
  });

  it('filters the statistic by carrier through the transport-offer join', async () => {
    // posti: 101 within, 102 outside, 104 within → 2 of 3.
    await expect(
      isoOutcomes.findAccuracyStatistic({}, asOf, { carrier: 'posti' }),
    ).resolves.toEqual({ count: 3, withinMarginShare: 2 / 3, asOf });
    await expect(
      isoOutcomes.findAccuracyStatistic({}, asOf, { carrier: 'matkahuolto' }),
    ).resolves.toEqual({ count: 1, withinMarginShare: 1, asOf });
    // Records without a transport offer cannot match any carrier.
    await expect(
      isoOutcomes.findAccuracyStatistic({}, asOf, { carrier: 'vr' }),
    ).resolves.toEqual({ count: 0, withinMarginShare: null, asOf });
  });

  it('combines both filters as a conjunction (records join once)', async () => {
    await expect(
      isoOutcomes.findAccuracyStatistic({}, asOf, {
        category: 'beer',
        carrier: 'posti',
      }),
    ).resolves.toEqual({ count: 2, withinMarginShare: 1 / 2, asOf });
    await expect(
      isoOutcomes.findAccuracyStatistic({}, asOf, {
        category: 'wine_still',
        carrier: 'matkahuolto',
      }),
    ).resolves.toEqual({ count: 0, withinMarginShare: null, asOf });
  });

  it('breaks down by category with per-cell count and share, sorted by key', async () => {
    const breakdown = await isoOutcomes.findAccuracyBreakdown(
      {},
      asOf,
      'category',
    );
    expect(breakdown.dimension).toBe('category');
    expect(breakdown.asOf).toBe(asOf);
    expect(breakdown.cells).toEqual([
      { key: 'beer', count: 3, withinMarginShare: 2 / 3 },
      { key: 'wine_still', count: 2, withinMarginShare: 1 / 2 },
    ]);
    // Join honesty: the pruned-record outcome is in the global count
    // but attributable to no category cell (5 < 6).
    const cellSum = breakdown.cells.reduce((sum, c) => sum + c.count, 0);
    expect(cellSum).toBe(5);
  });

  it('breaks down by carrier, excluding offer-less and pruned records', async () => {
    const breakdown = await isoOutcomes.findAccuracyBreakdown(
      {},
      asOf,
      'carrier',
    );
    expect(breakdown.dimension).toBe('carrier');
    expect(breakdown.cells).toEqual([
      { key: 'matkahuolto', count: 1, withinMarginShare: 1 },
      { key: 'posti', count: 3, withinMarginShare: 2 / 3 },
    ]);
  });

  it('honors period bounds in breakdowns and filters', async () => {
    // The 2020-06 batch (all but 101, backdated to 2019-06).
    const window = {
      from: new Date('2020-01-01T00:00:00.000Z'),
      to: new Date('2021-01-01T00:00:00.000Z'),
    };
    // Beer outcomes in the window: 102 (outside), 103 (within).
    await expect(
      isoOutcomes.findAccuracyStatistic(window, asOf, { category: 'beer' }),
    ).resolves.toEqual({ count: 2, withinMarginShare: 1 / 2, asOf });
    // Carriers in the window: 102, 104 → posti; 103 → matkahuolto.
    const byCarrier = await isoOutcomes.findAccuracyBreakdown(
      window,
      asOf,
      'carrier',
    );
    expect(byCarrier.cells).toEqual([
      { key: 'matkahuolto', count: 1, withinMarginShare: 1 },
      { key: 'posti', count: 2, withinMarginShare: 1 / 2 },
    ]);
  });

  it('an empty database yields an empty cell list, not fabricated cells', async () => {
    const fresh = openMigratedD1();
    const freshOutcomes = new D1CalculationOutcomeRepository(fresh.d1);
    const breakdown = await freshOutcomes.findAccuracyBreakdown(
      {},
      asOf,
      'category',
    );
    expect(breakdown).toEqual({ dimension: 'category', cells: [], asOf });
    await expect(
      freshOutcomes.findAccuracyStatistic({}, asOf, { carrier: 'posti' }),
    ).resolves.toEqual({ count: 0, withinMarginShare: null, asOf });
  });
});
