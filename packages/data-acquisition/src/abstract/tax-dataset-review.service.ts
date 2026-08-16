import { Injectable } from '@nestjs/common';

/**
 * Checks for newly published official tax rate changes.
 * Rates are never auto-published — discoveries create a task for
 * manual/legal confirmation before any new dataset version goes live.
 */
@Injectable()
export abstract class TaxDatasetReviewService {
  abstract checkForNewPublishedRates(): Promise<{
    datasetsFound: number;
    requiresConfirmation: boolean;
  }>;
}