/**
 * Data-quality metrics (task 4.1, change data-quality-and-publication-trust)
 * — the AE write path for the data-quality panel's five surfaces and its
 * threshold alerts:
 *
 * - zero-price rejections per ingestion run (the mapper's price-floor
 *   gate, task 1.1 — counted from the run report's error channel);
 * - implausible-volume share (the ceiling gate's withheld-row share,
 *   task 1.2 — rendered from the existing DataQualityReport the
 *   quality hook contract already carries);
 * - Alko reference coverage (share of catalog products with a usable
 *   reference offer — the savings-snapshot qualification predicate);
 * - transport offer rows per carrier (append-only table row counts,
 *   expected curated carriers included at 0);
 * - per-feed last-success age (newest offer observation per registry
 *   feed — the hourly producer's per-merchant success signal).
 *
 * Write shapes follow the freshness gauges exactly (metrics.ts): one
 * discrete `recordGauge` point per observation, index1 = gauge name,
 * blob3 = labels JSON. Per-run counts (zero-price rejections) sum
 * weighted by `_sample_interval` over a window (the price-alert counter
 * semantics); ratios/ages are latest-observation gauges like
 * `recordStalePriceShare` / `recordTransportAge`.
 *
 * Measurement (D1) and emission are separated: the pure computations
 * (`implausibleVolumeShareOf`, `alkoReferenceCoverageOf`,
 * `zeroPriceRejectionsOf`) are exported so a dashboard value and any
 * future alert checker can never drift; {@link measureAndRecordDataQualityGauges}
 * is the cron-callable one-tick writer for the cadence gauges. The
 * per-run writers (`recordZeroPriceRejections`,
 * `recordImplausibleVolumeShare`) are invoked at the run seam.
 *
 * Emission is no-op without METRICS and best-effort everywhere —
 * metrics never take a run or a cron tick down.
 *
 * @module DataQualityMetrics
 */

import { FransbergCarrierRateSource } from '../../../../packages/data-acquisition/src/adapters/fransberg-rate.source';
import { PostiCarrierRateSource } from '../../../../packages/data-acquisition/src/adapters/posti-rate.source';
import { OmnivaCarrierRateSource } from '../../../../packages/data-acquisition/src/adapters/omniva-rate.source';
import type {
  DataQualityReport,
  QualityReportHook,
} from '../../../../packages/data-acquisition/src/services/data-quality.service';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import {
  TRANSPORT_AGE_INFINITE,
  transportAgeSeconds,
  metricsEmitter,
} from './metrics';
import type { Env } from '../env';
import type { Logger } from '../logger';

// ---------------------------------------------------------------------------
// Metric names — the Prometheus-contract surface the dashboard + alerts
// (infra/grafana) and METRICS.md reference. Stable export order.
// ---------------------------------------------------------------------------

/**
 * Implausible-volume share gauge — byte-parity with the wave-1 contract
 * name `IMPLAUSIBLE_VOLUME_SHARE_METRIC` in
 * packages/data-acquisition/src/services/data-quality.service.ts (the
 * parity is pinned by data-quality-metrics.test.ts; the constant is not
 * imported at runtime because that module carries the NestJS decorator
 * runtime and this one is imported on hot paths).
 */
export const IMPLAUSIBLE_VOLUME_SHARE_GAUGE =
  'rajahinta_data_quality_implausible_volume_share_ratio';

/** Zero-price rejections per ingestion run — per-run count, price-alert-counter semantics. */
export const ZERO_PRICE_REJECTIONS_COUNTER =
  'rajahinta_data_quality_zero_price_rejections_total';

/** Alko reference coverage — share of catalog products with a usable reference offer. */
export const ALKO_REFERENCE_COVERAGE_GAUGE =
  'rajahinta_data_quality_alko_reference_coverage_ratio';

/** Transport offer rows per carrier — one point per carrier, `carrier` label. */
export const TRANSPORT_OFFER_ROWS_GAUGE = 'rajahinta_transport_offer_rows';

/** Per-feed last-success age — one point per registry feed, `merchant` label. */
export const FEED_LAST_SUCCESS_AGE_GAUGE =
  'rajahinta_feed_last_success_age_seconds';

/**
 * The error-channel marker the mapper's price-floor gate stamps on
 * every zero-price rejection (data-mapping.service.ts, design D1: "price
 * drift — minor-unit price …"). The rejection count is read from the
 * run report's existing errors channel — the same surface the parser's
 * per-row correction failures use — so the marker must stay a stable,
 * greppable fragment of that message.
 */
