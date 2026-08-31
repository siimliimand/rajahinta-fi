/**
 * Time-series aggregation cron handler (task 4.3, design D6/D4-amended)
 * — the BullMQ `TimeSeriesAggregationWorker` port. Cadence: every 30
 * minutes (`@Cron(CronExpression.EVERY_30_MINUTES)` parity).
 *
 * ## Incremental scan protocol (write-then-advance) — unchanged
 *
 * 1. Read the persisted watermark (D1 `aggregation_watermarks`, keyed
 *    `time-series-aggregation`). Null on first run → scan from the epoch
 *    (initial backfill).
 * 2. Scan the R2 observation log: partitions are day objects
 *    (`observations/YYYY-MM-DD.jsonl`), read from the watermark's
 *    ISO-week MONDAY onward — a weekly bucket overlapped by the scan must
 *    recompute from its full contents (the pg worker re-read whole
 *    buckets via `findByProductRange`; the R2 equivalent is reading the
 *    week's partitions from their start). Foreign keys are dropped by
 *    the scan selector (`observationKeysToScan`).
 * 3. Products with ACTIVITY at-or-after the watermark (per-line
 *    inclusive filter — the boundary instant re-processes; re-scan
 *    converges) get EVERY overlapped daily/weekly bucket recomputed from
 *    ALL of their lines in the read partitions, then idempotently
 *    upserted. Partial-period rows stay correct as observations arrive.
 * 4. Only after ALL summary writes succeed, advance the watermark to the
 *    activity high water (never the extended pre-watermark week, never
 *    backwards). Any failure propagates: the watermark is left
 *    untouched and the next tick redoes the window.
 *
 * The scheduled run carries no payload window — a pure watermark-driven
 * incremental scan (the BullMQ payload's backfill trigger had no cron
 * caller; manual re-scans can lower the watermark directly).
 *
 * @module TimeSeriesAggregationCron
 */

import {
  BUCKET_WINDOW_MS,
  bucketAnchor,
  buildBucketSummaries,
  observationReliability,
  startOfIsoWeek,
  type SummaryGranularity,
} from '../../../../packages/data-platform/src/d1/summary-aggregation';
import {
  OBSERVATION_LOG_PREFIX,
  observationKeysToScan,
  parseObservationLog,
  type ObservationLogRecord,
} from '../../../../packages/data-platform/src/d1/observation-log';
import { D1AggregationWatermarkRepository } from '../../../../packages/data-platform/src/repositories/d1/aggregation-watermark.repository';
import { D1PriceHistorySummaryRepository } from '../../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';
import { observationLogStore } from '../adapters/r2-observation-log.store';
import { recordStalePriceShare } from '../observability/metrics';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler registers under (wrangler triggers.crons). */
export const AGGREGATION_CRON = '*/30 * * * *';

/**
 * Persisted-watermark key — one watermark row per aggregating job.
 * Byte-parity with QUEUES.TIME_SERIES_AGGREGATION ('time-series-aggregation')
 * in packages/data-acquisition/src/index.ts, inlined here because the
 * package barrel pulls @nestjs/bull and must stay out of a Worker bundle;
 * src/cron/__tests__/time-series-aggregation.test.ts pins the parity.
 */
export const WATERMARK_KEY = 'time-series-aggregation';

/** Summary granularities materialized by this handler. */
const GRANULARITIES: readonly SummaryGranularity[] = ['daily', 'weekly'];

/** One aggregation run's outcome — logged by the cron dispatch. */
export interface AggregationResult {
  /** Products with observations in the scan range. */
  readonly products: number;
  /** Summary buckets upserted (per-merchant + product-wide rows). */
  readonly bucketsWritten: number;
  /** New watermark (null when the scan found nothing). */
  readonly watermark: string | null;
}

/**
 * One 30-minute aggregation cycle over the Worker bindings.
 *
 * `deps` is a test seam (store/repositories overrides).
 */
