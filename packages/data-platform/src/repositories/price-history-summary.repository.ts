/**
 * Drizzle PriceHistorySummaryRepository — concrete implementation of the
 * abstract PriceHistorySummaryRepository class backed by the
 * price_history_summaries table.
 *
 * Storage adapter for the materialized daily/weekly chart aggregates:
 * written by the time-series aggregation background job (change
 * 2026-08-26-phase2-historical-price-intelligence, task 3.1) via the
 * idempotent upsert, read by the historical-data API (task 4.1) via the
 * range read.
 *
 * Idempotency: the upsert conflicts on the bucket unique key
 * (granularity, period_start, product_id, merchant) and overwrites every
 * aggregate column — re-running the aggregation job over the same period
 * converges (last write wins). The constraint is UNIQUE NULLS NOT
 * DISTINCT, so the merchant-NULL product-wide row is matched by the
 * plain column conflict target; no sentinel merchant or COALESCE
 * expression is involved (see schema.ts).
 *
 * The range read stays index-aligned with
 * price_history_summaries_granularity_product_id_period_start_idx:
 * equality on (granularity, product_id), closed [from, to] range and
 * ascending order on period_start.
 *
 * @module DrizzlePriceHistorySummaryRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  PriceHistorySummaryRepository,
  type PriceHistorySummaryRecord,
  type PriceHistorySummaryUpsertInput,
} from '../abstracts';
import { priceHistorySummaries } from '../schema';

@Injectable()
export class DrizzlePriceHistorySummaryRepository extends PriceHistorySummaryRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async upsertBucket(
    summary: PriceHistorySummaryUpsertInput,
  ): Promise<{ id: number }> {
    // Conflict on the bucket unique key, last write wins: the key columns
    // are immutable (they ARE the key), every computed column is
    // overwritten from the input so a job re-run converges. The values
    // come from the input object itself — with a single-row insert they
    // are exactly the row the conflict arbiter would see as `excluded`.
    const [row] = await this.db
      .insert(priceHistorySummaries)
      .values(summary)
      .onConflictDoUpdate({
        target: [
          priceHistorySummaries.granularity,
          priceHistorySummaries.periodStart,
          priceHistorySummaries.productId,
          priceHistorySummaries.merchant,
        ],
        set: {
          priceOpenCents: summary.priceOpenCents,
          priceCloseCents: summary.priceCloseCents,
          priceMinCents: summary.priceMinCents,
          priceMaxCents: summary.priceMaxCents,
          priceAvgCents: summary.priceAvgCents,
          landedCostOpenCents: summary.landedCostOpenCents,
          landedCostCloseCents: summary.landedCostCloseCents,
          landedCostMinCents: summary.landedCostMinCents,
          landedCostMaxCents: summary.landedCostMaxCents,
          landedCostAvgCents: summary.landedCostAvgCents,
          observationCount: summary.observationCount,
          strictestReliability: summary.strictestReliability,
        },
      })
      .returning({ id: priceHistorySummaries.id });
    return { id: row.id };
  }

  /** @inheritdoc */
  async findByProductRange(
    productId: number,
    granularity: string,
    from: string,
    to: string,
    merchant?: string | null,
  ): Promise<PriceHistorySummaryRecord[]> {
    // Binary merchant semantics — never "all rows": null/omitted reads
    // the product-wide rows (merchant IS NULL), a given merchant reads
    // that merchant's rows. Mixing would stack several points into one
    // chart period.
    const merchantPredicate =
      merchant != null
        ? eq(priceHistorySummaries.merchant, merchant)
        : isNull(priceHistorySummaries.merchant);
    return this.db
      .select()
      .from(priceHistorySummaries)
      .where(
        and(
          eq(priceHistorySummaries.granularity, granularity),
          eq(priceHistorySummaries.productId, productId),
          // Closed [from, to] on the whole-day period anchor: the last
          // requested day's bucket is included.
          gte(priceHistorySummaries.periodStart, from),
          lte(priceHistorySummaries.periodStart, to),
          merchantPredicate,
        ),
      )
      // Ascending period order follows the (granularity, product_id,
      // period_start) index — the index delivers rows pre-sorted.
      .orderBy(asc(priceHistorySummaries.periodStart));
  }
}
