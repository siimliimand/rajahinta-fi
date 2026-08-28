import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  QUEUES,
  TransportRateService,
} from '@rajahinta/data-acquisition';
import { DEFAULT_STALENESS_THRESHOLDS } from '@rajahinta/core-domain';

export interface TransportRateRefreshJobData {
  carrierId: string;
}

/**
 * Metric contract: the gauge name the PrometheusRule alert expressions
 * consume (infra/monitoring/README.md). Until a /metrics exporter lands,
 * this structured log line is the metric hook — the value is emitted
 * after every refresh cycle exactly as the gauge would be.
 */
const NEWEST_OFFER_AGE_METRIC = 'rajahinta_transport_newest_offer_age_seconds';

@Processor(QUEUES.TRANSPORT_REFRESH)
export class TransportRateRefreshWorker {
  private readonly logger = new Logger(TransportRateRefreshWorker.name);

  constructor(
    private readonly transportRate: TransportRateService,
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
   * (task 7.4 / background-jobs spec): emit the gauge value and raise
   * the alert when the newest offer exceeds the 7-day transport
   * staleness threshold.
   */
  private assessFreshness(newestOfferObservedAt: Date | null): void {
    if (newestOfferObservedAt === null) {
      // No offers at all is the degenerate case of every offer being
      // stale — the invariant is already broken, so it alerts.
      this.logger.error(
        `${NEWEST_OFFER_AGE_METRIC}=inf ` +
          'TRANSPORT_FRESHNESS_ALERT: no transport offers exist — ' +
          'newest offer age exceeds the 7-day threshold by definition',
      );
      return;
    }

    const ageSeconds = Math.max(
      0,
      Math.floor((Date.now() - newestOfferObservedAt.getTime()) / 1000),
    );
    this.logger.log(`${NEWEST_OFFER_AGE_METRIC}=${ageSeconds}`);

    const thresholdMs = DEFAULT_STALENESS_THRESHOLDS.transport.milliseconds;
    if (Date.now() - newestOfferObservedAt.getTime() > thresholdMs) {
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
