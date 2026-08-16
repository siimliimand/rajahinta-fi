/**
 * Product Matcher Module — resolves NormalizedProduct instances to existing
 * Product Master records for cross-merchant deduplication.
 *
 * Import this module into CoreDomainModule or directly into the feature
 * module that needs product matching. The port IProductMasterQuery must be
 * provided by the composition root (typically DataPlatform).
 *
 * This module imports ManualReviewModule so that ProductMatcherService can
 * auto-enqueue low-confidence matches for human review.
 *
 * @module ProductMatcherModule
 */
import { Module } from '@nestjs/common';
import { ProductMatcherService } from './product-matcher.service';
import { PRODUCT_MASTER_QUERY_PORT } from './ports/product-master-query.port';
import { ManualReviewModule } from './manual-review.module';

@Module({
  imports: [ManualReviewModule],
  providers: [
    ProductMatcherService,
    { provide: PRODUCT_MASTER_QUERY_PORT, useValue: null },
  ],
  exports: [ProductMatcherService],
})
export class ProductMatcherModule {}