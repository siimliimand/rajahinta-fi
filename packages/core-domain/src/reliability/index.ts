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

// Service
export { ReliabilityService } from './reliability.service';

// Module
export { ReliabilityModule } from './reliability.module';