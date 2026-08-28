import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Logger, Optional } from '@nestjs/common';
import {
  QUEUES,
  TransportRateService,
} from '@rajahinta/data-acquisition';
import { DEFAULT_STALENESS_THRESHOLDS } from '@rajahinta/core-domain';
import { PrometheusMetricsService } from '../../observability/metrics.service';

export interface TransportRateRefreshJobData {
  carrierId: string;
}

/**
 * Metric contract: the gauge the PrometheusRule alert expressions
 * consume (infra/monitoring/README.md). Exported by
 * PrometheusMetricsService on the internal /metrics endpoint; set here
 * after every refresh cycle from the pipeline's newest-observedAt.
 */
const NEWEST_OFFER_AGE_METRIC = 'rajahinta_transport_newest_offer_age_seconds';

@Processor(QUEUES.TRANSPORT_REFRESH)
export class TransportRateRefreshWorker {
  private readonly logger = new Logger(TransportRateRefreshWorker.name);

  constructor(
    private readonly transportRate: TransportRateService,
    // Optional so hosts/tests constructing the worker without the
    // observability module keep working; DI injects the @Global
    // PrometheusMetricsService whenever the full app graph is booted.
    @Optional() private readonly metrics?: PrometheusMetricsService,
  ) {}

  @Process({ concurrency: 2 })
  async process(job: Job<TransportRateRefreshJobData>): Promise<void> {
    this.logger.log(
      `Refreshing transport rates for carrier ${job.data.carrierId} (attempt ${job.attemptsMade + 1})`,
    );

    const result = await this.transportRate.refreshCarrierRates(
      job.data.carrierId,
    );

    this.logger.log(
      `Refreshed ${result.ratesUpdated} transport rates for carrier ${job.data.carrierId}`,
    );

    this.assessFreshness(result.newestOfferObservedAt);
  }

  /**
   * Feed the transport-offer age into the freshness alerting path
   * (task 7.4 / background-jobs spec): set the gauge value and raise
   * the alert when the newest offer exceeds the 7-day transport
   * staleness threshold.
   */
  private assessFreshness(newestOfferObservedAt: Date | null): void {
    // No offers at all → gauge +Inf: the degenerate case of every offer
    // being stale, so the invariant (and both alert thresholds) fires.
    if (newestOfferObservedAt === null) {
      this.metrics?.setTransportNewestOfferAge(null);
      this.logger.error(
        `${NEWEST_OFFER_AGE_METRIC}=+Inf ` +
          'TRANSPORT_FRESHNESS_ALERT: no transport offers exist — ' +
          'newest offer age exceeds the 7-day threshold by definition',
      );
      return;
    }

    const ageMs = Date.now() - newestOfferObservedAt.getTime();
    const ageSeconds = Math.max(0, Math.floor(ageMs / 1000));
    this.metrics?.setTransportNewestOfferAge(ageSeconds);

    const thresholdMs = DEFAULT_STALENESS_THRESHOLDS.transport.milliseconds;
    if (ageMs > thresholdMs) {
      const ageDays = (ageSeconds / 86_400).toFixed(1);
      this.logger.error(
        `${NEWEST_OFFER_AGE_METRIC}=${ageSeconds} ` +
          `TRANSPORT_FRESHNESS_ALERT: newest transport offer is ${ageDays} days old ` +
          '(observed ' + newestOfferObservedAt.toISOString() + ') — exceeds the 7-day threshold; ' +
          'transport costs on all calculations degrade to ESTIMATED/UNAVAILABLE',
      );
    }
  }
}
