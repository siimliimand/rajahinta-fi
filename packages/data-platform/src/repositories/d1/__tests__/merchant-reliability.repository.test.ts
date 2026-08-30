/**
 * D1MerchantReliabilityRepository — real-SQLite tests (task 2.5): the
 * deterministic-latest current-offer rule (ROW_NUMBER window replacing
 * pg DISTINCT ON), the counts-sum-to-offerCount invariant, non-canonical
 * status degradation to ESTIMATED, and the freshest observedAt.
 *
 * @module D1MerchantReliabilityRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1MerchantReliabilityRepository } from '../merchant-reliability.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1MerchantReliabilityRepository(d1);

let productSeq = 700;
function seedProduct(): number {
  const id = ++productSeq;
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
     VALUES (?, ?, 'm', 'b', 'beer', 0.5, 'glass', 'beer')`,
  ).run(id, `product-${id}`);
  return id;
}

let offerSeq = 0;
function seedOffer(merchant: string, productId: number, status: string, observedAt: string): number {
  const id = ++offerSeq + 5000;
  db.prepare(
    `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents, observed_at, reliability_status)
     VALUES (?, ?, 'EE', ?, 500, ?, ?)`,
  ).run(id, merchant, productId, observedAt, status);
  return id;
}

describe('D1MerchantReliabilityRepository', () => {
  it('aggregates only CURRENT offers: latest row per (merchant, product) wins', async () => {
    const p1 = seedProduct();
    const p2 = seedProduct();

    // alkol history: p1 superseded twice, p2 current once.
    seedOffer('alkol', p1, 'VERIFIED', '2026-08-01T00:00:00.000Z');
    seedOffer('alkol', p1, 'STALE', '2026-08-05T00:00:00.000Z');
    seedOffer('alkol', p1, 'VERIFIED', '2026-08-10T00:00:00.000Z');
    seedOffer('alkol', p2, 'ESTIMATED', '2026-08-09T00:00:00.000Z');

    const aggregates = await repo.findCurrentOfferAggregates();
    const alkol = aggregates.find((a) => a.merchant === 'alkol')!;
    expect(alkol.offerCount).toBe(2); // two products, not three rows
    expect(alkol.statusCounts).toEqual({
      VERIFIED: 1, // latest p1 row (superseded STALE rows do not count)
      ESTIMATED: 1,
      STALE: 0,
      UNAVAILABLE: 0,
    });
    expect(alkol.freshestObservedAt).toEqual(new Date('2026-08-10T00:00:00.000Z'));
  });

  it('breaks observedAt ties deterministically by id descending', async () => {
    const p = seedProduct();
    const olderId = seedOffer('tieco', p, 'STALE', '2026-08-12T00:00:00.000Z');
    const newerId = seedOffer('tieco', p, 'VERIFIED', '2026-08-12T00:00:00.000Z');
    expect(newerId).toBeGreaterThan(olderId);

    const tieco = (await repo.findCurrentOfferAggregates()).find((a) => a.merchant === 'tieco')!;
    expect(tieco.statusCounts.VERIFIED).toBe(1);
    expect(tieco.statusCounts.STALE).toBe(0);
  });

  it('the schema CHECK rejects non-canonical statuses before they can be stored', async () => {
    // pg stored reliability_status as a free varchar and the aggregate
    // degraded unknown values to the ESTIMATED bucket. The D1 schema
    // adds the reliability CHECK at the table level, so a non-canonical
    // status cannot reach the aggregation at all — the degradation CASE
    // arms stay as defense in depth for NULL-safe matching.
    const p = seedProduct();
    expect(() => seedOffer('weirdco', p, 'WEIRD', '2026-08-01T00:00:00.000Z')).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('keeps the counts-sum-to-offerCount invariant on canonical statuses', async () => {
    const p = seedProduct();
    seedOffer('invariantco', p, 'VERIFIED', '2026-08-01T00:00:00.000Z');
    seedOffer('invariantco', p, 'STALE', '2026-08-02T00:00:00.000Z');
    seedOffer('invariantco', p, 'UNAVAILABLE', '2026-08-03T00:00:00.000Z');

    const invariantco = (await repo.findCurrentOfferAggregates()).find(
      (a) => a.merchant === 'invariantco',
    )!;
    const sum = Object.values(invariantco.statusCounts).reduce((a, b) => a + b, 0);
    expect(invariantco.offerCount).toBe(1);
    expect(sum).toBe(invariantco.offerCount);
    expect(invariantco.statusCounts.UNAVAILABLE).toBe(1);
  });

  it('orders aggregates by merchant ascending and omits offer-less merchants', async () => {
    const merchants = (await repo.findCurrentOfferAggregates()).map((a) => a.merchant);
    expect(merchants).toEqual([...merchants].sort());
    expect(merchants).not.toContain('never-scraped');
  });
});
