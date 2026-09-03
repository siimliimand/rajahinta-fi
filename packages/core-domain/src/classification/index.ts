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

// Services
export { TransactionClassificationService } from './transaction-classification.service';
export {
  ClassificationRuleEngine,
  createDefaultRuleSet,
  createPostReformRuleSet,
  createBuiltInRuleSets,
  JOINT_LIABILITY_REFORM_FROM,
  CURRENT_RULE_SET_VERSION,
} from './services/classification-rule-engine.service';
export type { ClassificationEngineResult } from './services/classification-rule-engine.service';

// Types
export type {
  ClassificationInput,
  ClassificationResult,
  EvidenceDetail,
  ClassificationLabel,
  ConfidenceLevel,
} from './classification.types';

// Rule types
export type {
  ClassificationRule,
  ClassificationRuleSet,
} from './classification-rule.types';

// Repository port
export {
  CLASSIFICATION_RULE_REPOSITORY_PORT,
} from './ports/classification-rule-repository.port';
export type {
  IClassificationRuleRepositoryPort,
  ClassificationRuleSetRecord,
} from './ports/classification-rule-repository.port';