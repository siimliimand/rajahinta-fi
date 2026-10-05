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
 * 4. Process the active products as a bounded CHUNK of the pass, not the
 *    whole walk (aggregation-cursor-chunking, design D2/D3): the active
 *    products are enumerated id-ASCENDING and the invocation takes the
 *    {@link AGGREGATION_CHUNK_PRODUCTS} slice just above the persisted
 *    backfill cursor ({@link BACKFILL_CURSOR_KEY} row in
 *    `aggregation_watermarks`, repository-parity raw SQL — the
 *    savings-snapshot-cursor precedent). Per-chunk write-then-advance:
 *    the cursor moves to the slice's last completed product id only
 *    AFTER the slice's bucket upserts succeed. A kill between a chunk's
 *    writes and its cursor persist re-does that chunk's idempotent
 *    upserts next tick — ground is never lost, nothing is ever
 *    incorrect.
 * 5. The FINAL chunk (nothing left above the slice) completes the pass:
 *    the watermark advances to the activity high water (never the
 *    extended pre-watermark week, never backwards) and the cursor row is
 *    deleted. A settled watermark's small active set fits one chunk, so
 *    the pre-chunking single pass is the degenerate one-chunk shape
 *    (design D3) — no mode flag, no divergent path.
 *
 * Budget intent: one invocation writes at most one chunk (300 products;
 * measured ≈28.8k D1 statements ≈ 5-6 min of the 15-minute WALL budget —
 * the binding constraint: production observed ~880 products ≈ 84k
 * statements per 15-min tick before the wall kill, 1.0 s/product, no
 * subrequest cap). The task-1.2 budget pin (≤35,000 statements per
 * invocation) guards that envelope against statement-count regressions;
 * the design Risks arithmetic that guessed a ≤1,000-statement budget
 * was superseded by the production wall-time evidence (the pin decided,
 * then the evidence re-decided the constant).
 *
 * The scheduled run carries no payload window — a pure watermark-driven
 * incremental scan (the BullMQ payload's backfill trigger had no cron
 * caller; manual re-scans can lower the watermark directly, and the
 * lowered window chunk-walks through the same cursor protocol).
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
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import { observationLogStore } from '../adapters/r2-observation-log.store';
import {
  recordHistorySummaryCoverage,
  recordStalePriceShare,
} from '../observability/metrics';
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

/**
 * Backfill-cursor row key — the in-flight pass's last completed product
 * id (aggregation-cursor-chunking D1/D2). A second keyed row in the same
 * `aggregation_watermarks` table as {@link WATERMARK_KEY}, written and
 * cleared by the raw statements below (repository-parity SQL, the
 * savings-snapshot-cursor precedent — no schema change, no dedicated
 * table for a transient cursor).
 */
export const BACKFILL_CURSOR_KEY = 'time-series-backfill-cursor';

/**
 * Products processed per invocation (design D2): the chunk cap that
 * bounds one tick's share of the 15-minute scheduled-event WALL budget —
 * the binding constraint in production (2026-10-05 11:30 UTC tick:
 * ~880 products aggregated ≈ 84,000 D1 statements before the
 * `exceededWallTime` kill at 1.0 s/product; no subrequest cap was hit).
 * MEASURED statement cost: the summary repository's `upsertBucket` is a
 * lookup + write statement PAIR per bucket row (not a batch), so a
 * production-shaped product (~3 weeks of daily observations, one
 * merchant → 48 bucket rows) costs 96 statements → 300 products ≈ 28.8k
 * statements ≈ 5-6 min of the 15-min wall shared with the tick's
 * sibling handlers. The task-1.2 budget pin (≤35,000 statements/
 * invocation ≈ the chunk's measured cost + headroom) guards the
 * envelope: a per-product statement-count increase is exactly the kind
 * of regression that would push a tick past the wall. Recorded
 * optimization candidate: one batched upsert per product in the summary
 * repository would cut the statement cost ~96×.
 */
export const AGGREGATION_CHUNK_PRODUCTS = 300;

/** Summary granularities materialized by this handler. */
const GRANULARITIES: readonly SummaryGranularity[] = ['daily', 'weekly'];

/** One aggregation run's outcome — logged by the cron dispatch. */
export interface AggregationResult {
  /** Products processed THIS TICK — the pass's chunk slice. */
  readonly products: number;
  /** Summary buckets upserted (per-merchant + product-wide rows). */
  readonly bucketsWritten: number;
  /**
   * The tick's resulting watermark state: the advanced instant on a
   * pass-completing (final-chunk) tick, the unchanged persisted instant
   * on a settled one-chunk tick, and null when the scan found nothing or
   * a mid-backfill chunk has not yet wrapped (the watermark is written
   * only by a pass's final chunk).
   */
  readonly watermark: string | null;
}

