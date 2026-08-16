import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUES } from '@rajahinta/data-acquisition';

export interface TimeSeriesAggregationJobData {
  /** ISO-8601 period bucket, e.g. '2026-08-15T00:00:00Z'. */
  readonly bucketStart: string;
  /** Aggregation window in minutes. */
  readonly windowMinutes: number;
}

/**
 * Aggregates time-series data (price history, rate changes) into
 * summarised buckets for dashboard and trend analysis.
 *
 * The actual aggregation logic will be injected once the data-platform
 * package provides the repository layer.  For now this is a stub that
 * logs and will call into TimeSeriesRepository when ready.
 */
@Processor(QUEUES.TIME_SERIES_AGGREGATION)
export class TimeSeriesAggregationWorker {
  private readonly logger = new Logger(TimeSeriesAggregationWorker.name);

  constructor() {
    // Future: inject TimeSeriesRepository or DataPlatformService
  }

  @Process({ concurrency: 1 })
  async process(job: Job<TimeSeriesAggregationJobData>): Promise<void> {
    this.logger.log(
      `Aggregating time-series for bucket ${job.data.bucketStart} (window: ${job.data.windowMinutes} min, attempt ${job.attemptsMade + 1})`,
    );

    // Stub — wire into data-platform repository when available
    this.logger.log(
      `Time-series aggregation placeholder for bucket ${job.data.bucketStart} — no-op until repository layer exists`,
    );
  }
}