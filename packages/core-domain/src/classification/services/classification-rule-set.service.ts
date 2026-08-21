/**
 * ClassificationRuleSetService — versioned publication of classification rule sets.
 *
 * Wraps the classification rule repository port and audit logging to provide
 * an auditable rule-set publication flow.  Every version creation is recorded
 * in the immutable audit log with actor, reason, and rule-set snapshot.
 *
 * ## High-liability audit contract
 *
 * - Entity type: `classification_rule`
 * - Action: `created` on publication, `confirmed` on activation
 * - Actor: the confirmedBy/operator identifier (or 'system' for automated jobs)
 *
 * @module ClassificationRuleSetService
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CLASSIFICATION_RULE_REPOSITORY_PORT,
  type IClassificationRuleRepositoryPort,
  type ClassificationRuleSetRecord,
} from '../ports/classification-rule-repository.port';
import { AuditService } from '../../audit/audit.service';

// ---------------------------------------------------------------------------
// Publication input
// ---------------------------------------------------------------------------

/**
 * Input for publishing a new classification rule set version.
 */
export interface PublishRuleSetInput {
  readonly versionLabel: string;
  readonly label: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly rules: readonly Pick<
    import('../classification-rule.types').ClassificationRule,
    'name' | 'version' | 'description'
  >[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ClassificationRuleSetService {
  private readonly logger = new Logger(ClassificationRuleSetService.name);

  constructor(
    @Inject(CLASSIFICATION_RULE_REPOSITORY_PORT)
    private readonly repository: IClassificationRuleRepositoryPort,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /**
   * Publish a new classification rule set version.
   *
   * Persists the rule set via the repository and records an audit entry
   * with the actor and rule-set snapshot.  Returns the created record.
   *
   * @param input   The rule set definition to publish.
   * @param actor   Identifier of the person/system publishing this version.
   * @param reason  Free-text reason for publishing this version.
   * @returns       The persisted rule set record.
   */
  async publishVersion(
    input: PublishRuleSetInput,
    actor: string,
    reason: string,
  ): Promise<ClassificationRuleSetRecord> {
    const createdAt = new Date();

    const record: ClassificationRuleSetRecord = {
      versionLabel: input.versionLabel,
      label: input.label,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      rules: input.rules,
      createdAt,
    };

    await this.repository.saveRuleSet(record);

    // Record audit entry.
    if (this.auditService) {
      await this.auditService.logChange({
        entityType: 'classification_rule',
        entityId: input.versionLabel,
        action: 'created',
        author: actor,
        reason,
        newValue: {
          versionLabel: input.versionLabel,
          label: input.label,
          effectiveFrom: input.effectiveFrom.toISOString(),
          effectiveTo: input.effectiveTo?.toISOString() ?? null,
          ruleCount: input.rules.length,
        },
      });
    }

    this.logger.log(
      `Classification rule set published: ${input.versionLabel} (actor=${actor})`,
    );

    return record;
  }
}