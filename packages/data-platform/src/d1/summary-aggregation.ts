/**
 * Summary materialization — pure aggregation over R2-sourced observation
 * batches (task 2.3, design D4 as amended).
 *
 * The pg time-series worker bucketed with TimescaleDB range reads and
 * wrote one summary row per (granularity, periodStart, productId,
 * merchant). On Cloudflare the raw rows come from the R2 JSONL log
 * (design D4, amended), so the bucketing is ported here as pure functions
 * taking row batches — unit-testable without R2 — with the same UTC
 * bucketing semantics D1-side SQL expresses via strftime:
 *
 *   daily  → `strftime('%Y-%m-%d', observed_at)`  (UTC calendar day)
 *   weekly → the Monday opening the ISO 8601 week (design decision 3)
 *
 * (SQLite's `strftime('%W')` is week-of-year with non-ISO semantics, so
 * the weekly anchor is computed app-side; the D1 summary table stores the
 * resulting anchor as period_start exactly as pg did.)
 *
 * Ported 1:1 from
 * packages/application-api/src/jobs/workers/time-series-aggregation.worker.ts
 * (the exported pure helpers there); the average rounding rule,
 * reliability severity order, and per-merchant + product-wide row shapes
 * are pinned by that worker's tests and must not drift.
 *
 * @module D1SummaryAggregation
 */
import {
  RELIABILITY_ORDER,
  type ReliabilityStatus,
} from '@rajahinta/core-domain';
import type { PriceHistorySummaryUpsertInput } from '../abstracts';
import type { ObservationLogRecord } from './observation-log';

/** Summary granularities materialized by the aggregation job. */
export type SummaryGranularity = 'daily' | 'weekly';

/** Bucket width per granularity in milliseconds. */
export const BUCKET_WINDOW_MS: Record<SummaryGranularity, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
};

/** UTC midnight of the instant's calendar day (daily bucket anchor). */
export function startOfUtcDay(instant: Date): Date {
  return new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
}

/** Monday 00:00 UTC of the instant's ISO 8601 week (weekly bucket anchor). */
export function startOfIsoWeek(instant: Date): Date {
  const day = startOfUtcDay(instant);
  // getUTCDay: 0=Sunday..6=Saturday → days elapsed since Monday.
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - daysSinceMonday * 86_400_000);
}

/** Bucket anchor for a granularity. */
export function bucketAnchor(
  granularity: SummaryGranularity,
  instant: Date,
): Date {
  return granularity === 'daily'
    ? startOfUtcDay(instant)
    : startOfIsoWeek(instant);
}

/**
 * Arithmetic mean of integer cents, rounded half-up to the nearest cent
 * (priceHistorySummaries schema convention; amounts are non-negative so
 * half-up equals half-away-from-zero). Computed in exact integer
 * arithmetic — floor((2·sum + count) / (2·count)) — so a true x.5
 * quotient can never drift across the boundary through float division.
 */
export function averageCentsHalfUp(sumCents: number, count: number): number {
  return Math.floor((2 * sumCents + count) / (2 * count));
}

/**
 * Strictest (most conservative) status by the canonical core-domain
 * severity order VERIFIED < ESTIMATED < STALE < UNAVAILABLE — the same
 * RELIABILITY_ORDER constant the schema comments reference, so the
 * aggregation and the schema can never disagree on ordering.
 */
export function strictestReliability(
  statuses: readonly ReliabilityStatus[],
): ReliabilityStatus {
  let strictest = RELIABILITY_ORDER[0];
  for (const status of statuses) {
    if (RELIABILITY_ORDER.indexOf(status) > RELIABILITY_ORDER.indexOf(strictest)) {
      strictest = status;
    }
  }
  return strictest;
}

function isReliabilityStatus(value: unknown): value is ReliabilityStatus {
  return (
    typeof value === 'string' &&
    (RELIABILITY_ORDER as readonly string[]).includes(value)
  );
}

/**
 * An observation's overall reliability: the strictest of its per-input
 * snapshot statuses. R2 rows are parsed JSON — unknown shapes (or an
 * empty snapshot) degrade to UNAVAILABLE, never silently upgrade.
 */
