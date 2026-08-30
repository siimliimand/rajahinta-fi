/**
 * D1 PriceHistorySummaryRepository — the Cloudflare-side implementation of
 * the abstract {@link PriceHistorySummaryRepository} contract (task 2.3,
 * change migrate-to-cloudflare), backed by the D1 `price_history_summaries`
 * table. Signatures and upsert semantics match the pg
 * DrizzlePriceHistorySummaryRepository exactly.
 *
 * ## The UNIQUE NULLS NOT DISTINCT compensation
 *
 * The bucket key (granularity, period_start, product_id, merchant) is
 * `UNIQUE NULLS NOT DISTINCT` on pg, so a plain column ON CONFLICT target
 * matches the product-wide row (merchant NULL). SQLite has no NULLS NOT
 * DISTINCT — NULLs are always distinct — so an ON CONFLICT clause naming
 * `merchant` NEVER matches the product-wide row and a re-run would
 * duplicate it (documented in src/d1/schema.ts at the constraint).
 *
 * The compensation lives here in the upsert path: resolve the existing
 * row with SQLite's NULL-safe `IS` equality (`merchant IS ?`, binding
 * null for the product-wide bucket), then UPDATE by id or INSERT — the
 * write-then-advance aggregation protocol re-runs are idempotent because
 * this converges on one row per bucket key in both cases. Statement
 * execution on D1/SQLite is serialized (single writer), which is the same
 * concurrency envelope the single-instance aggregation job requires.
 *
 * Raw SQL through the {@link D1DatabaseLike} executor: the `IS`-based
 * compensation is not expressible as a drizzle onConflictDoUpdate target.
 *
 * @module D1PriceHistorySummaryRepository
 */
import { Injectable } from '@nestjs/common';
import {
  PriceHistorySummaryRepository,
  type PriceHistorySummaryRecord,
  type PriceHistorySummaryUpsertInput,
} from '../../abstracts';
import type { D1DatabaseLike } from '../../d1/executor';

/** Contract row type (canonical shape — identical columns on D1). */
type SummaryRecord = PriceHistorySummaryRecord;

const SUMMARY_COLUMNS = `
  id, granularity, period_start, product_id, merchant,
  price_open_cents, price_close_cents, price_min_cents, price_max_cents,
  price_avg_cents, landed_cost_open_cents, landed_cost_close_cents,
  landed_cost_min_cents, landed_cost_max_cents, landed_cost_avg_cents,
  observation_count, strictest_reliability`;

interface D1SummaryRow {
  readonly id: number;
  readonly granularity: string;
  readonly period_start: string;
  readonly product_id: number;
  readonly merchant: string | null;
  readonly price_open_cents: number;
  readonly price_close_cents: number;
  readonly price_min_cents: number;
  readonly price_max_cents: number;
  readonly price_avg_cents: number;
  readonly landed_cost_open_cents: number;
  readonly landed_cost_close_cents: number;
  readonly landed_cost_min_cents: number;
  readonly landed_cost_max_cents: number;
  readonly landed_cost_avg_cents: number;
  readonly observation_count: number;
  readonly strictest_reliability: string;
}

function toContractRecord(row: D1SummaryRow): SummaryRecord {
  return {
    id: row.id,
    granularity: row.granularity,
    periodStart: row.period_start,
    productId: row.product_id,
    merchant: row.merchant,
    priceOpenCents: row.price_open_cents,
    priceCloseCents: row.price_close_cents,
    priceMinCents: row.price_min_cents,
    priceMaxCents: row.price_max_cents,
    priceAvgCents: row.price_avg_cents,
    landedCostOpenCents: row.landed_cost_open_cents,
    landedCostCloseCents: row.landed_cost_close_cents,
    landedCostMinCents: row.landed_cost_min_cents,
    landedCostMaxCents: row.landed_cost_max_cents,
    landedCostAvgCents: row.landed_cost_avg_cents,
    observationCount: row.observation_count,
    strictestReliability: row.strictest_reliability,
  };
}

