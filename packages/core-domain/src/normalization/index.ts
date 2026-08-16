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