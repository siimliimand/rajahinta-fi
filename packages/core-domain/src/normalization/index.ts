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

// Module
export { NormalizationModule } from './normalization.module';