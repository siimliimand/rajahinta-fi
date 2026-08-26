import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUES } from '@rajahinta/data-acquisition';
import { RELIABILITY_ORDER, type ReliabilityStatus } from '@rajahinta/core-domain';
import {
  PriceObservationRepository,
  PriceHistorySummaryRepository,
  AggregationWatermarkRepository,
  type PriceObservationRecord,
  type PriceHistorySummaryUpsertInput,
  type ProductActivitySince,
} from '@rajahinta/data-platform';

/**
 * Time-series aggregation job payload.
 *
 * Both fields are optional: the scheduled runs pass a nominal
 * {@link bucketStart}/{@link windowMinutes} window, while manual or test
 * enqueues may omit them entirely for a pure watermark-driven scan.
 */
export interface TimeSeriesAggregationJobData {
  /**
   * Optional ISO-8601 instant anchoring an explicit aggregation window
   * (e.g. '2026-08-15T00:00:00Z'). When it lies before the persisted
   * watermark the run re-scans from it — the backfill/late-correction
   * trigger. It never bounds the scan from above.
   */
  readonly bucketStart?: string;
  /** Optional aggregation window width in minutes (informational). */
  readonly windowMinutes?: number;
}

/** Summary granularities materialized by this worker. */
type Granularity = 'daily' | 'weekly';

const GRANULARITIES: readonly Granularity[] = ['daily', 'weekly'];

/** Bucket width per granularity in milliseconds. */
const BUCKET_WINDOW_MS: Record<Granularity, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
};

/**
 * Scan origin before any watermark exists: the first run materializes
 * the full observation log (initial backfill), after which the
 * watermark keeps every subsequent scan incremental.
 */
const EPOCH = new Date(0);

/** Persisted-watermark key — one watermark row per aggregating job. */
const WATERMARK_KEY = QUEUES.TIME_SERIES_AGGREGATION;

// ---------------------------------------------------------------------------
// Pure bucketing / aggregation helpers (exported for unit tests)
// ---------------------------------------------------------------------------

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

/**
 * Arithmetic mean of integer cents, rounded half-up to the nearest cent
 * (schema.ts priceHistorySummaries convention; amounts are non-negative
 * so half-up equals half-away-from-zero). Computed in exact integer
 * arithmetic — floor((2·sum + count) / (2·count)) — so a true x.5
 * quotient can never drift across the boundary through float division.
 */
export function averageCentsHalfUp(sumCents: number, count: number): number {
  return Math.floor((2 * sumCents + count) / (2 * count));
}

/**
 * Strictest (most conservative) status by the canonical core-domain
 * severity order VERIFIED < ESTIMATED < STALE < UNAVAILABLE — the same
 * RELIABILITY_ORDER constant the schema comments reference, so worker
 * and schema can never disagree on ordering.
 */
export function strictestReliability(statuses: ReliabilityStatus[]): ReliabilityStatus {
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
    (RELIABILITY_ORDER as string[]).includes(value)
  );
}

/**
 * An observation's overall reliability: the strictest of its per-input
 * snapshot statuses. Unknown shapes (or an empty snapshot) degrade to
 * UNAVAILABLE — never silently upgrade.
 */
function observationReliability(observation: PriceObservationRecord): ReliabilityStatus {
  const snapshot =
    observation.inputReliability as Record<string, unknown> | null | undefined;
  const known = Object.values(snapshot ?? {}).filter(isReliabilityStatus);
  return known.length > 0 ? strictestReliability(known) : 'UNAVAILABLE';
}

/** Bucket unique key used for logging and test assertions. */
function bucketKey(
  granularity: string,
  periodStart: string,
  productId: number,
  merchant: string | null,
): string {
  return `${granularity}|${periodStart}|${productId}|${merchant ?? '*'}`;
}

/**
 * Compute the summary rows for one fully-loaded bucket: one row per
 * merchant present in the bucket plus one product-wide row
 * (merchant NULL) aggregating across merchants.
 *
 * Preconditions: {@code observations} is non-empty, entirely inside the
 * bucket window, and ordered by (observedAt, id) ascending — the
 * repository range-read contract. open = earliest observation's value,
 * close = latest's; avg is the half-up arithmetic mean.
 */
