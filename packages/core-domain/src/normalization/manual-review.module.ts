/**
 * Manual Review Module — queue for human review of low-confidence matches.
 *
 * Import this module into CoreDomainModule or directly into the feature
 * module that needs product matching with review. The port
 * IManualReviewRepository must be provided by the composition root
 * (typically DataPlatform).
 *
 * @module ManualReviewModule
 */
import { Module } from '@nestjs/common';
import { ManualReviewService } from './manual-review.service';
import { MANUAL_REVIEW_REPOSITORY_PORT } from './ports/manual-review-repository.port';

@Module({
  providers: [
    ManualReviewService,
    { provide: MANUAL_REVIEW_REPOSITORY_PORT, useValue: null },
  ],
  exports: [ManualReviewService],
})
export class ManualReviewModule {}