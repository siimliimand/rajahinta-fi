/**
 * Classification Module.
 *
 * Aggregates TransactionClassificationService and ClassificationRuleEngine.
 *
 * The rule engine is registered as a provider but not exported by default —
 * individual consumers can inject it when they need versioned rule loading.
 * The TransactionClassificationService is the primary public API.
 *
 * ## Wiring the rule repository
 *
 * To enable database-backed rule sets, provide an implementation of
 * {@link IClassificationRuleRepositoryPort} using the
 * {@link CLASSIFICATION_RULE_REPOSITORY_PORT} token:
 *
 * ```typescript
 * {
 *   provide: CLASSIFICATION_RULE_REPOSITORY_PORT,
 *   useClass: MyRuleRepositoryAdapter,
 * }
 * ```
 *
 * When no repository is wired, the rule engine falls back to built-in rules.
 *
 * @module ClassificationModule
 */
import { Module } from '@nestjs/common';
import { TransportEstimationModule } from '../transport/transport-estimation.module';
import { TransactionClassificationService } from './transaction-classification.service';
import { ClassificationRuleEngine } from './services/classification-rule-engine.service';
import { CLASSIFICATION_RULE_REPOSITORY_PORT } from './ports/classification-rule-repository.port';

@Module({
  imports: [TransportEstimationModule],
  providers: [
    TransactionClassificationService,
    ClassificationRuleEngine,
    { provide: CLASSIFICATION_RULE_REPOSITORY_PORT, useValue: null },
  ],
  exports: [TransactionClassificationService, ClassificationRuleEngine],
})
export class ClassificationModule {}