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
   *
   * When {@link merchants} is provided, only those merchants are
   * aggregated — same rows, same deterministic-latest rule, but the read
   * is bounded by the `retail_offers_merchant_product_id_observed_at_idx`
   * leading column so a per-request caller (the product-page reliability
   * embed) never pays the whole-catalog window scan. Undefined/empty
   * keeps the unbounded whole-catalog read.
   */
  abstract findCurrentOfferAggregates(
    merchants?: ReadonlySet<string>,
  ): Promise<MerchantReliabilityAggregate[]>;
}

/**
 * The ranked CTE shared by the unbounded statement and the bounded
 * variant — latest row per (merchant, product_id) by (observed_at, id)
 * DESC. Only the merchant filter (appended between `retail_offers` and
 * the CTE's closing parenthesis) differs between the two statements.
 */
const CURRENT_OFFER_AGGREGATES_RANKED_CTE = `
  WITH ranked AS (
    SELECT merchant, reliability_status, observed_at,
           ROW_NUMBER() OVER (
             PARTITION BY merchant, product_id
             ORDER BY observed_at DESC, id DESC
           ) AS rn
      FROM retail_offers`;

/**
 * The aggregate SELECT over the ranked CTE — one shared copy so the
 * unbounded and bounded statements cannot drift (the ESTIMATED-bucket
 * CASE rule especially).
 */
const CURRENT_OFFER_AGGREGATES_TAIL = `
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

/** Whole-catalog statement — every merchant holding a current offer. */
const CURRENT_OFFER_AGGREGATES_SQL =
  CURRENT_OFFER_AGGREGATES_RANKED_CTE + CURRENT_OFFER_AGGREGATES_TAIL;

/**
 * D1 caps bound parameters at 100 per query and the bounded variant's
 * merchant IN (...) list binds one parameter per merchant. Callers pass
 * page-sized sets, far below the cap — the guard only turns what would
 * be an opaque D1 rejection into a clear error at the construction site.
 */
const D1_BOUND_PARAMETER_CAP = 100;

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
    // The ESTIMATED bucket is anything not exactly VERIFIED/STALE/
    // UNAVAILABLE — SQLite's `IS NOT` is the NULL-safe IS DISTINCT FROM,
    // so a NULL status would degrade too even though the column is NOT
    // NULL. The four CASE arms partition all rows, so the counts sum to
    // offer_count by construction; MAX(observed_at) is non-null in every
    // group — a group exists only when COUNT(*) >= 1.
    //
    // A provided merchant set bounds the scan to those merchants'
    // index ranges — the product-page embed asks for the page's handful
    // of merchants, and the unbounded whole-catalog window scan was
    // measured at ~775k rows read per call on production (2026-10
    // D1 billing incident: every product detail read the full
    // retail_offers history to render one informational badge).
    const merchantList = merchants ? [...merchants] : [];
    if (merchantList.length > D1_BOUND_PARAMETER_CAP) {
      throw new Error(
        `findCurrentOfferAggregates: merchant set (${merchantList.length}) exceeds the D1 bound-parameter cap (${D1_BOUND_PARAMETER_CAP})`,
      );
    }
    const bounded = merchantList.length > 0;
    const sql = bounded
      ? CURRENT_OFFER_AGGREGATES_RANKED_CTE +
        `
     WHERE merchant IN (` +
        merchantList.map(() => '?').join(', ') +
        `)${CURRENT_OFFER_AGGREGATES_TAIL}`
      : CURRENT_OFFER_AGGREGATES_SQL;
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