/**
 * The pass cursor (aggregation-cursor-chunking D1/D2): the last completed
 * product id of the in-flight pass, read/written as raw prepared
 * statements against the generic `aggregation_watermarks` table — the
 * same repository-parity statement shapes the savings-snapshot cursor
 * uses (the Date-typed AggregationWatermarkRepository abstract is not
 * bent for an integer cursor). Absent row → 0: no pass in flight, the
 * slice starts at the lowest active id.
 */
async function readBackfillCursor(d1: D1DatabaseLike): Promise<number> {
  const row = await d1
    .prepare('SELECT watermark FROM aggregation_watermarks WHERE job_name = ?')
    .bind(BACKFILL_CURSOR_KEY)
    .first<{ watermark: string }>();
  if (row === null) {
    return 0;
  }
  const parsed = Number(row.watermark);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Per-chunk write-then-advance persist step (design D2): called only
 * after the chunk's bucket upserts succeeded, so the cursor never
 * promises work the tick did not do. Upsert keyed on the job_name
 * UNIQUE index — insert-or-update, never a second row.
 */
async function writeBackfillCursor(
  d1: D1DatabaseLike,
  productId: number,
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO aggregation_watermarks (job_name, watermark, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (job_name) DO UPDATE SET
         watermark = excluded.watermark,
         updated_at = excluded.updated_at`,
    )
    .bind(BACKFILL_CURSOR_KEY, String(productId), new Date().toISOString())
    .run();
}

/**
 * Pass-completion cleanup (design D2): the final chunk deletes the
 * cursor row — the watermark alone drives every later tick.
 */
async function deleteBackfillCursor(d1: D1DatabaseLike): Promise<void> {
  await d1
    .prepare('DELETE FROM aggregation_watermarks WHERE job_name = ?')
    .bind(BACKFILL_CURSOR_KEY)
    .run();
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

  // -- 1. Watermark + backfill cursor -------------------------------------
  const watermark = await watermarks.find(WATERMARK_KEY);
  const cursor = await readBackfillCursor(env.DB);

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
    // Design D4: a quiet tick still reports its window's coverage —
    // likely the 0/0 +Inf sentinel (see summaryCoverageRatioOf), so the
    // panel reflects THIS tick instead of the last active one.
    await emitSummaryCoverage(env, readFrom, log);
    return { products: 0, bucketsWritten: 0, watermark: null };
  }

  log.info({
    message: `Scanning observations from ${minObservedAt(activeRecords)} (watermark: ${
      watermark?.toISOString() ?? 'none'
    })`,
    partitions: scanKeys.length,
    observations: allRecords.length,
  });

  // -- 3. Chunked per-product bucket recompute + upsert --------------------
  // One invocation = the id-ascending active slice just above the
  // backfill cursor, capped at AGGREGATION_CHUNK_PRODUCTS (design D2).
  // The cursor skip is what makes a killed invocation resume after its
  // last completed product instead of restarting the walk.
  const activeByProduct = groupByProduct(activeRecords);
  const allByProduct = groupByProduct(allRecords);
  const activeProductIds = [...activeByProduct.keys()].sort((a, b) => a - b);
  let sliceStart = 0;
  while (
    sliceStart < activeProductIds.length &&
    activeProductIds[sliceStart] <= cursor
  ) {
    sliceStart++;
  }
  const slice = activeProductIds.slice(
    sliceStart,
    sliceStart + AGGREGATION_CHUNK_PRODUCTS,
  );
  // Nothing left above the slice — the tail chunk completes the pass
  // (an exactly-at-cap tail included; the savings precedent's rule).
  const isFinalChunk =
    sliceStart + slice.length >= activeProductIds.length;

  let bucketsWritten = 0;
  for (const productId of slice) {
    bucketsWritten += await aggregateProduct(
      summaries,
      allByProduct.get(productId) ?? [],
    );
  }

  // -- 4. Write-then-advance — cursor per chunk, watermark on wrap --------
  let resultingWatermark: string | null;
  if (isFinalChunk) {
    // The high water comes from the ACTIVITY range only — the extended
    // pre-watermark week must never hold the cursor back. Never
    // backwards; the watermark is the pass's commit point.
    const scannedHighWater = activeRecords.reduce(
      (max, record) =>
        record.observed_at > max.observed_at ? record : max,
      activeRecords[0],
    );
    const nextInstant = new Date(scannedHighWater.observed_at);
    const next =
      watermark !== null && watermark > nextInstant ? watermark : nextInstant;
    // The cursor delete LEADS the watermark save: a kill between the two
    // leaves "old watermark, no cursor" — the next tick re-walks the tail
    // idempotently — never "advanced watermark + stale cursor", which
    // would skip active products below the stale position.
    await deleteBackfillCursor(env.DB);
    if (watermark === null || next > watermark) {
      await watermarks.save(WATERMARK_KEY, next);
    }
    resultingWatermark = next.toISOString();
  } else {
    // Mid-pass: the watermark stays untouched — the pass is not done —
    // and the cursor advances only now that the slice's writes succeeded.
    await writeBackfillCursor(env.DB, slice[slice.length - 1]);
    resultingWatermark = watermark?.toISOString() ?? null;
  }

  log.info({
    message: `Aggregated ${bucketsWritten} summary buckets across ${slice.length} products (chunk of ${activeProductIds.length} active, cursor was ${cursor})${
      isFinalChunk
        ? `; pass complete, watermark now ${resultingWatermark}`
        : '; backfill continues next tick'
    }`,
    bucketsWritten,
    products: slice.length,
    activeProducts: activeProductIds.length,
    cursor,
    finalChunk: isFinalChunk,
  });

  // Design D4 (watermark-isolation-history-backfill): the pass reports
  // its window's summary-coverage ratio, measured AFTER its writes — a
  // gap this pass just fixed never shows as a one-tick dip, while real
  // drift persists tick over tick for the coverage alert to catch.
  // Best-effort: emission must not gate the returned result below.
  await emitSummaryCoverage(env, readFrom, log);

  return {
    products: slice.length,
    bucketsWritten,
    watermark: resultingWatermark,
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

// ---------------------------------------------------------------------------
// Summary-coverage gauge (design D4, change
// watermark-isolation-history-backfill)
// ---------------------------------------------------------------------------

/**
 * The coverage pair over the pass's read window — the SAME D1 pair the
 * history-backfill script's coverage query measures
 * (scripts/backfill-history-summaries.ts, design D4: "coverage measured
 * where the gap is produced"). "Products with observations" are
 * `retail_offers` rows (every R2 observation-log line mirrors one of
 * these appends via `retail_offer_id`); "summarized" is a `daily` bucket
 * at/after the window's floor day — an in-window observation's daily
 * anchor is its own UTC day, so `period_start >= <window-start day>`
 * covers every daily bucket the job would have written for in-window
 * observations, and weekly rows are redundant for existence.
 */
const SUMMARY_COVERAGE_BOUNDED_SQL = `
  SELECT
    (SELECT COUNT(DISTINCT product_id) FROM retail_offers
      WHERE observed_at >= ?) AS products_with_observations,
    (SELECT COUNT(DISTINCT product_id) FROM price_history_summaries
      WHERE granularity = 'daily' AND period_start >= ?) AS summarized_products`;

/** The unbounded pair — first run (no watermark): the scan covers the whole log. */
const SUMMARY_COVERAGE_UNBOUNDED_SQL = `
  SELECT
    (SELECT COUNT(DISTINCT product_id) FROM retail_offers)
      AS products_with_observations,
    (SELECT COUNT(DISTINCT product_id) FROM price_history_summaries
      WHERE granularity = 'daily') AS summarized_products`;

/** One window's coverage counts, in ratio order (numerator / denominator). */
export interface SummaryCoverageCounts {
  /** Products with a `daily` summary bucket at/after the window floor. */
  readonly summarizedProducts: number;
  /** Products with an in-window `retail_offers` observation. */
  readonly productsWithObservations: number;
}

/**
 * Measure the coverage pair over the window the pass reads: bounded by
 * the scan's ISO-week Monday, unbounded on the first run (no watermark —
 * the scan covers the whole log, so the processed window is everything).
 * Exported so the parity claim with the backfill script's coverage query
 * stays pinnable in one place.
 */
export async function measureSummaryCoverage(
  db: D1DatabaseLike,
  readFrom: Date | null,
): Promise<SummaryCoverageCounts> {
  const row =
    readFrom === null
      ? await db
          .prepare(SUMMARY_COVERAGE_UNBOUNDED_SQL)
          .first<{
            products_with_observations: number;
            summarized_products: number;
          }>()
      : await db
          .prepare(SUMMARY_COVERAGE_BOUNDED_SQL)
          .bind(
            readFrom.toISOString(),
            readFrom.toISOString().slice(0, 10),
          )
          .first<{
            products_with_observations: number;
            summarized_products: number;
          }>();
  return {
    summarizedProducts: row?.summarized_products ?? 0,
    productsWithObservations: row?.products_with_observations ?? 0,
  };
}

/**
 * Coverage-gauge emission for one pass — the window's counts through
 * {@link recordHistorySummaryCoverage}. Best-effort at BOTH steps: a
 * failed coverage read or a failed AE write is logged and dropped —
 * telemetry must never take the aggregation tick down (the metrics
 * module doctrine; the writeDataPoint call inside recordGauge is
 * already guarded, this guards the D1 measurement too).
 */
async function emitSummaryCoverage(
  env: Env,
  readFrom: Date | null,
  log: Logger,
): Promise<void> {
  try {
    const counts = await measureSummaryCoverage(env.DB, readFrom);
    recordHistorySummaryCoverage(
      env,
      counts.summarizedProducts,
      counts.productsWithObservations,
    );
  } catch (err) {
    log.error({
      message: `Summary-coverage gauge emission failed: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    });
  }
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
