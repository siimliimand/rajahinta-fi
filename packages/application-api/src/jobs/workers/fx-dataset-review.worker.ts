import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  QUEUES,
  FxDatasetReviewService,
} from '@rajahinta/data-acquisition';

/**
 * Empty job data — the FX dataset review checks its configured source
 * (ECB reference rates default). Payload reserved for future filtering
 * by source.
 */
export interface FxDatasetReviewJobData {
  readonly sources?: string[];
}

/**
 * FX dataset review worker (task 1.3, change
 * technical-assessment-remediation; design D2).
 *
 * Runs the recurring FX source check. When the source offers a new
 * reference date, the service has created a PENDING_CONFIRMATION
 * dataset — the confirmation task for a human operator. This worker
 * NEVER publishes and performs no cache invalidation: an unconfirmed
 * dataset is not effective, so nothing that reads published rates (the
 * ingestion conversion, the calculator) can observe it yet. Invalidation
 * on FX dataset version change belongs to the confirmation path
 * (operator console, task 12.1).
 */
@Processor(QUEUES.FX_DATASET_REVIEW)
export class FxDatasetReviewWorker {
  private readonly logger = new Logger(FxDatasetReviewWorker.name);

  constructor(
    private readonly fxReview: FxDatasetReviewService,
  ) {}

  @Process({ concurrency: 1 })
  async process(job: Job<FxDatasetReviewJobData>): Promise<void> {
    this.logger.log(
      `Checking the FX rate source for newly available reference rates (attempt ${job.attemptsMade + 1})`,
    );

    const result = await this.fxReview.checkForNewRates();

    if (result.errors.length > 0) {
      this.logger.warn(
        `FX rate check reported ${result.errors.length} source error(s): ${result.errors.join('; ')}`,
      );
    }

    if (result.requiresConfirmation) {
      this.logger.warn(
        `FX dataset ${result.detectedVersions.join(', ')} awaiting manual confirmation — ` +
          'no rates auto-published',
      );
    } else {
      this.logger.log(
        `No new FX datasets (${result.datasetsFound} created this check)`,
      );
    }
  }
}
