/**
 * D1MerchantReliabilityRepository — the materialized read path (task
 * 3.2, change merchant-reliability-materialized-aggregates), the
 * 2026-10 D1 billing-incident fix. findCurrentOfferAggregates projects
 * merchant_reliability_aggregates (migration 0035) and nothing else:
 * seeded figures pass through unchanged, the merchant-set filter is a
 * primary-key IN read still ordered merchant-ascending, and a merchant
 * without a row is simply absent (the product-page embed fails open by
 * omitting the badge). The incident invariant is asserted behaviorally
 * below: a merchant with live retail_offers rows but no materialized
 * row stays absent — there is NO fallback that re-derives figures from
 * retail_offers per request.
 *
 * Figure parity between the materialized rows and the live aggregate is
 * the writers' contract, enforced at the cron layer
 * (apps/api-worker/src/cron/__tests__/merchant-reliability-aggregates.test.ts)
 * — these tests assert the READ path only.
 *
 * @module D1MerchantReliabilityRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1MerchantReliabilityRepository,
  type MerchantReliabilityAggregate,
} from '../merchant-reliability.repository';

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

/** The one computed_at a test refresh shares — projected for table parity, never mapped. */
const COMPUTED_AT = '2026-10-01T12:00:00.000Z';

/** Fixture for one materialized aggregate row. */
interface AggregateSeed {
  merchant: string;
  offerCount: number;
  verified: number;
  estimated: number;
  stale: number;
  unavailable: number;
  /** Freshest observedAt among the merchant's current offers (ISO-8601). */
  freshestObservedAt: string;
}

/**
 * Insert one aggregate row exactly as the tick's INSERT binds it and
 * return the read model the repository contract must map it to — the
 * fixture and the expectation come from one declaration. The counts go
 * in verbatim: the table's CHECK (the four status buckets sum to
 * offer_count) makes a malformed fixture fail the seed loudly instead
 * of the assertion.
 */
function materialize(seed: AggregateSeed): MerchantReliabilityAggregate {
  db.prepare(
    `INSERT INTO merchant_reliability_aggregates (
       merchant, offer_count, verified_count, estimated_count,
       stale_count, unavailable_count, freshest_observed_at, computed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    seed.merchant,
    seed.offerCount,
    seed.verified,
    seed.estimated,
    seed.stale,
    seed.unavailable,
    seed.freshestObservedAt,
    COMPUTED_AT,
  );
  return {
    merchant: seed.merchant,
    offerCount: seed.offerCount,
    statusCounts: {
      VERIFIED: seed.verified,
      ESTIMATED: seed.estimated,
      STALE: seed.stale,
      UNAVAILABLE: seed.unavailable,
    },
    freshestObservedAt: new Date(seed.freshestObservedAt),
  };
}

describe('D1MerchantReliabilityRepository', () => {
  it('passes materialized figures through unchanged, merchant-ascending', async () => {
    const alkol = materialize({
      merchant: 'alkol',
      offerCount: 3,
      verified: 2,
      estimated: 1,
      stale: 0,
      unavailable: 0,
      freshestObservedAt: '2026-09-28T09:30:00.000Z',
    });
    const beerlin = materialize({
      merchant: 'beerlin',
      offerCount: 2,
      verified: 0,
      estimated: 0,
      stale: 1,
      unavailable: 1,
      freshestObservedAt: '2026-09-30T18:00:00.000Z',
    });

    const aggregates = await repo.findCurrentOfferAggregates();

    // Each seeded merchant comes back exactly as materialized — counts,
    // the freshest_observed_at → Date mapping, and nothing extra
    // (computed_at stays unmapped).
    expect(aggregates.find((a) => a.merchant === 'alkol')).toEqual(alkol);
    expect(aggregates.find((a) => a.merchant === 'beerlin')).toEqual(beerlin);
    // And the unbounded read stays merchant-ascending.
    const merchants = aggregates.map((a) => a.merchant);
    expect(merchants).toEqual([...merchants].sort());
  });

  it('the merchant-set filter returns exactly the requested merchants, in order, figures unchanged', async () => {
    const a = materialize({
      merchant: 'filter-a',
      offerCount: 1,
      verified: 1,
      estimated: 0,
      stale: 0,
      unavailable: 0,
      freshestObservedAt: '2026-09-25T10:00:00.000Z',
    });
    const b = materialize({
      merchant: 'filter-b',
      offerCount: 4,
      verified: 2,
      estimated: 1,
      stale: 0,
      unavailable: 1,
      freshestObservedAt: '2026-09-29T08:15:00.000Z',
    });
    materialize({
      merchant: 'filter-c',
      offerCount: 2,
      verified: 0,
      estimated: 2,
      stale: 0,
      unavailable: 0,
      freshestObservedAt: '2026-09-27T12:45:00.000Z',
    });
    const d = materialize({
      merchant: 'filter-d',
      offerCount: 3,
      verified: 0,
      estimated: 0,
      stale: 2,
      unavailable: 1,
      freshestObservedAt: '2026-09-30T21:30:00.000Z',
    });

    // The product-page embed asks for the page's merchants; the read is
    // a primary-key IN over the materialized table. The set is given in
    // non-sorted order on purpose: the IN bind order must not leak into
    // the result — ORDER BY merchant decides.
    const bounded = await repo.findCurrentOfferAggregates(
      new Set(['filter-d', 'filter-b']),
    );
    expect(bounded.map((row) => row.merchant)).toEqual([
      'filter-b',
      'filter-d',
    ]);
    expect(bounded).toEqual([b, d]);

    // A merchant with no materialized row is simply absent — the embed
    // fails open by omitting the badge, and the others still come back.
    const withGhost = await repo.findCurrentOfferAggregates(
      new Set(['filter-a', 'ghostco', 'filter-d']),
    );
    expect(withGhost.map((row) => row.merchant)).toEqual([
      'filter-a',
      'filter-d',
    ]);
    expect(withGhost).toEqual([a, d]);
  });

  it('never re-derives figures from retail_offers: an unmaterialized merchant stays absent', async () => {
    // The incident state, recreated: live current offers on
    // retail_offers, no materialized row for the merchant (a cold start
    // before the first tick). The live rule would report ghostco at
    // offerCount 1 / VERIFIED 1 / freshest 2026-09-30T18:00:00.000Z —
    // the read must return nothing instead of recomputing. The
    // aggregates table is emptied as this test's own precondition (the
    // tick DELETEs wholesale, so an empty table is a real state).
    db.exec('DELETE FROM merchant_reliability_aggregates');
    const productId = seedProduct();
    seedOffer('ghostco', productId, 'VERIFIED', '2026-09-30T18:00:00.000Z');

    await expect(repo.findCurrentOfferAggregates()).resolves.toEqual([]);
    await expect(
      repo.findCurrentOfferAggregates(new Set(['ghostco'])),
    ).resolves.toEqual([]);
  });

  it('an empty aggregates table degrades to an empty result — no error, no fallback', async () => {
    db.exec('DELETE FROM merchant_reliability_aggregates');

    await expect(repo.findCurrentOfferAggregates()).resolves.toEqual([]);
  });
});