export async function handleTimeSeriesAggregation(
  env: Env,
  log: Logger,
  deps: {
    store?: ReturnType<typeof observationLogStore>;
    summaries?: D1PriceHistorySummaryRepository;
    watermarks?: D1AggregationWatermarkRepository;
  } = {},
): Promise<AggregationResult> {
  const store = deps.store ?? observationLogStore(env);
  const summaries =
    deps.summaries ?? new D1PriceHistorySummaryRepository(env.DB);
  const watermarks =
    deps.watermarks ?? new D1AggregationWatermarkRepository(env.DB);

  // -- 1. Watermark -------------------------------------------------------
  const watermark = await watermarks.find(WATERMARK_KEY);

  // -- 2. R2 partition scan ------------------------------------------------
  // Partitions are read from the watermark's ISO-week Monday onward:
  // every daily/weekly bucket overlapped by the scan must recompute from
  // its FULL contents (the pg worker re-read whole buckets via
  // findByProductRange; the R2 equivalent is reading the week's
  // partitions from their start). The watermark's per-line filter applies
  // only to product ACTIVITY and the watermark advance — not to bucket
  // inputs. Without a watermark the scan covers the whole log (backfill).
  const keys = await store.listKeys(OBSERVATION_LOG_PREFIX);
  const readFrom = watermark === null ? null : startOfIsoWeek(watermark);
  const scanKeys = observationKeysToScan(keys, readFrom);
  const allRecords = await readPartitions(store, scanKeys);

  // Task 6.1 (design D8): stale-price-share freshness gauge over the
  // audited scan set — the Prometheus namesake the ingestion quality hook
  // set (same metric contract: nothing audited → 0). No-op without
  // METRICS; emission must not gate the aggregation itself.
  emitStalePriceShare(env, allRecords);

  const activeRecords =
    watermark === null
      ? allRecords
      : allRecords.filter(
          (record) => new Date(record.observed_at) >= watermark,
        );

  if (activeRecords.length === 0) {
    log.info({
      message: 'No observations in scan range — nothing to aggregate',
      watermark: watermark?.toISOString() ?? 'none',
    });
    return { products: 0, bucketsWritten: 0, watermark: null };
  }

  log.info({
    message: `Scanning observations from ${minObservedAt(activeRecords)} (watermark: ${
      watermark?.toISOString() ?? 'none'
    })`,
    partitions: scanKeys.length,
    observations: allRecords.length,
  });

  // -- 3. Per-product bucket recompute + upsert ----------------------------
  const activeByProduct = groupByProduct(activeRecords);
  const allByProduct = groupByProduct(allRecords);
  let bucketsWritten = 0;
  for (const [, records] of activeByProduct) {
    const productId = records[0].product_id;
    bucketsWritten += await aggregateProduct(
      summaries,
      allByProduct.get(productId) ?? [],
    );
  }

  // -- 4. Watermark advance — sole write-then-advance point ---------------
  // The high water comes from the ACTIVITY range only — the extended
  // pre-watermark week must never hold the cursor back.
  const scannedHighWater = activeRecords.reduce(
    (max, record) =>
      record.observed_at > max.observed_at ? record : max,
    activeRecords[0],
  );
  const nextInstant = new Date(scannedHighWater.observed_at);
  const next =
    watermark !== null && watermark > nextInstant ? watermark : nextInstant;
  if (watermark === null || next > watermark) {
    await watermarks.save(WATERMARK_KEY, next);
  }

  log.info({
    message: `Aggregated ${bucketsWritten} summary buckets across ${activeByProduct.size} products; watermark now ${next.toISOString()}`,
    bucketsWritten,
    products: activeByProduct.size,
  });

  return {
    products: activeByProduct.size,
    bucketsWritten,
    watermark: next.toISOString(),
  };
}

/**
 * Stale-price-share computation over an audited scan set: the share of
 * read observation records whose overall reliability is STALE (the
 * strictest of the per-input snapshot statuses). Nothing read → 0,
 * keeping the Prometheus gauge's "renders 0 when nothing audited"
 * contract.
 *
 * Exported as the single computation shared by the gauge emission below
 * and the task-6.3 freshness-alert checker — the alert must measure the
 * SAME value the dashboard shows, never a re-derivation that can drift.
 */
