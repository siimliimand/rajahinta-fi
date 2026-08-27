/**
 * Merchant reliability aggregate repository — factual per-merchant
 * aggregation over CURRENT retail offers.
 *
 * A merchant's "current" offers are the latest row per (merchant,
 * product) in the append-only retail_offers history, resolved by
 * (observedAt, id) descending — the same deterministic-latest rule as
 * the ingestion change-detection lookup (upsert-port.adapter). History
 * rows superseded by a newer observation do not count.
 *
 * The aggregate is raw and factual only: per-status counts, offer
 * count, freshest observedAt. The core-domain
 * MerchantReliabilityScoreService (change phase2-advanced-features,
 * task 2.1) turns these rows into the score object — nothing here
 * judges merchant quality.
 *
 * The abstract class and aggregate type are co-located with the single
 * concrete implementation to keep this change self-contained; hoist
 * into ../abstracts.ts and re-export from the package index when the
 * API consumer (task 3.4) needs the token from the package root.
 *
 * @module MerchantReliabilityRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { asc, desc, sql } from 'drizzle-orm';
import type { ReliabilityStatus } from '@rajahinta/core-domain';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import { retailOffers } from '../schema';

/**
 * Per-merchant factual aggregate over that merchant's current offers.
 *
 * Invariant: the four statusCounts always sum to offerCount — every
 * current offer lands in exactly one bucket. A stored status outside
 * the canonical vocabulary (the column is a free varchar; legacy or
 * manually loaded rows) degrades to the ESTIMATED bucket — reliability
 * is never overstated, mirroring the adapter-level narrowings in
 * ProductDataAdapter / OfferChangeRecorderHook.
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

@Injectable()
export class DrizzleMerchantReliabilityRepository
  extends MerchantReliabilityRepository
{
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async findCurrentOfferAggregates(): Promise<
    MerchantReliabilityAggregate[]
  > {
    // Current offers: latest row per (merchant, product). DISTINCT ON
    // keeps one row per group; the leading ORDER BY columns must match
    // the DISTINCT ON expressions, and the (observedAt, id) DESC
    // tie-break makes "latest" deterministic when scrapes share a
    // timestamp. Served by the (merchant, product_id, observed_at)
    // index.
    const currentOffers = this.db
      .selectDistinctOn(
        [retailOffers.merchant, retailOffers.productId],
        {
          merchant: retailOffers.merchant,
          reliabilityStatus: retailOffers.reliabilityStatus,
          observedAt: retailOffers.observedAt,
        },
      )
      .from(retailOffers)
      .orderBy(
        retailOffers.merchant,
        retailOffers.productId,
        desc(retailOffers.observedAt),
        desc(retailOffers.id),
      )
      .as('current_offers');

    const status = currentOffers.reliabilityStatus;

    // ESTIMATED bucket = anything not exactly VERIFIED/STALE/UNAVAILABLE
    // (`is distinct from`, so a NULL would degrade too even though the
    // column is NOT NULL). The four FILTER clauses partition all rows,
    // so the counts sum to offerCount by construction. max(observed_at)
    // is non-null in every group — a group exists only when count(*) ≥ 1.
    const rows = await this.db
      .select({
        merchant: currentOffers.merchant,
        offerCount: sql<number>`count(*)`.mapWith(Number),
        verifiedCount:
          sql<number>`count(*) filter (where ${status} = 'VERIFIED')`.mapWith(
            Number,
          ),
        estimatedCount:
          sql<number>`count(*) filter (where ${status} is distinct from 'VERIFIED' and ${status} is distinct from 'STALE' and ${status} is distinct from 'UNAVAILABLE')`.mapWith(
            Number,
          ),
        staleCount:
          sql<number>`count(*) filter (where ${status} = 'STALE')`.mapWith(
            Number,
          ),
        unavailableCount:
          sql<number>`count(*) filter (where ${status} = 'UNAVAILABLE')`.mapWith(
            Number,
          ),
        freshestObservedAt:
          sql<Date>`max(${currentOffers.observedAt})`.mapWith(
            retailOffers.observedAt,
          ),
      })
      .from(currentOffers)
      .groupBy(currentOffers.merchant)
      .orderBy(asc(currentOffers.merchant));

    return rows.map((row) => ({
      merchant: row.merchant,
      offerCount: row.offerCount,
      statusCounts: {
        VERIFIED: row.verifiedCount,
        ESTIMATED: row.estimatedCount,
        STALE: row.staleCount,
        UNAVAILABLE: row.unavailableCount,
      },
      freshestObservedAt: row.freshestObservedAt,
    }));
  }
}