export const PRICE_DRIFT_ERROR_MARKER = 'price drift';

/** The merchant every reference-coverage query filters on — byte-parity with the savings-snapshot cron's private ALKO_MERCHANT. */
const ALKO_MERCHANT = 'alko';

// ---------------------------------------------------------------------------
// Pure computations — the dashboard value and any alert evaluation share
// these, so the panel and a future checker can never diverge.
// ---------------------------------------------------------------------------

/**
 * Implausible-volume share — withheld offers over audited offers. 0
 * audited offers → 0: the stale-price-share gauge's "renders 0 when
 * nothing audited" canary contract (an absent run must not read as a
 * regression).
 */
export function implausibleVolumeShareOf(
  implausibleCount: number,
  totalOffers: number,
): number {
  return totalOffers > 0 ? implausibleCount / totalOffers : 0;
}

/** Catalog products with a usable reference offer over all catalog products. */
export interface AlkoReferenceCoverageCounts {
  /** Products carrying at least one Alko offer row (the qualification enumeration). */
  readonly coveredProducts: number;
  /** All product_master rows — the savings surface's catalog. */
  readonly totalProducts: number;
}

/**
 * Alko reference coverage — usable-reference share of the catalog. 0
 * products → 0: an empty catalog IS a dead savings surface, and the
 * coverage alert is exactly the thing that must say so.
 */
export function alkoReferenceCoverageOf(
  counts: AlkoReferenceCoverageCounts,
): number {
  return counts.totalProducts > 0
    ? counts.coveredProducts / counts.totalProducts
    : 0;
}

/**
 * Zero-price rejections in one run's error collection — the messages
 * the mapper's price-floor gate wrote ({@link PRICE_DRIFT_ERROR_MARKER}).
 * Pure so the run-seam count and any future check pin the same filter.
 */
export function zeroPriceRejectionsOf(errors: readonly string[]): number {
  return errors.filter((error) => error.includes(PRICE_DRIFT_ERROR_MARKER))
    .length;
}

// ---------------------------------------------------------------------------
// Per-run writers — invoked at the ingestion run seam (workflow / direct
// runner), one discrete point per run like the price-alert counters.
// ---------------------------------------------------------------------------

/**
 * Zero-price rejections of one ingestion run — one point per run;
 * `double1` is the per-run count (sum weighted by `_sample_interval`
 * over a window = the running total). The merchant is stamped as a
 * label when known (registry ids are low-cardinality) so the panel and
 * the alert can attribute a rejection burst to its feed.
 */
export function recordZeroPriceRejections(
  env: Env,
  count: number,
  merchant?: string,
): void {
  metricsEmitter(env).recordGauge({
    name: ZERO_PRICE_REJECTIONS_COUNTER,
    value: count,
    labels: merchant === undefined ? undefined : { merchant },
  });
}

/**
 * Implausible-volume share of one ingestion run's quality report — the
 * task-1.2 gate made visible. Same "renders 0 when nothing audited"
 * contract as {@link implausibleVolumeShareOf}.
 */
export function recordImplausibleVolumeShare(
  env: Env,
  implausibleCount: number,
  totalOffers: number,
): void {
  metricsEmitter(env).recordGauge({
    name: IMPLAUSIBLE_VOLUME_SHARE_GAUGE,
    value: implausibleVolumeShareOf(implausibleCount, totalOffers),
  });
}

/**
 * The quality-report hook receiver — turns the existing
 * `QualityReportHook` contract (data-quality.service.ts) into the real
 * AE write: registered once at composition time
 * (`DataQualityService.setQualityReportHook(dataQualityReportGaugeHook(env))`),
 * every `runQualityCheck` report renders its implausible-volume share
 * into the AE gauge. The task-1.2 count flows through the report's
 * second-parameter channel; this is its export.
 */
export function dataQualityReportGaugeHook(env: Env): QualityReportHook {
  return (report: DataQualityReport): void => {
    recordImplausibleVolumeShare(
      env,
      report.implausibleVolumeCount,
      report.totalOffers,
    );
  };
}

// ---------------------------------------------------------------------------
// Cadence gauges — D1-measured, written on the shared 30-min tick via
// {@link measureAndRecordDataQualityGauges} (or per-writer at another seam).
// ---------------------------------------------------------------------------