export function stalePriceShareOf(
  records: readonly ObservationLogRecord[],
): { stale: number; total: number; share: number } {
  const stale = records.filter(
    (record) => observationReliability(record) === 'STALE',
  ).length;
  const total = records.length;
  return { stale, total, share: total > 0 ? stale / total : 0 };
}

/**
 * Stale-price-share gauge emission over the audited scan set — the
 * Prometheus namesake the ingestion quality hook set (same metric
 * contract: nothing audited → 0). No-op without METRICS; emission must
 * not gate the aggregation itself.
 */
function emitStalePriceShare(
  env: Env,
  records: readonly ObservationLogRecord[],
): void {
  const { stale, total } = stalePriceShareOf(records);
  recordStalePriceShare(env, stale, total);
}

/**
 * Read the scan partitions whole — bucket recomputes need every line of
 * their partitions, not only post-watermark lines (the caller applies
 * the watermark filter to activity and the advance, never to inputs).
 * Exported for the task-6.3 freshness-alert checker, which reads the
 * same audited scan set the gauge is computed over.
 */
export async function readPartitions(
  store: ReturnType<typeof observationLogStore>,
  scanKeys: readonly string[],
): Promise<ObservationLogRecord[]> {
  const records: ObservationLogRecord[] = [];
  for (const key of scanKeys) {
    const body = await store.readObject(key);
    if (body === null) continue;
    records.push(...parseObservationLog(body));
  }
  return records;
}

/** Group scan-range observations by product, preserving arrival order. */
function groupByProduct(
  records: readonly ObservationLogRecord[],
): Map<number, ObservationLogRecord[]> {
  const byProduct = new Map<number, ObservationLogRecord[]>();
  for (const record of records) {
    const group = byProduct.get(record.product_id);
    if (group) {
      group.push(record);
    } else {
      byProduct.set(record.product_id, [record]);
    }
  }
  return byProduct;
}

/**
 * Recompute-and-upsert every daily/weekly bucket overlapped by the
 * product's span within the read partitions. Each bucket is rebuilt from
 * ALL of the product's observations inside it (per-merchant + product-wide
 * rows), keeping partial-period rows correct as new observations arrive.
 * Buckets are half-open [start, start + window) so a boundary instant
 * never counts twice.
 */
async function aggregateProduct(
  summaries: D1PriceHistorySummaryRepository,
  productRecords: readonly ObservationLogRecord[],
): Promise<number> {
  let written = 0;
  const sorted = [...productRecords].sort((a, b) =>
    a.observed_at !== b.observed_at
      ? a.observed_at < b.observed_at
        ? -1
        : 1
      : a.id - b.id,
  );
  const firstObservedAt = new Date(sorted[0].observed_at);
  const lastObservedAt = new Date(sorted[sorted.length - 1].observed_at);

  for (const granularity of GRANULARITIES) {
    const windowMs = BUCKET_WINDOW_MS[granularity];
    // A bucket whose start is <= the last scanned observation may
    // contain it; step forward by whole bucket widths.
    for (
      let bucket = bucketAnchor(granularity, firstObservedAt);
      bucket <= lastObservedAt;
      bucket = new Date(bucket.getTime() + windowMs)
    ) {
      const bucketEnd = new Date(bucket.getTime() + windowMs);
      const bucketObservations = sorted.filter((record) => {
        const instant = new Date(record.observed_at);
        return instant >= bucket && instant < bucketEnd;
      });
      if (bucketObservations.length === 0) {
        continue;
      }
      for (const summary of buildBucketSummaries(
        granularity,
        bucket,
        bucketObservations,
      )) {
        await summaries.upsertBucket(summary);
        written++;
      }
    }
  }
  return written;
}

function minObservedAt(records: readonly ObservationLogRecord[]): string {
  return records.reduce(
    (min, record) => (record.observed_at < min ? record.observed_at : min),
    records[0].observed_at,
  );
}
