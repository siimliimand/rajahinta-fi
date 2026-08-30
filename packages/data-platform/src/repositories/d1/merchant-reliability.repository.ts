/**
 * D1 MerchantReliabilityRepository — factual per-merchant aggregation
 * over CURRENT retail offers, the Cloudflare-side counterpart of the pg
 * DrizzleMerchantReliabilityRepository (task 2.5, change
 * migrate-to-cloudflare).
 *
 * A merchant's "current" offers are the latest row per (merchant,
 * product) in the append-only retail_offers history, resolved by
 * (observed_at, id) descending — the same deterministic-latest rule as
 * the pg DISTINCT ON query. SQLite has no DISTINCT ON; the translation
 * is a ROW_NUMBER() window (D1 supports window functions) with the
 * identical partition/order specification.
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
 * Read-only reliability aggregation over current retail offers,
 * registered in DataPlatformModule under this abstract token.
 */
@Injectable()
export abstract class MerchantReliabilityRepository {
  /**
   * One aggregate row per merchant holding at least one current offer,
   * ordered by merchant ascending (deterministic for display). Merchants
   * with no offers do not appear — there is nothing factual to report.
   */
  abstract findCurrentOfferAggregates(): Promise<
    MerchantReliabilityAggregate[]
  >;
}

/** Latest row per (merchant, product_id) by (observed_at, id) DESC. */
const CURRENT_OFFER_AGGREGATES_SQL = `
  WITH ranked AS (
    SELECT merchant, reliability_status, observed_at,
           ROW_NUMBER() OVER (
             PARTITION BY merchant, product_id
             ORDER BY observed_at DESC, id DESC
           ) AS rn
      FROM retail_offers
  )
  SELECT merchant,
         COUNT(*) AS offer_count,
         SUM(CASE WHEN reliability_status = 'VERIFIED' THEN 1 ELSE 0 END)
           AS verified_count,
         SUM(CASE WHEN reliability_status IS NOT 'VERIFIED'
                   AND reliability_status IS NOT 'STALE'
                   AND reliability_status IS NOT 'UNAVAILABLE'
                  THEN 1 ELSE 0 END)
           AS estimated_count,
         SUM(CASE WHEN reliability_status = 'STALE' THEN 1 ELSE 0 END)
           AS stale_count,
         SUM(CASE WHEN reliability_status = 'UNAVAILABLE' THEN 1 ELSE 0 END)
           AS unavailable_count,
         MAX(observed_at) AS freshest_observed_at
    FROM ranked
   WHERE rn = 1
   GROUP BY merchant
   ORDER BY merchant ASC`;

@Injectable()
export class D1MerchantReliabilityRepository
  extends MerchantReliabilityRepository
{
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async findCurrentOfferAggregates(): Promise<
    MerchantReliabilityAggregate[]
  > {
    // The ESTIMATED bucket is anything not exactly VERIFIED/STALE/
    // UNAVAILABLE — SQLite's `IS NOT` is the NULL-safe IS DISTINCT FROM,
    // so a NULL status would degrade too even though the column is NOT
    // NULL. The four CASE arms partition all rows, so the counts sum to
    // offer_count by construction; MAX(observed_at) is non-null in every
    // group — a group exists only when COUNT(*) >= 1.
    const rows = (
      await this.d1
        .prepare(CURRENT_OFFER_AGGREGATES_SQL)
        .all<{
          merchant: string;
          offer_count: number;
          verified_count: number;
          estimated_count: number;
          stale_count: number;
          unavailable_count: number;
          freshest_observed_at: string;
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
