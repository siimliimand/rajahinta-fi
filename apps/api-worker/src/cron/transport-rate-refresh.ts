/**
 * Transport freshness gauge cron handler — the BullMQ
 * `TransportRateRefreshWorker` port. Cadence: every 6 hours
 * (`@Cron(CronExpression.EVERY_6_HOURS)` parity).
 *
 * ## The refresh is retired — this tick reads, it no longer appends
 *
 * The handler used to run the transport pipeline every 6 hours
 * (PipelineTransportRateAdapter, Posti first, governance-gated). The
 * monitored carriers are curated in-repo datasets now, and
 * curated-rate-refresh.ts owns the append path (monthly, with the
 * unchanged skip and the durable D1SourceGovernanceRepository gate).
 * This tick's own append path has been governance-fail-closed since
 * the cutover: it composed the empty in-memory governance repository
 * (the no-arg composeGovernanceService() default — the same mistake
 * behind the 2026-10 Posti append gap, fixed for the curated cron
 * only), so every run skipped its carrier and wrote nothing. Wiring
 * the D1 store here instead would make things worse — the pipeline
 * adapter has no unchanged-skip, so a permitted run would append
 * duplicate curated rows every 6 hours into append-only history.
 *
 * The two live duties stay on this pattern:
 *
 * - The Analytics Engine freshness gauge (task 6.1, design D8) — the
 *   newest observed_at read straight from D1, same metric contract
 *   (null → +Inf sentinel), no-op without METRICS.
 * - The log-level freshness assessment — thresholded to the curated
 *   review cadence (TRANSPORT_AGE_THRESHOLDS, the freshness-alert
 *   email's constants): the pre-curation "7-day" wording here
 *   contradicted the 45/90-day paging that actually fires.
 *
 * @module TransportRateRefreshCron
 */

import { D1TransportOfferWritePort } from '../adapters/d1-domain-ports';
import { recordTransportAge, transportAgeSeconds } from '../observability/metrics';
import { TRANSPORT_AGE_THRESHOLDS } from './freshness-alert';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler registers under (wrangler triggers.crons). */
export const TRANSPORT_REFRESH_CRON = '0 */6 * * *';

/**
 * Metric-contract name the PrometheusRule alert expressions consumed
 * (infra/k8s/base/prometheusrule.yaml) — kept in the alert line so the
 * log-based alert stays greppable alongside the freshness-alert email
 * (task 6.3).
 */
const NEWEST_OFFER_AGE_METRIC = 'rajahinta_transport_newest_offer_age_seconds';

/**
 * One 6-hourly freshness tick: read the newest transport-offer
 * observed_at from D1, assess the review-cadence invariant into the
 * log, and feed the Analytics Engine gauge.
 *
 * `deps` is a test seam (newest-observation read override).
 */
export async function handleTransportRateRefresh(
  env: Env,
  log: Logger,
  deps: {
    findNewestObservedAt?: () => Promise<Date | null>;
  } = {},
): Promise<{ newestOfferObservedAt: Date | null }> {
  const findNewestObservedAt =
    deps.findNewestObservedAt ??
    (() => new D1TransportOfferWritePort(env.DB).findNewestObservedAt());

  log.info({ message: 'Running 6-hourly transport freshness tick' });
  const newestOfferObservedAt = await findNewestObservedAt();

  assessFreshness(log, newestOfferObservedAt);
  recordTransportAge(env, newestOfferObservedAt);
  return { newestOfferObservedAt };
}

/**
 * Log-level transport freshness assessment against the curated review
 * cadence (TRANSPORT_AGE_THRESHOLDS — the same constants the
 * freshness-alert email cron evaluates, so log and paging can never
 * diverge): warning at 45 days, critical at 90 days. The user-facing
 * reliability staleness contract is a separate, shorter window and
 * already degrades the rows to STALE well before either level.
 */
export function assessFreshness(
  log: Logger,
  newestOfferObservedAt: Date | null,
): void {
  // No offers at all → gauge +Inf: the degenerate case of every offer
  // being stale, so the invariant (and both alert thresholds) fires.
  if (newestOfferObservedAt === null) {
    log.error({
      message:
        `${NEWEST_OFFER_AGE_METRIC}=+Inf ` +
        'TRANSPORT_FRESHNESS_ALERT: no transport offers exist — ' +
        'newest offer age exceeds every threshold by definition',
    });
    return;
  }

  const ageSeconds = transportAgeSeconds(newestOfferObservedAt);
  const { warning, critical } = TRANSPORT_AGE_THRESHOLDS;
  const ageDays = (ageSeconds / 86_400).toFixed(1);

  if (ageSeconds > critical.thresholdSeconds) {
    log.error({
      message:
        `${NEWEST_OFFER_AGE_METRIC}=${ageSeconds} ` +
        `TRANSPORT_FRESHNESS_ALERT (critical): newest transport offer is ${ageDays} days old ` +
        `(observed ${newestOfferObservedAt.toISOString()}) — exceeds the 90-day critical level; ` +
        'the quarterly curated re-verification is a full season overdue',
    });
    return;
  }
  if (ageSeconds > warning.thresholdSeconds) {
    log.error({
      message:
        `${NEWEST_OFFER_AGE_METRIC}=${ageSeconds} ` +
        `TRANSPORT_FRESHNESS_ALERT (warning): newest transport offer is ${ageDays} days old ` +
        `(observed ${newestOfferObservedAt.toISOString()}) — exceeds the 45-day warning level; ` +
        'schedule the curated re-verification (curated-rate-refresh.ts)',
    });
  }
}
