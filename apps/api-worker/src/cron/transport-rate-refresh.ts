/**
 * Transport-rate refresh cron handler (task 4.3, design D6) — the BullMQ
 * `TransportRateRefreshWorker` port. Cadence: every 6 hours
 * (`@Cron(CronExpression.EVERY_6_HOURS)` parity).
 *
 * Runs the existing transport pipeline (PipelineTransportRateAdapter:
 * governance-gated carrier sources — Posti first — appending validated
 * rates through the transport-offer write port over D1), then assesses
 * the 7-day freshness invariant. The BullMQ worker fed the Prometheus
 * gauge and logged the alert; on Workers the gauge moves to Analytics
 * Engine (task 6.1) and the alert to the email Worker (task 6.3) — this
 * handler keeps the log-level alert until then.
 *
 * @module TransportRateRefreshCron
 */

import { DEFAULT_STALENESS_THRESHOLDS } from '@rajahinta/core-domain';
import { PipelineTransportRateAdapter } from '../../../../packages/data-acquisition/src/adapters/pipeline-transport-rate.adapter';
import { PostiCarrierRateSource } from '../../../../packages/data-acquisition/src/adapters/posti-rate.source';
import type { ICarrierRateSource } from '../../../../packages/data-acquisition/src/interfaces/carrier-rate-source.port';
import { composeGovernanceService } from '../queues/pipeline';
import { D1TransportOfferWritePort } from '../adapters/d1-domain-ports';
import { recordTransportAge } from '../observability/metrics';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler registers under (wrangler triggers.crons). */
export const TRANSPORT_REFRESH_CRON = '0 */6 * * *';

/**
 * Metric-contract name the PrometheusRule alert expressions consumed
 * (infra/monitoring) — kept in the alert line so the log-based alert
 * stays greppable until task 6.3 moves it to the email Worker.
 */
const NEWEST_OFFER_AGE_METRIC = 'rajahinta_transport_newest_offer_age_seconds';

/** All-governed-carriers wildcard — BullMQ job data parity (`carrierId: '*'`). */
const ALL_CARRIERS = '*';

/** Carrier sources keyed by carrierId — Posti first (task 7.4 parity). */
export function composeCarrierRateSources(): Map<string, ICarrierRateSource> {
  const posti = new PostiCarrierRateSource();
  const map = new Map<string, ICarrierRateSource>();
  map.set(posti.carrierId, posti);
  return map;
}

/**
 * One 6-hourly refresh cycle + freshness assessment.
 *
 * `deps` is a test seam (refresh service override).
 */
export async function handleTransportRateRefresh(
  env: Env,
  log: Logger,
  deps: {
    refresh?: (carrierId: string) => Promise<{
      ratesUpdated: number;
      newestOfferObservedAt: Date | null;
    }>;
  } = {},
): Promise<{ ratesUpdated: number; newestOfferObservedAt: Date | null }> {
  const refresh =
    deps.refresh ??
    ((carrierId: string) => {
      const adapter = new PipelineTransportRateAdapter(
        composeGovernanceService(),
        composeCarrierRateSources(),
        new D1TransportOfferWritePort(env.DB),
      );
      return adapter.refreshCarrierRates(carrierId);
    });

  log.info({ message: 'Running 6-hourly transport-rate refresh' });
  const result = await refresh(ALL_CARRIERS);
  log.info({
    message: `Refreshed ${result.ratesUpdated} transport rates for all carriers`,
    ratesUpdated: result.ratesUpdated,
  });

  assessFreshness(log, result.newestOfferObservedAt);
  // Task 6.1 (design D8): the freshness gauge moves to Analytics Engine —
  // same metric contract (null → +Inf sentinel), no-op without METRICS.
  recordTransportAge(env, result.newestOfferObservedAt);
  return result;
}

/**
 * Feed the transport-offer age into the freshness alerting path
 * (background-jobs spec): log the gauge value and raise the alert when
 * the newest offer exceeds the 7-day transport staleness threshold.
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
        'newest offer age exceeds the 7-day threshold by definition',
    });
    return;
  }

  const ageMs = Date.now() - newestOfferObservedAt.getTime();
  const ageSeconds = Math.max(0, Math.floor(ageMs / 1000));

  const thresholdMs = DEFAULT_STALENESS_THRESHOLDS.transport.milliseconds;
  if (ageMs > thresholdMs) {
    const ageDays = (ageSeconds / 86_400).toFixed(1);
    log.error({
      message:
        `${NEWEST_OFFER_AGE_METRIC}=${ageSeconds} ` +
        `TRANSPORT_FRESHNESS_ALERT: newest transport offer is ${ageDays} days old ` +
        '(observed ' + newestOfferObservedAt.toISOString() + ') — exceeds the 7-day threshold; ' +
        'transport costs on all calculations degrade to ESTIMATED/UNAVAILABLE',
    });
  }
}