/** Computed columns in both the INSERT and the UPDATE's SET order. */
function aggregateParams(summary: PriceHistorySummaryUpsertInput): unknown[] {
  return [
    summary.priceOpenCents,
    summary.priceCloseCents,
    summary.priceMinCents,
    summary.priceMaxCents,
    summary.priceAvgCents,
    summary.landedCostOpenCents,
    summary.landedCostCloseCents,
    summary.landedCostMinCents,
    summary.landedCostMaxCents,
    summary.landedCostAvgCents,
    summary.observationCount,
    summary.strictestReliability,
  ];
}

const BUCKET_LOOKUP_SQL = `
  SELECT id FROM price_history_summaries
   WHERE granularity = ? AND period_start = ? AND product_id = ?
     AND merchant IS ?`;

const INSERT_SQL = `
  INSERT INTO price_history_summaries (
    granularity, period_start, product_id, merchant,
    price_open_cents, price_close_cents, price_min_cents, price_max_cents,
    price_avg_cents, landed_cost_open_cents, landed_cost_close_cents,
    landed_cost_min_cents, landed_cost_max_cents, landed_cost_avg_cents,
    observation_count, strictest_reliability
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id`;

const UPDATE_SQL = `
  UPDATE price_history_summaries SET
    price_open_cents = ?, price_close_cents = ?, price_min_cents = ?,
    price_max_cents = ?, price_avg_cents = ?,
    landed_cost_open_cents = ?, landed_cost_close_cents = ?,
    landed_cost_min_cents = ?, landed_cost_max_cents = ?,
    landed_cost_avg_cents = ?, observation_count = ?,
    strictest_reliability = ?
   WHERE id = ?
   RETURNING id`;

const RANGE_READ_SQL = `
  SELECT ${SUMMARY_COLUMNS}
    FROM price_history_summaries
   WHERE granularity = ? AND product_id = ?
     AND period_start >= ? AND period_start <= ?
     AND merchant IS ?
   ORDER BY period_start ASC`;

@Injectable()
export class D1PriceHistorySummaryRepository extends PriceHistorySummaryRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /**
   * Insert or overwrite one bucket row keyed by (granularity, periodStart,
   * productId, merchant). Returns the row id (existing id on conflict —
   * the key columns never change). Last write wins: every computed column
   * is overwritten, the key columns and id are not.
   */
  async upsertBucket(
    summary: PriceHistorySummaryUpsertInput,
  ): Promise<{ id: number }> {
    // NULLS NOT DISTINCT compensation: `merchant IS ?` matches the
    // product-wide row (bound null) and merchant rows alike — the lookup
    // the plain UNIQUE index's ON CONFLICT cannot perform on SQLite.
    const existing = await this.d1
      .prepare(BUCKET_LOOKUP_SQL)
      .bind(
        summary.granularity,
        summary.periodStart,
        summary.productId,
        summary.merchant ?? null,
      )
      .first<{ id: number }>();

    if (existing) {
      const row = await this.d1
        .prepare(UPDATE_SQL)
        .bind(...aggregateParams(summary), existing.id)
        .first<{ id: number }>();
      if (!row) {
        throw new Error(
          'price_history_summaries UPDATE .. RETURNING returned no row',
        );
      }
      return { id: row.id };
    }

    const inserted = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        summary.granularity,
        summary.periodStart,
        summary.productId,
        summary.merchant ?? null,
        ...aggregateParams(summary),
      )
      .first<{ id: number }>();
    if (!inserted) {
      throw new Error(
        'price_history_summaries INSERT .. RETURNING returned no row',
      );
    }
    return { id: inserted.id };
  }

  /**
   * Range read of one product's summary series at one granularity over
   * the closed [from, to] period-start range. Omitting `merchant` (or
   * null) reads ONLY the product-wide rows (merchant IS NULL); a given
   * merchant reads only that merchant's rows — binary semantics, matching
   * the pg repository. Ordered by periodStart ascending.
   */
  async findByProductRange(
    productId: number,
    granularity: string,
    from: string,
    to: string,
    merchant?: string | null,
  ): Promise<SummaryRecord[]> {
    const rows = (
      await this.d1
        .prepare(RANGE_READ_SQL)
        .bind(granularity, productId, from, to, merchant ?? null)
        .all<D1SummaryRow>()
    ).results;
    return rows.map(toContractRecord);
  }
}