export function buildBucketSummaries(
  granularity: Granularity,
  periodStart: Date,
  observations: PriceObservationRecord[],
): PriceHistorySummaryUpsertInput[] {
  if (observations.length === 0) {
    return [];
  }

  // Preserve first-seen (series) order for deterministic write order.
  const byMerchant = new Map<string, PriceObservationRecord[]>();
  for (const observation of observations) {
    const group = byMerchant.get(observation.merchant);
    if (group) {
      group.push(observation);
    } else {
      byMerchant.set(observation.merchant, [observation]);
    }
  }

  const periodStartDay = periodStart.toISOString().slice(0, 10);
  const productId = observations[0].productId;
  const summaries: PriceHistorySummaryUpsertInput[] = [];

  const emit = (merchant: string | null, rows: PriceObservationRecord[]): void => {
    const first = rows[0];
    const last = rows[rows.length - 1];
    let priceSum = 0;
    let landedSum = 0;
    let priceMin = first.foreignRetailPriceCents;
    let priceMax = first.foreignRetailPriceCents;
    let landedMin = first.landedCostCents;
    let landedMax = first.landedCostCents;
    for (const row of rows) {
      priceSum += row.foreignRetailPriceCents;
      landedSum += row.landedCostCents;
      priceMin = Math.min(priceMin, row.foreignRetailPriceCents);
      priceMax = Math.max(priceMax, row.foreignRetailPriceCents);
      landedMin = Math.min(landedMin, row.landedCostCents);
      landedMax = Math.max(landedMax, row.landedCostCents);
    }
    summaries.push({
      granularity,
      periodStart: periodStartDay,
      productId,
      merchant,
      priceOpenCents: first.foreignRetailPriceCents,
      priceCloseCents: last.foreignRetailPriceCents,
      priceMinCents: priceMin,
      priceMaxCents: priceMax,
      priceAvgCents: averageCentsHalfUp(priceSum, rows.length),
      landedCostOpenCents: first.landedCostCents,
      landedCostCloseCents: last.landedCostCents,
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
  emit(null, observations);
  return summaries;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/**
 * Materializes daily and weekly price-history summaries from the raw
 * observation log (change 2026-08-26-phase2-historical-price-intelligence,
 * task 3.1).
 *
 * ## Incremental scan protocol (write-then-advance)
 *
 * 1. Read the persisted watermark (aggregation_watermarks, keyed by the
 *    queue name). Null on first run → scan from the epoch (initial
 *    backfill). The watermark is never kept in worker memory only.
 * 2. Scan observations at-or-after max(watermark, payload bucketStart).
 *    The inclusive lower bound re-scans the boundary instant — upserts
 *    are idempotent, so re-scan converges, while a strict bound could
 *    permanently miss rows appended late with the same observedAt.
 * 3. Per product, re-aggregate EVERY daily/weekly bucket overlapped by
 *    the scan (full recompute from all of the bucket's observations,
 *    then idempotent upsert) — partial-period rows stay correct as new
 *    observations arrive.
 * 4. Only after ALL summary writes of the scan succeed, save the
 *    advanced watermark. Any failure propagates: the watermark is left
 *    untouched, BullMQ retries, and the re-scan converges. The
 *    watermark never regresses (explicit re-scan windows below it do
 *    not move it backwards).
 *
 * ## Payload semantics
 *
 * Scheduled runs pass { bucketStart, windowMinutes }. The window is
 * unioned into the scan by lowering its start to bucketStart when that
 * predates the watermark (explicit backfill / late-correction
 * re-aggregation); the window width never bounds the scan from above —
 * excluding observations newer than a window edge would permanently
 * skip their aggregation, while over-scanning is idempotent and safe.
 * With the payload absent the run is a pure watermark-driven
 * incremental scan.
 *
 * ## Bucket alignment
 *
 * Daily buckets are UTC calendar days; weekly buckets are ISO 8601
 * weeks anchored on Monday (design decision 3). Bucket reads are
 * half-open [bucketStart, bucketStart + window) matching the
 * observation repository's range convention, so a boundary-instant
 * observation is never counted in two buckets.
 */
@Processor(QUEUES.TIME_SERIES_AGGREGATION)
export class TimeSeriesAggregationWorker {
  private readonly logger = new Logger(TimeSeriesAggregationWorker.name);

  constructor(
    private readonly observations: PriceObservationRepository,
    private readonly summaries: PriceHistorySummaryRepository,
    private readonly watermarks: AggregationWatermarkRepository,
  ) {}

  @Process({ concurrency: 1 })
  async process(job: Job<TimeSeriesAggregationJobData>): Promise<void> {
    const watermark = await this.watermarks.find(WATERMARK_KEY);
    const scanFrom = this.resolveScanFrom(job.data, watermark);

    this.logger.log(
      `Scanning observations from ${scanFrom.toISOString()} (watermark: ${
        watermark?.toISOString() ?? 'none'
      }, attempt ${job.attemptsMade + 1})`,
    );

    const activity = await this.observations.findProductActivitySince(scanFrom);
    if (activity.length === 0) {
      this.logger.log('No observations in scan range — nothing to aggregate');
      return;
    }

    let bucketsWritten = 0;
    for (const product of activity) {
      bucketsWritten += await this.aggregateProduct(product);
    }

    // Reached only when every summary write above succeeded — this is
    // the sole watermark advance point. max(..., watermark) guards
    // against regression on explicit re-scan windows below the cursor.
    const scannedHighWater = activity.reduce(
      (max, product) => (product.lastObservedAt > max ? product.lastObservedAt : max),
      activity[0].lastObservedAt,
    );
    const next =
      watermark != null && watermark > scannedHighWater ? watermark : scannedHighWater;
    if (watermark === null || next > watermark) {
      await this.watermarks.save(WATERMARK_KEY, next);
    }

    this.logger.log(
      `Aggregated ${bucketsWritten} summary buckets across ${activity.length} products; ` +
        `watermark now ${next.toISOString()}`,
    );
  }

  /**
   * Scan origin: the persisted watermark, lowered to the payload's
   * bucketStart when that is a valid instant predating it. Invalid or
   * absent payloads fall back to the pure watermark-driven scan.
   */
  private resolveScanFrom(
    data: TimeSeriesAggregationJobData,
    watermark: Date | null,
  ): Date {
    const base = watermark ?? EPOCH;
    if (data.bucketStart == null) {
      return base;
    }
    const explicit = new Date(data.bucketStart);
    if (Number.isNaN(explicit.getTime())) {
      this.logger.warn(
        `Invalid bucketStart '${String(data.bucketStart)}' — falling back to watermark scan`,
      );
      return base;
    }
    return explicit < base ? explicit : base;
  }

  /**
   * Recompute-and-upsert every daily/weekly bucket overlapped by the
   * product's scan span. Each bucket is loaded in full (all merchants)
   * and rebuilt from scratch, keeping partial-period rows correct as
   * new observations arrive.
   */
  private async aggregateProduct(product: ProductActivitySince): Promise<number> {
    const { productId, firstObservedAt, lastObservedAt } = product;
    let written = 0;

    for (const granularity of GRANULARITIES) {
      const windowMs = BUCKET_WINDOW_MS[granularity];
      const anchorFor = (instant: Date): Date =>
        granularity === 'daily' ? startOfUtcDay(instant) : startOfIsoWeek(instant);

      // A bucket whose start is <= the last scanned observation may
      // contain it; step forward by whole bucket widths.
      for (
        let bucket = anchorFor(firstObservedAt);
        bucket <= lastObservedAt;
        bucket = new Date(bucket.getTime() + windowMs)
      ) {
        const bucketEnd = new Date(bucket.getTime() + windowMs);
        const bucketObservations = await this.observations.findByProductRange(
          productId,
          bucket,
          bucketEnd,
        );
        if (bucketObservations.length === 0) {
          continue;
        }
        for (const summary of buildBucketSummaries(granularity, bucket, bucketObservations)) {
          await this.summaries.upsertBucket(summary);
          written++;
          this.logger.debug(
            `Upserted ${bucketKey(
              summary.granularity,
              summary.periodStart,
              summary.productId,
              summary.merchant ?? null,
            )} (${summary.observationCount} observations)`,
          );
        }
      }
    }
    return written;
  }
}
