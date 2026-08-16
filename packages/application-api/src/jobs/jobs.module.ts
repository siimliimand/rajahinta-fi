import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DataAcquisitionModule } from '@rajahinta/data-acquisition';
import { JobsSchedulerService } from './jobs-scheduler.service';
import { PriceIngestionWorker } from './workers/price-ingestion.worker';
import { TransportRateRefreshWorker } from './workers/transport-rate-refresh.worker';
import { TaxDatasetReviewWorker } from './workers/tax-dataset-review.worker';
import { TimeSeriesAggregationWorker } from './workers/time-series-aggregation.worker';

@Module({
  imports: [
    // DataAcquisitionModule provides:
    // - Bull queue providers (registered via BullModule.registerQueue)
    // - Abstract service tokens injected by workers (PriceIngestionService, etc.)
    DataAcquisitionModule,

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

    // Scheduled job enqueuer
    JobsSchedulerService,
  ],
  exports: [
    JobsSchedulerService,
  ],
})
export class JobsModule {}