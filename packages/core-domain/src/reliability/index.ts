/**
 * /reliability barrel — public exports for the reliability subdomain.
 *
 * Consumers import from `@rajahinta/core-domain/reliability` (or from the
 * top-level index when the module is re-exported).
 *
 * @module ReliabilityIndex
 */

// Types
export type { ReliabilityStatus, ReliabilityDomain, Duration } from './reliability.types';
export {
  RELIABILITY_ORDER,
  DEFAULT_STALENESS_THRESHOLDS,
  HOUR,
  DAY,
  WEEK,
} from './reliability.types';
export type { ConfidenceLevel, ConfidenceDetail, ConfidenceReport, ConfidenceUISnapshot } from './confidence-framework.types';
export type { LandingCostInputStatuses } from './confidence-framework.types';
export type {
  MerchantReliabilityScore,
  MerchantReliabilityScoreInput,
} from './merchant-reliability-score.types';
export { MerchantReliabilityInputError } from './merchant-reliability-score.types';

// Service
export { ReliabilityService } from './reliability.service';
export { ConfidenceFrameworkService } from './confidence-framework.service';
export { MerchantReliabilityScoreService } from './merchant-reliability-score.service';

// Module
export { ReliabilityModule } from './reliability.module';