/**
 * Alko reference coverage gauge write. Coverage = products with a usable
 * Alko reference (offer row, observation instant present — the exact
 * savings-snapshot qualification predicate) over all catalog products.
 */
export function recordAlkoReferenceCoverage(
  env: Env,
  coveredProducts: number,
  totalProducts: number,
): void {
  metricsEmitter(env).recordGauge({
    name: ALKO_REFERENCE_COVERAGE_GAUGE,
    value: alkoReferenceCoverageOf({ coveredProducts, totalProducts }),
  });
}

/**
 * Transport offer rows per carrier — one point per carrier with the
 * `carrier` label. Expected carriers with no table rows are written as
 * honest 0s (the spec scenario: the panel SHOWS zero) — never absent.
 */
export function recordTransportRowsPerCarrier(
  env: Env,
  rowsByCarrier: Readonly<Record<string, number>>,
): void {
  const emitter = metricsEmitter(env);
  for (const carrier of Object.keys(rowsByCarrier).sort()) {
    emitter.recordGauge({
      name: TRANSPORT_OFFER_ROWS_GAUGE,
      value: rowsByCarrier[carrier],
      labels: { carrier },
    });
  }
}

/**
 * One feed's last-success age — reuses the transport age computation
 * (the single shared age function, metrics.ts) so the sentinel contract
 * is identical: never-successful feed (no offer rows at all) → +Inf
 * sentinel double, faithful "+Inf" blob2 text, and every `> threshold`
 * alert fires on it unchanged.
 */
export function recordFeedLastSuccessAge(
  env: Env,
  merchantId: string,
  newestOfferObservedAt: Date | null,
): void {
  const ageSeconds =
    newestOfferObservedAt === null
      ? null
      : transportAgeSeconds(newestOfferObservedAt);
  metricsEmitter(env).recordGauge({
    name: FEED_LAST_SUCCESS_AGE_GAUGE,
    value: ageSeconds ?? TRANSPORT_AGE_INFINITE,
    valueLabel: ageSeconds === null ? '+Inf' : String(ageSeconds),
    labels: { merchant: merchantId },
  });
}

// ---------------------------------------------------------------------------
// D1 measurements — the reads behind the cadence gauges.
// ---------------------------------------------------------------------------

/** The curated in-repo carriers — the datasets the refresh crons append (composeCuratedCarriers/composeCarrierRateSources parity). */
function expectedTransportCarriers(): string[] {
  return [
    new FransbergCarrierRateSource().carrierId,
    new PostiCarrierRateSource().carrierId,
    new OmnivaCarrierRateSource().carrierId,
  ];
}

const ALKO_COVERAGE_SQL = `SELECT
  (SELECT COUNT(*) FROM product_master) AS total_products,
  (SELECT COUNT(DISTINCT product_id) FROM retail_offers WHERE merchant = ? AND observed_at IS NOT NULL) AS covered_products`;

/**
 * Measure Alko reference coverage from the same data the savings
 * snapshot qualifies on: an Alko offer row WITH an observation instant.
 * (`observed_at IS NOT NULL` mirrors the cron's `observedAt !== undefined`
 * predicate; the column is NOT NULL today, so the guard is prospective.)
 */
export async function measureAlkoReferenceCoverage(
  db: D1DatabaseLike,
): Promise<AlkoReferenceCoverageCounts> {
  const row = await db
    .prepare(ALKO_COVERAGE_SQL)
    .bind(ALKO_MERCHANT)
    .first<{ total_products: number; covered_products: number }>();
  return {
    totalProducts: row?.total_products ?? 0,
    coveredProducts: row?.covered_products ?? 0,
  };
}

const TRANSPORT_ROWS_SQL =
  'SELECT carrier, COUNT(*) AS row_count FROM transport_offers GROUP BY carrier ORDER BY carrier ASC';

/**
 * Measure transport offer rows per carrier — expected curated carriers
 * seeded at 0 (an empty table still yields a per-carrier point, so the
 * panel shows zero and the rows alert covers it), overlaid with the
 * append-only table's actual counts.
 */
export async function measureTransportRowsPerCarrier(
  db: D1DatabaseLike,
): Promise<Record<string, number>> {
  const rowsByCarrier: Record<string, number> = {};
  for (const carrier of expectedTransportCarriers()) {
    rowsByCarrier[carrier] = 0;
  }
  const result = await db
    .prepare(TRANSPORT_ROWS_SQL)
    .all<{ carrier: string; row_count: number }>();
  for (const row of result.results) {
    rowsByCarrier[row.carrier] = row.row_count;
  }
  return rowsByCarrier;
}

