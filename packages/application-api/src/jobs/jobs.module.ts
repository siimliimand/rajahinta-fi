import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DataAcquisitionModule } from '@rajahinta/data-acquisition';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { AccountModule } from '../accounts/account.module';
import { IdempotencyModule } from '../idempotency';
import { JobsSchedulerService } from './jobs-scheduler.service';
import { PriceIngestionWorker } from './workers/price-ingestion.worker';
import { TransportRateRefreshWorker } from './workers/transport-rate-refresh.worker';
import { TaxDatasetReviewWorker } from './workers/tax-dataset-review.worker';
import { TimeSeriesAggregationWorker } from './workers/time-series-aggregation.worker';
import { AccountRetentionWorker } from './workers/account-retention.worker';
import { CalculationRecordRetentionWorker } from './workers/calculation-record-retention.worker';

@Module({
  imports: [
    // DataAcquisitionModule provides:
    // - Bull queue providers (registered via BullModule.registerQueue)
    // - Abstract service tokens injected by workers (PriceIngestionService, etc.)
    DataAcquisitionModule,

    // DataPlatformModule provides the repository abstracts injected by
    // the time-series aggregation worker (observation scan reads,
    // summary upserts, persisted watermark).
    DataPlatformModule,

    // AccountModule provides AccountRetentionService for the retention
    // cron worker.
    AccountModule,

    // IdempotencyModule provides IdempotencyService for cache invalidation
    // when new dataset versions are detected.
    IdempotencyModule,

    // Enable @Cron() decorators in JobsSchedulerService
    ScheduleModule.forRoot(),
  ],
  providers: [
    // Workers — auto-started by @Processor decorator; queue providers
    // resolved from DataAcquisitionModule's exported BullModule.
    PriceIngestionWorker,
    TransportRateRefreshWorker,
    TaxDatasetReviewWorker,
    TimeSeriesAggregationWorker,

    // Cron-only workers — direct @Cron() decorator (no Bull queue)
    AccountRetentionWorker,

    // Calculation-record retention (task 8.1, change
    // technical-assessment-remediation): monthly partitions + anonymous
    // pruning. Resolves CalculationRecordRetentionService from
    // DataPlatformModule.
    CalculationRecordRetentionWorker,

    // Scheduled job enqueuer
    JobsSchedulerService,
  ],
  exports: [
    JobsSchedulerService,
  ],
})
export class JobsModule {}