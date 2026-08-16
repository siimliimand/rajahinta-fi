/**
 * /classification barrel — public exports for the classification subdomain.
 *
 * Consumers import from `@rajahinta/core-domain/classification` (or from
 * the top-level index when the module is re-exported).
 *
 * @module ClassificationIndex
 */

// Module
export { ClassificationModule } from './classification.module';

// Service
export { TransactionClassificationService } from './transaction-classification.service';

// Types
export type {
  ClassificationInput,
  ClassificationResult,
  ClassificationLabel,
  ConfidenceLevel,
} from './classification.types';

// Rule types (prep for 6.3)
export type {
  ClassificationRule,
  ClassificationRuleSet,
} from './classification-rule.types';