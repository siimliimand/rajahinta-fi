/**
 * D1 MerchantReliabilityRepository — per-merchant reliability
 * aggregates served from the materialized
 * merchant_reliability_aggregates table (change
 * merchant-reliability-materialized-aggregates), the Cloudflare-side
 * counterpart of the pg DrizzleMerchantReliabilityRepository (task 2.5,
 * change migrate-to-cloudflare), which still computes per call.
 *
 * The "current offer" semantics and the deterministic-latest rule that
 * produce the figures live with the writers — migration 0035's seed and
 * the 30-minute aggregation cron's full refresh (running after the
 * verified-ageing pass each tick). This module only reads what they
 * materialized: figures are at most one tick stale, and the
 * per-request read cost is table size, independent of catalog size and
 * history depth.
 *
 * The aggregate is raw and factual only: per-status counts, offer
 * count, freshest observedAt. The core-domain
 * MerchantReliabilityScoreService turns these rows into the score
 * object — nothing here judges merchant quality.
 *
 * The abstract class and aggregate type are co-located here with the
 * concrete implementation, mirroring the pg module — the pg file chains
 * to `db/drizzle.provider.ts` (pg driver import) for its DRIZZLE token,
 * which D1 code must not import, so the contract is re-declared instead
 * of imported. Shape-identical to the pg declaration.
 *
 * @module D1MerchantReliabilityRepository
 */
import { Injectable } from '@nestjs/common';
import type { ReliabilityStatus } from '@rajahinta/core-domain';
import type { D1DatabaseLike } from '../../d1/executor';

/**
 * Per-merchant factual aggregate over that merchant's current offers.
 *
 * Invariant: the four statusCounts always sum to offerCount — every
 * current offer lands in exactly one bucket. A stored status outside
 * the canonical vocabulary degrades to the ESTIMATED bucket —
 * reliability is never overstated, mirroring the pg repository.
 */
export interface MerchantReliabilityAggregate {
  /** Merchant identifier as stored on retail_offers.merchant. */
  readonly merchant: string;
  /** Current-offer count (one per product) behind the status counts. */
  readonly offerCount: number;
  /** Current-offer counts per canonical reliability status. */
  readonly statusCounts: Readonly<Record<ReliabilityStatus, number>>;
  /** Latest observedAt among the merchant's current offers. */
  readonly freshestObservedAt: Date;
}

/**
 * Read-only per-merchant reliability aggregates, registered in
 * DataPlatformModule under this abstract token.
 */
@Injectable()
export abstract class MerchantReliabilityRepository {
  /**
   * One aggregate row per merchant holding at least one current offer,
   * ordered by merchant ascending (deterministic for display).
   *
   * The rows are tick-materialized (change
   * merchant-reliability-materialized-aggregates): the 30-minute
   * aggregation cron full-refreshes merchant_reliability_aggregates
   * after its verified-ageing pass, so figures are at most one tick
   * stale. A merchant with no row — a cold start before the first
   * tick, or a merchant with no current offers — is simply absent from
   * the result, and the product-page embed fails open by omitting the
   * badge. There is NO fallback path that scans retail_offers per
   * request (the 2026-10 D1 billing-incident invariant).
   *
   * When {@link merchants} is provided, only those merchants are
   * returned — a primary-key IN read over the materialized table,
   * never a recomputation.
   */
  abstract findCurrentOfferAggregates(
    merchants?: ReadonlySet<string>,
  ): Promise<MerchantReliabilityAggregate[]>;
}

/**
 * The materialized read — one row per merchant straight off the
 * merchant primary key. The ESTIMATED-bucket degrade rule and the
 * counts-sum invariant are the writers' guarantees (CHECK-enforced at
 * rest); this statement only projects what they stored.
 */
const MATERIALIZED_AGGREGATES_SQL = `
  SELECT merchant, offer_count, verified_count, estimated_count,
         stale_count, unavailable_count, freshest_observed_at, computed_at
    FROM merchant_reliability_aggregates`;

/**
 * Shared merchant-ascending tail so the bounded and unbounded
 * statements cannot drift.
 */
const MATERIALIZED_AGGREGATES_ORDER_BY = `
   ORDER BY merchant ASC`;

@Injectable()
export class D1MerchantReliabilityRepository
  extends MerchantReliabilityRepository
{
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async findCurrentOfferAggregates(
    merchants?: ReadonlySet<string>,
  ): Promise<MerchantReliabilityAggregate[]> {
    // computed_at is projected for table parity but deliberately not
    // mapped — the exported aggregate shape stays byte-compatible with
    // the pg counterpart, and the score service consumes facts only.
    const merchantList = merchants ? [...merchants] : [];
    const bounded = merchantList.length > 0;
    const sql = bounded
      ? `${MATERIALIZED_AGGREGATES_SQL}
   WHERE merchant IN (` +
        merchantList.map(() => '?').join(', ') +
        `)${MATERIALIZED_AGGREGATES_ORDER_BY}`
      : `${MATERIALIZED_AGGREGATES_SQL}${MATERIALIZED_AGGREGATES_ORDER_BY}`;
    const rows = (
      await this.d1
        .prepare(sql)
        .bind(...(bounded ? merchantList : []))
        .all<{
          merchant: string;
          offer_count: number;
          verified_count: number;
          estimated_count: number;
          stale_count: number;
          unavailable_count: number;
          freshest_observed_at: string;
          computed_at: string;
        }>()
    ).results;

    return rows.map((row) => ({
      merchant: row.merchant,
      offerCount: Number(row.offer_count),
      statusCounts: {
        VERIFIED: Number(row.verified_count),
        ESTIMATED: Number(row.estimated_count),
        STALE: Number(row.stale_count),
        UNAVAILABLE: Number(row.unavailable_count),
      },
      freshestObservedAt: new Date(row.freshest_observed_at),
    }));
  }
}
