/**
 * RateReviewModule — registers the rate-review scheduler service and its
 * configuration token.
 *
 * Consumers must provide an implementation of {@link IRateReviewRepository}
 * in their composition root (typically DataPlatform).  The default config
 * is suitable for production; callers can override by providing their own
 * {@link RateReviewConfig} under {@link RATE_REVIEW_CONFIG_TOKEN}.
 *
 * Rates are NEVER auto-published — the scheduler creates review entries
 * that require manual/legal confirmation.
 *
 * @module RateReviewModule
 */

import { Module } from '@nestjs/common';
import { RateReviewSchedulerService, RATE_REVIEW_CONFIG_TOKEN, DEFAULT_RATE_REVIEW_CONFIG } from './rate-review-scheduler.service';

@Module({
  providers: [
    RateReviewSchedulerService,
    { provide: RATE_REVIEW_CONFIG_TOKEN, useValue: DEFAULT_RATE_REVIEW_CONFIG },
  ],
  exports: [
    RateReviewSchedulerService,
    RATE_REVIEW_CONFIG_TOKEN,
  ],
})
export class RateReviewModule {}