const FEED_LAST_SUCCESS_SQL = `SELECT m.merchant_id AS merchant_id, MAX(o.observed_at) AS newest_observed_at
FROM merchant_registry AS m
LEFT JOIN retail_offers AS o ON o.merchant = m.merchant_id
WHERE m.feed_url <> ''
GROUP BY m.merchant_id
ORDER BY m.merchant_id ASC`;

/**
 * Measure per-feed last success — the newest offer observation per
 * registry feed. Every successful ingestion stamps fresh `observedAt`
 * instants (mapper: `new Date()`), so the newest offer row per merchant
 * IS the last-success signal; a feed that has never published an offer
 * reports null (the +Inf sentinel at write time). Registry rows with an
 * empty feed URL are excluded — the producer skips those (adapter not
 * live), so they are not feeds whose success can go stale.
 */
export async function measureFeedLastSuccesses(
  db: D1DatabaseLike,
): Promise<Record<string, Date | null>> {
  const result = await db
    .prepare(FEED_LAST_SUCCESS_SQL)
    .all<{ merchant_id: string; newest_observed_at: string | null }>();
  const newestByMerchant: Record<string, Date | null> = {};
  for (const row of result.results) {
    newestByMerchant[row.merchant_id] = row.newest_observed_at
      ? new Date(row.newest_observed_at)
      : null;
  }
  return newestByMerchant;
}

// ---------------------------------------------------------------------------
// One-tick writer — the cron seam for the cadence gauges.
// ---------------------------------------------------------------------------

/** One convenience-run's outcome — logged by the calling handler, asserted by tests. */
export interface DataQualityGaugesResult {
  readonly coverage: (AlkoReferenceCoverageCounts & { readonly ratio: number }) | null;
  readonly transportRows: Readonly<Record<string, number>> | null;
  /** Per-feed ages in seconds (+Inf sentinel for never-successful feeds). */
  readonly feedAges: Readonly<Record<string, number>> | null;
  /** Per-gauge failures — one broken read must not starve the others. */
  readonly errors: readonly string[];
}

/**
 * Measure and write all three cadence gauges (coverage, transport rows,
 * per-feed last-success age) — the single call a 30-min tick handler
 * makes. Per-gauge isolation: a failing measure logs into `errors` and
 * skips only its own points; this function never throws (metrics must
 * never take a cron tick down).
 */
export async function measureAndRecordDataQualityGauges(
  env: Env,
  log?: Logger,
): Promise<DataQualityGaugesResult> {
  const errors: string[] = [];
  const fail = (gauge: string, err: unknown): string => {
    const message = `${gauge} measurement failed: ${
      err instanceof Error ? err.message : 'unknown error'
    }`;
    errors.push(message);
    log?.error({ message });
    return message;
  };

  let coverage: DataQualityGaugesResult['coverage'] = null;
  try {
    const counts = await measureAlkoReferenceCoverage(env.DB);
    recordAlkoReferenceCoverage(env, counts.coveredProducts, counts.totalProducts);
    coverage = { ...counts, ratio: alkoReferenceCoverageOf(counts) };
  } catch (err) {
    fail(ALKO_REFERENCE_COVERAGE_GAUGE, err);
  }

  let transportRows: Readonly<Record<string, number>> | null = null;
  try {
    transportRows = await measureTransportRowsPerCarrier(env.DB);
    recordTransportRowsPerCarrier(env, transportRows);
  } catch (err) {
    fail(TRANSPORT_OFFER_ROWS_GAUGE, err);
  }

  let feedAges: Readonly<Record<string, number>> | null = null;
  try {
    const newestByMerchant = await measureFeedLastSuccesses(env.DB);
    const ages: Record<string, number> = {};
    for (const merchant of Object.keys(newestByMerchant).sort()) {
      const newest = newestByMerchant[merchant];
      recordFeedLastSuccessAge(env, merchant, newest);
      ages[merchant] =
        newest === null ? TRANSPORT_AGE_INFINITE : transportAgeSeconds(newest);
    }
    feedAges = ages;
  } catch (err) {
    fail(FEED_LAST_SUCCESS_AGE_GAUGE, err);
  }

  return { coverage, transportRows, feedAges, errors };
}
