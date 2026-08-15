import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { QUEUES } from '@rajahinta/data-acquisition';
import { JOB_REGISTRY } from './job-registry';
import type { PriceIngestionJobData } from './workers/price-ingestion.worker';
import type { TransportRateRefreshJobData } from './workers/transport-rate-refresh.worker';
import type { TaxDatasetReviewJobData } from './workers/tax-dataset-review.worker';
import type { TimeSeriesAggregationJobData } from './workers/time-series-aggregation.worker';

/**
 * Schedules recurring background jobs via @Cron() decorators.
 *
 * Every enqueued job inherits the defaultJobOptions from JOB_REGISTRY
 * (retry/backoff/ttl), keeping the request/response path clean.
 *
 * Cron expressions use Finnish time (Europe/Helsinki) for daily jobs;
 * high-frequency jobs run on short UTC intervals.
 */
@Injectable()
export class JobsSchedulerService {
  private readonly logger = new Logger(JobsSchedulerService.name);

  constructor(
    @InjectQueue(QUEUES.PRICE_INGESTION)
    private readonly priceIngestionQueue: Queue<PriceIngestionJobData>,

    @InjectQueue(QUEUES.TRANSPORT_REFRESH)
    private readonly transportRefreshQueue: Queue<TransportRateRefreshJobData>,

    @InjectQueue(QUEUES.TAX_DATASET_REVIEW)
    private readonly taxDatasetQueue: Queue<TaxDatasetReviewJobData>,

    @InjectQueue(QUEUES.TIME_SERIES_AGGREGATION)
    private readonly timeSeriesQueue: Queue<TimeSeriesAggregationJobData>,
  ) {}

  // -----------------------------------------------------------------------
  // Price ingestion — every hour
  // -----------------------------------------------------------------------

  @Cron(CronExpression.EVERY_HOUR)
  async schedulePriceIngestion(): Promise<void> {
    const cfg = JOB_REGISTRY[QUEUES.PRICE_INGESTION];
    this.logger.log('Enqueuing hourly price-ingestion job');

    // In production the list of active merchants comes from a registry.
    // For now enqueue a single catch-all job; the worker will iterate.
    await this.priceIngestionQueue.add(
      'hourly-refresh',
      { merchantId: '*', sourceUrl: '' },
      { jobId: `price-ingestion-hourly-${this.hourlyBucket()}`, ...cfg.defaultJobOptions },
    );
  }

  // -----------------------------------------------------------------------
  // Transport-rate refresh — every 6 hours
  // -----------------------------------------------------------------------

  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduleTransportRefresh(): Promise<void> {
    const cfg = JOB_REGISTRY[QUEUES.TRANSPORT_REFRESH];
    this.logger.log('Enqueuing 6-hourly transport-rate refresh job');

    await this.transportRefreshQueue.add(
      'periodic-refresh',
      { carrierId: '*' },
      { jobId: `transport-refresh-6h-${this.hourlyBucket()}`, ...cfg.defaultJobOptions },
    );
  }

  // -----------------------------------------------------------------------
  // Tax-dataset review — daily at 2 AM (Finnish time)
  // -----------------------------------------------------------------------

  @Cron('0 2 * * *', { timeZone: 'Europe/Helsinki' })
  async scheduleTaxDatasetReview(): Promise<void> {
    const cfg = JOB_REGISTRY[QUEUES.TAX_DATASET_REVIEW];
    this.logger.log('Enqueuing daily tax-dataset review job');

    await this.taxDatasetQueue.add(
      'daily-review',
      {},
      { jobId: `tax-review-daily-${this.dateBucket()}`, ...cfg.defaultJobOptions },
    );
  }

  // -----------------------------------------------------------------------
  // Time-series aggregation — every 30 minutes
  // -----------------------------------------------------------------------

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduleTimeSeriesAggregation(): Promise<void> {
    const cfg = JOB_REGISTRY[QUEUES.TIME_SERIES_AGGREGATION];
    this.logger.log('Enqueuing 30-minute time-series aggregation job');

    const now = new Date();
    const bucketStart = new Date(
      Math.floor(now.getTime() / 1_800_000) * 1_800_000, // round to 30 min
    ).toISOString();

    await this.timeSeriesQueue.add(
      'periodic-aggregation',
      { bucketStart, windowMinutes: 30 },
      { jobId: `ts-aggregation-${this.hourlyBucket()}`, ...cfg.defaultJobOptions },
    );
  }

  // -----------------------------------------------------------------------
  // Helpers — deterministic job IDs for idempotent enqueue
  // -----------------------------------------------------------------------

  /** Bucket key: YYYY-MM-DDTHH (UTC). */
  private hourlyBucket(): string {
    return new Date().toISOString().slice(0, 13).replace('T', '-');
  }

  /** Bucket key: YYYY-MM-DD. */
  private dateBucket(): string {
    return new Date().toISOString().slice(0, 10);
  }
}