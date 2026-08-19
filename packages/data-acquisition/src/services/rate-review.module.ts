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
import {
  RateReviewSchedulerService,
  ConfigBackedRateChangeSource,
  RATE_REVIEW_CONFIG_TOKEN,
  DEFAULT_RATE_REVIEW_CONFIG,
  RATE_CHANGE_SOURCE_CONFIG_TOKEN,
  DEFAULT_RATE_CHANGE_SOURCE_CONFIG,
} from './rate-review-scheduler.service';
import { RATE_CHANGE_SOURCE_PORT } from '../interfaces/rate-review-repository.port';

@Module({
  providers: [
    RateReviewSchedulerService,
    { provide: RATE_REVIEW_CONFIG_TOKEN, useValue: DEFAULT_RATE_REVIEW_CONFIG },
    { provide: RATE_CHANGE_SOURCE_PORT, useClass: ConfigBackedRateChangeSource },
    { provide: RATE_CHANGE_SOURCE_CONFIG_TOKEN, useValue: DEFAULT_RATE_CHANGE_SOURCE_CONFIG },
  ],
  exports: [
    RateReviewSchedulerService,
    RATE_REVIEW_CONFIG_TOKEN,
    RATE_CHANGE_SOURCE_PORT,
  ],
})
export class RateReviewModule {}