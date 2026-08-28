/**
 * /normalization barrel — public exports for the normalization subdomain.
 *
 * Consumers import from `@rajahinta/core-domain/normalization` (or from the
 * top-level index when the module is re-exported).
 *
 * @module NormalizationIndex
 */

// Types
export type {
  CanonicalCategory,
  CanonicalContainerType,
  NormalizedProduct,
  RawProductInput,
  VolumeUnit,
} from './normalization.types';

// Classification vocabulary (task 7.1 — gate validates against this set)
export {
  CANONICAL_CATEGORY_KEYS,
  KNOWN_REGULATORY_CLASSIFICATIONS,
  REGULATORY_CLASSIFICATION_PLACEHOLDER,
} from './normalization.types';

// Source-category normalization (task 7.1 — SE → canonical at ingestion)
export {
  mapSourceCategory,
  isKnownTaxCategory,
  SWEDISH_SOURCE_CATEGORY_MAP,
} from './source-category.mapper';
export type { SourceCategoryMapping } from './source-category.mapper';

// Matcher types
export type {
  MatchConfidence,
  MatchMethod,
  ProductMatchCandidate,
  ProductMatchResult,
} from './product-matcher.types';

// Port
export type { IProductMasterQuery, ProductMasterRecord } from './ports/product-master-query.port';
export { PRODUCT_MASTER_QUERY_PORT } from './ports/product-master-query.port';

// Pure helpers (exported for testing / direct use)
export {
  normalizeBrandName,
  normalizeCategory,
  standardizeVolume,
  standardizeContainerType,
  validateAbv,
} from './normalization.service';

// Service
export { NormalizationService } from './normalization.service';

// Matcher
export { ProductMatcherService } from './product-matcher.service';
export {
  tokenize,
  jaccardSimilarity,
  levenshteinDistance,
  scoreNameSimilarity,
  scoreBrandSimilarity,
  scoreVolumeMatch,
  scoreAbvMatch,
  scoreCategoryMatch,
  scoreProduct,
  scoreToConfidence,
} from './product-matcher.service';

// Module
export { NormalizationModule } from './normalization.module';

// Matcher module
export { ProductMatcherModule } from './product-matcher.module';

// Manual review types
export type {
  PendingReview,
  ReviewResolution,
  ReviewStatus,
} from './manual-review.types';

// Manual review port
export type { IManualReviewRepository } from './ports/manual-review-repository.port';
export { MANUAL_REVIEW_REPOSITORY_PORT } from './ports/manual-review-repository.port';

// Manual review service & module
export { ManualReviewService } from './manual-review.service';
export { ManualReviewModule } from './manual-review.module';

// Classification gate
export type { GateResult, GateProduct } from './classification-gate.service';
export { ClassificationGateService } from './classification-gate.service';