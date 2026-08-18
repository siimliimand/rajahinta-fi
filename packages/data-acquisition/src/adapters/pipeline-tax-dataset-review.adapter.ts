/**
 * Pipeline-backed tax-dataset-review service.
 *
 * Concrete implementation of the legacy {@link TaxDatasetReviewService}
 * abstract class that delegates to {@link RateReviewSchedulerService}
 * for checking newly published official tax rates.
 *
 * Discovered changes are NEVER auto-published — a manual-review entry
 * is created for operator/legal confirmation before any new dataset
 * version goes live.
 *
 * @module PipelineTaxDatasetReviewAdapter
 */

import { Injectable, Logger } from '@nestjs/common';
import { TaxDatasetReviewService } from '../abstract/tax-dataset-review.service';
import { RateReviewSchedulerService } from '../services/rate-review-scheduler.service';

@Injectable()
export class PipelineTaxDatasetReviewAdapter extends TaxDatasetReviewService {
  private readonly logger = new Logger(PipelineTaxDatasetReviewAdapter.name);

  constructor(
    private readonly rateReviewScheduler: RateReviewSchedulerService,
  ) {
    super();
  }

  /**
   * Check for newly published official tax rates.
   *
   * Delegates to {@link RateReviewSchedulerService.checkForRateChanges}
   * and maps the result to the legacy return shape.
   */
  async checkForNewPublishedRates(): Promise<{
    datasetsFound: number;
    requiresConfirmation: boolean;
  }> {
    const result = await this.rateReviewScheduler.checkForRateChanges();

    if (result.newRatesDetected) {
      this.logger.warn(
        'New tax datasets detected — manual confirmation required before publishing',
      );
      return { datasetsFound: 1, requiresConfirmation: true };
    }

    return { datasetsFound: 0, requiresConfirmation: false };
  }
}