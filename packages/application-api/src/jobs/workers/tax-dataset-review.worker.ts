import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  QUEUES,
  TaxDatasetReviewService,
} from '@rajahinta/data-acquisition';
import { IdempotencyService } from '../../idempotency';

/**
 * Empty job data — TaxDatasetReview checks all known sources.
 * Payload reserved for future filtering by publication channel.
 */
export interface TaxDatasetReviewJobData {
  readonly channels?: string[];
}

@Processor(QUEUES.TAX_DATASET_REVIEW)
export class TaxDatasetReviewWorker {
  private readonly logger = new Logger(TaxDatasetReviewWorker.name);

  constructor(
    private readonly taxReview: TaxDatasetReviewService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Process({ concurrency: 1 })
  async process(job: Job<TaxDatasetReviewJobData>): Promise<void> {
    this.logger.log(
      `Checking for newly published official tax rates (attempt ${job.attemptsMade + 1})`,
    );

    const result = await this.taxReview.checkForNewPublishedRates();

    this.logger.log(
      `Found ${result.datasetsFound} new dataset(s), requires confirmation: ${result.requiresConfirmation}`,
    );

    if (result.requiresConfirmation) {
      this.logger.warn(
        'New tax datasets found requiring manual confirmation — no rates auto-published',
      );

      // Invalidate cached calculations that reference the replaced
      // dataset versions so subsequent lookups re-compute with fresh data.
      const versions = result.detectedVersions;
      if (versions !== undefined && versions.length > 0) {
        this.logger.log(
          `Invalidating idempotency cache for versions: ${versions.join(', ')}`,
        );
        await this.idempotency.invalidateOnVersionChange([...versions]);
      }
    }
  }
}