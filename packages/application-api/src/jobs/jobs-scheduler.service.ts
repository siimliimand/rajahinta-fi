import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import type { PermissionCheckResult } from '@rajahinta/core-domain';
import { SourceGovernanceService } from '@rajahinta/core-domain';
import { MerchantRegistryRepository } from '@rajahinta/data-platform';
import { QUEUES, RateReviewSchedulerService } from '@rajahinta/data-acquisition';
import { JOB_REGISTRY } from './job-registry';
import type { PriceIngestionJobData } from './workers/price-ingestion.worker';
import type { TransportRateRefreshJobData } from './workers/transport-rate-refresh.worker';
import type { TaxDatasetReviewJobData } from './workers/tax-dataset-review.worker';
import type { TimeSeriesAggregationJobData } from './workers/time-series-aggregation.worker';
import type { FxDatasetReviewJobData } from './workers/fx-dataset-review.worker';

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
export class JobsSchedulerService implements OnModuleInit {
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

    @InjectQueue(QUEUES.FX_DATASET_REVIEW)
    private readonly fxDatasetReviewQueue: Queue<FxDatasetReviewJobData>,

    private readonly rateReviewScheduler: RateReviewSchedulerService,

    private readonly merchantRegistry: MerchantRegistryRepository,

    private readonly governanceService: SourceGovernanceService,
  ) {}

  /**
   * Bootstrap lifecycle hook — start the rate-review scheduler after all
   * Bull queues are set up.
   */
  async onModuleInit(): Promise<void> {
    this.rateReviewScheduler.scheduleNextReview();
  }

  // -----------------------------------------------------------------------
  // Price ingestion — one job per permitted merchant, every hour
  // (task 7.3, design D7)
  // -----------------------------------------------------------------------

  /**
   * Registry-driven per-merchant scheduling.
   *
   * The merchant registry joined with governance permission state is
   * the source list: every permitted (GRANTED) merchant with a feed
   * URL gets its OWN job this hour, deduped by a per-merchant jobId
   * (`price-ingestion-<merchantId>-<hour>`). Independent jobs mean a
   * slow feed delays nobody else, and per-merchant retries/backoff
   * come from the queue's defaultJobOptions applied per job. A slow or
   * failing feed is monitored per merchant through its distinct job id.
   *
   * The permission check is the pipeline's own fail-closed rule: no
   * governance records, a governance outage, or any status other than
   * GRANTED skips the merchant (default-off).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async schedulePriceIngestion(): Promise<void> {
    const cfg = JOB_REGISTRY[QUEUES.PRICE_INGESTION];

    const merchants = await this.merchantRegistry.list();

    let enqueued = 0;
    for (const merchant of merchants) {
      if (!merchant.feedUrl) {
        // Registry convention: an empty feed URL marks a merchant whose
        // adapter is not live yet (e.g. Alko pre-7.5 wiring).
        this.logger.log(
          `Skipping merchant "${merchant.merchantId}": registry feed URL is empty`,
        );
        continue;
      }

      const permitted = await this.isMerchantPermitted(merchant.merchantId);
      if (!permitted) {
        continue;
      }

      try {
        await this.priceIngestionQueue.add(
          'merchant-refresh',
          { merchantId: merchant.merchantId, sourceUrl: merchant.feedUrl },
          {
            jobId: `price-ingestion-${merchant.merchantId}-${this.hourlyBucket()}`,
            ...cfg.defaultJobOptions,
          },
        );
        enqueued++;
      } catch (err) {
        // Monitoring hook: one merchant's enqueue failure must not
        // starve the remaining merchants' schedules.
        this.logger.error(
          `Failed to enqueue price-ingestion job for merchant "${merchant.merchantId}": ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }

    this.logger.log(
      `Hourly price ingestion: enqueued ${enqueued}/${merchants.length} ` +
        `registry merchant job(s) — one job per permitted merchant`,
    );
  }

  /**
   * Governance permission check for the scheduler — mirrors the
   * pipeline's gate (PipelineOrchestratorService.checkMerchantPermission):
   * no records or a governance error default to PENDING (off), never
   * to granted.
   */
  private async isMerchantPermitted(merchantId: string): Promise<boolean> {
    let result: PermissionCheckResult;
    try {
      result = await this.governanceService.checkPermission(merchantId);
    } catch (err) {
      this.logger.error(
        `Not scheduling merchant "${merchantId}": governance check failed — ` +
          `defaulting to PENDING (${err instanceof Error ? err.message : String(err)})`,
      );
      return false;
    }

    if (result.sources.length === 0) {
      this.logger.log(
        `Not scheduling merchant "${merchantId}": no governance records — defaulting to PENDING`,
      );
      return false;
    }

    if (result.permissionStatus !== 'GRANTED') {
      this.logger.log(
        `Not scheduling merchant "${merchantId}": permission status is ${result.permissionStatus}`,
      );
      return false;
    }

    return true;
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
  // FX-dataset review — daily at 3 AM (Finnish time)
  // -----------------------------------------------------------------------

  /**
   * Recurring FX source check (task 1.3, design D2): fetch the latest
   * ECB reference rates and surface a PENDING_CONFIRMATION dataset for
   * operator confirmation. ECB publishes reference rates on TARGET
   * business days by ~16:00 CET — a 3 AM Helsinki check always sees the
   * previous publication. The worker never publishes.
   */
  @Cron('0 3 * * *', { timeZone: 'Europe/Helsinki' })
  async scheduleFxDatasetReview(): Promise<void> {
    const cfg = JOB_REGISTRY[QUEUES.FX_DATASET_REVIEW];
    this.logger.log('Enqueuing daily FX-dataset review job');

    await this.fxDatasetReviewQueue.add(
      'daily-review',
      {},
      { jobId: `fx-review-daily-${this.dateBucket()}`, ...cfg.defaultJobOptions },
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