export function observationReliability(
  observation: ObservationLogRecord,
): ReliabilityStatus {
  // R2 rows are parsed JSON — assert through unknown and re-validate each
  // value so unknown shapes degrade to UNAVAILABLE, never silently upgrade.
  const snapshot = observation.input_reliability as unknown as
    | Record<string, unknown>
    | null
    | undefined;
  const known = Object.values(snapshot ?? {}).filter(isReliabilityStatus);
  return known.length > 0 ? strictestReliability(known) : 'UNAVAILABLE';
}

/**
 * Compute the summary rows for one fully-loaded bucket: one row per
 * merchant present in the batch plus one product-wide row (merchant
 * NULL) aggregating across merchants.
 *
 * Preconditions: {@code observations} is non-empty and entirely inside
 * the bucket window. The batch is defensively (re-)sorted by
 * (observed_at, id) — the series order the pg repository range-read
 * contract delivered and R2 append order preserves — so open = earliest
 * observation's value, close = latest's, regardless of caller ordering.
 */
export function buildBucketSummaries(
  granularity: SummaryGranularity,
  periodStart: Date,
  observations: readonly ObservationLogRecord[],
): PriceHistorySummaryUpsertInput[] {
  if (observations.length === 0) {
    return [];
  }

  // Defensive series order: observed_at is fixed-width ISO-8601 UTC, so
  // lexicographic order is chronological order; id breaks ties.
  const ordered = [...observations].sort((a, b) => {
    if (a.observed_at !== b.observed_at) {
      return a.observed_at < b.observed_at ? -1 : 1;
    }
    return a.id - b.id;
  });

  // Preserve first-seen (series) order for deterministic write order.
  const byMerchant = new Map<string, ObservationLogRecord[]>();
  for (const observation of ordered) {
    const group = byMerchant.get(observation.merchant);
    if (group) {
      group.push(observation);
    } else {
      byMerchant.set(observation.merchant, [observation]);
    }
  }

  const periodStartDay = periodStart.toISOString().slice(0, 10);
  const productId = ordered[0].product_id;
  const summaries: PriceHistorySummaryUpsertInput[] = [];

  const emit = (
    merchant: string | null,
    rows: ObservationLogRecord[],
  ): void => {
    const first = rows[0];
    const last = rows[rows.length - 1];
    let priceSum = 0;
    let landedSum = 0;
    let priceMin = first.foreign_retail_price_cents;
    let priceMax = first.foreign_retail_price_cents;
    let landedMin = first.landed_cost_cents;
    let landedMax = first.landed_cost_cents;
    for (const row of rows) {
      priceSum += row.foreign_retail_price_cents;
      landedSum += row.landed_cost_cents;
      priceMin = Math.min(priceMin, row.foreign_retail_price_cents);
      priceMax = Math.max(priceMax, row.foreign_retail_price_cents);
      landedMin = Math.min(landedMin, row.landed_cost_cents);
      landedMax = Math.max(landedMax, row.landed_cost_cents);
    }
    summaries.push({
      granularity,
      periodStart: periodStartDay,
      productId,
      merchant,
      priceOpenCents: first.foreign_retail_price_cents,
      priceCloseCents: last.foreign_retail_price_cents,
      priceMinCents: priceMin,
      priceMaxCents: priceMax,
      priceAvgCents: averageCentsHalfUp(priceSum, rows.length),
      landedCostOpenCents: first.landed_cost_cents,
      landedCostCloseCents: last.landed_cost_cents,
      landedCostMinCents: landedMin,
      landedCostMaxCents: landedMax,
      landedCostAvgCents: averageCentsHalfUp(landedSum, rows.length),
      observationCount: rows.length,
      strictestReliability: strictestReliability(
        rows.map(observationReliability),
      ),
    });
  };

  for (const [merchant, rows] of byMerchant) {
    emit(merchant, rows);
  }
  // Product-wide row across all merchants of this product-period.
  emit(null, ordered);
  return summaries;
}
