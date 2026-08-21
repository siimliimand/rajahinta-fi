/**
 * Classification Rule Engine.
 *
 * Loads versioned rule sets by effective date and applies them in priority
 * order.  Provides a default hardcoded rule set reflecting current Finnish
 * legislation (pre-September 2024) for Phase 1, and a mechanism to override
 * via the repository port when database-backed versioning is available.
 *
 * ## Architecture
 *
 * - The engine is **independent** of TransactionClassificationService — the
 *   service *can* delegate to it, but the engine is a standalone domain
 *   service that any consumer can use.
 * - Rule evaluation functions live in the domain (not in the database).
 *   The repository stores only descriptors (name, version, description);
 *   the engine maps descriptors to actual evaluate() implementations via
 *   a rule registry.
 * - Date-based matching: the engine selects the rule set whose
 *   `effectiveFrom <= asOf <= effectiveTo` (or `effectiveTo IS NULL`).
 *
 * @module ClassificationRuleEngine
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CLASSIFICATION_RULE_REPOSITORY_PORT,
  type IClassificationRuleRepositoryPort,
} from '../ports/classification-rule-repository.port';
import type {
  ClassificationInput,
  ClassificationResult,
  ConfidenceLevel,
  EvidenceDetail,
} from '../classification.types';
import { buildEvidenceSummary } from '../evidence.utils';
import type { ClassificationRule, ClassificationRuleSet } from '../classification-rule.types';

// ---------------------------------------------------------------------------
// Rule registry — maps descriptor names to evaluation functions
// ---------------------------------------------------------------------------

/**
 * Create the built-in rule set reflecting current Finnish legislation
 * (pre-September 2024 joint-liability change).
 *
 * These rules are evaluated in priority order.  The first matching rule
 * wins, so the most specific rule must come first.
 */
export function createDefaultRuleSet(): ClassificationRuleSet {
  const rules: ClassificationRule[] = [
    {
      name: 'TravellerImport',
      version: '1.0',
      description:
        'Buyer physically carries goods across the border. ' +
        'Excluded from landed-cost calculation; duty-free allowances apply ' +
        '(Alcohol Act 1102/2017, chapter 5).',
      evaluate(input: ClassificationInput): ClassificationResult | null {
        if (input.buyerIsTravelling) {
          const evidence: EvidenceDetail[] = [
            {
              observation: 'Buyer indicated they are physically carrying goods across the border',
              supportingData: `destination: ${input.sellerCountry}, buyer country: ${input.buyerCountry}`,
              source: 'buyerIsTravelling',
            },
            {
              observation: 'Personal import allowance applies — excluded from landed-cost calculator',
              supportingData: 'transport arrangement: personal transport',
              source: 'buyerIsTravelling',
            },
          ];
          return {
            classification: 'TravellerImport',
            confidence: 'HIGH',
            evidence,
            evidenceSummary: buildEvidenceSummary(evidence),
          };
        }
        return null;
      },
    },
    {
      name: 'DistanceSelling',
      version: '1.0',
      description:
        'Seller arranges transport to Finland and is liable for Finnish ' +
        'excise duties (EU distance-selling rules, Alcohol Act 1102/2017 ' +
        'section 43).',
      evaluate(input: ClassificationInput): ClassificationResult | null {
        // We only get here if buyerIsTravelling is false.
        // The transport classification service tells us the arrangement.
        // But here we need the transport type — use the service.
        // However, the rule function shouldn't depend on another service.
        // Let's use sellerInvolvementIndicator directly.
        if (input.sellerInvolvementIndicator) {
          const carrierLabel = input.carrierId && input.carrierId.trim().length > 0
            ? `carrier: ${input.carrierId}`
            : 'carrier information not available';
          const evidence: EvidenceDetail[] = [
            {
              observation: 'Retailer offers direct delivery to buyer\'s country',
              supportingData: `seller country: ${input.sellerCountry}, buyer country: ${input.buyerCountry}, ${carrierLabel}`,
              source: 'sellerInvolvementIndicator',
            },
          ];
          return {
            classification: 'DistanceSelling',
            confidence: 'HIGH',
            evidence,
            evidenceSummary: buildEvidenceSummary(evidence),
          };
        }
        return null;
      },
    },
    {
      name: 'DistanceBuyingKnownCarrier',
      version: '1.0',
      description:
        'Buyer arranges independent transport via an identified carrier. ' +
        'Buyer is liable for excise duties upon import (Tax Administration ' +
        'guidance VH/5088/00.01.00/2021).',
      evaluate(input: ClassificationInput): ClassificationResult | null {
        if (
          !input.sellerInvolvementIndicator &&
          input.carrierId &&
          input.carrierId.trim().length > 0
        ) {
          const confidence: ConfidenceLevel =
            input.sellerId && input.sellerId.trim().length > 0
              ? 'HIGH'
              : 'MEDIUM';

          const evidence: EvidenceDetail[] = [
            {
              observation: 'Buyer arranged transport via independent carrier',
              supportingData: `carrier: ${input.carrierId}`,
              source: 'carrierId',
            },
            {
              observation: 'Seller did not arrange transport',
              supportingData: `seller country: ${input.sellerCountry}, buyer country: ${input.buyerCountry}`,
              source: 'sellerInvolvementIndicator',
            },
          ];

          // When the seller is known, add a confirmation piece of evidence
          if (confidence === 'HIGH') {
            evidence.push({
              observation: 'Seller identity confirmed',
              supportingData: `seller: ${input.sellerId}`,
              source: 'sellerId',
            });
          } else {
            evidence.push({
              observation: 'Seller identity is unverified, reducing confidence',
              supportingData: 'no seller identifier provided',
              source: 'sellerId',
            });
          }

          return {
            classification: 'DistanceBuying',
            confidence,
            evidence,
            evidenceSummary: buildEvidenceSummary(evidence),
          };
        }
        return null;
      },
    },
    {
      name: 'DistanceBuyingUnknownTransport',
      version: '1.0',
      description:
        'Transport arrangement could not be determined. Defaults to distance ' +
        'buying with LOW confidence — buyer should verify their duty liability.',
      evaluate(input: ClassificationInput): ClassificationResult | null {
        const evidence: EvidenceDetail[] = [
          {
            observation: 'Transport arrangement could not be determined',
            supportingData: `seller country: ${input.sellerCountry}, buyer country: ${input.buyerCountry}, no carrier identified, seller not involved in shipping`,
            source: 'TransportClassification',
          },
        ];
        return {
          classification: 'DistanceBuying',
          confidence: 'LOW',
          evidence,
          evidenceSummary: buildEvidenceSummary(evidence),
        };
      },
    },
  ];

  return {
    rules,
    version: '1.0',
    label: 'Current Finnish legislation — pre-Sep 2024',
    effectiveFrom: new Date('2024-01-01'),
    effectiveTo: null,
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface ClassificationEngineResult {
  readonly result: ClassificationResult;
  readonly ruleSet: Pick<ClassificationRuleSet, 'version' | 'label' | 'effectiveFrom' | 'effectiveTo'>;
  readonly ruleName: string;
}

@Injectable()
export class ClassificationRuleEngine {
  private readonly logger = new Logger(ClassificationRuleEngine.name);

  /** Built-in default rule set — used when no repository is wired. */
  private readonly defaultRuleSet: ClassificationRuleSet = createDefaultRuleSet();

  constructor(
    @Inject(CLASSIFICATION_RULE_REPOSITORY_PORT)
    private readonly repository?: IClassificationRuleRepositoryPort,
  ) {}

  /**
   * Classify a transaction using the rule set effective on the given date.
   *
   * When a repository is wired, the engine loads the rule set for the given
   * date from the database.  Otherwise it falls back to the built-in default.
   *
   * @param input — The transaction details.
   * @param asOf  — The effective date for rule selection (defaults to now).
   * @returns     The classification result plus the rule set metadata.
   */
  async classify(
    input: ClassificationInput,
    asOf?: Date,
  ): Promise<ClassificationEngineResult> {
    const effectiveDate = asOf ?? new Date();

    // Load the rule set
    let ruleSet: ClassificationRuleSet;

    if (this.repository) {
      const record = await this.repository.findEffective(effectiveDate);
      if (record) {
        // Map descriptors to actual rule implementations
        ruleSet = this.mapToRuleSet(record);
      } else {
        this.logger.warn(
          `No rule set found effective ${effectiveDate.toISOString()}, ` +
            'falling back to default.',
        );
        ruleSet = this.defaultRuleSet;
      }
    } else {
      ruleSet = this.defaultRuleSet;
    }

    // Evaluate in priority order
    for (const rule of ruleSet.rules) {
      const result = rule.evaluate(input);
      if (result !== null) {
        return {
          result,
          ruleSet: {
            version: ruleSet.version,
            label: ruleSet.label,
            effectiveFrom: ruleSet.effectiveFrom,
            effectiveTo: ruleSet.effectiveTo,
          },
          ruleName: rule.name,
        };
      }
    }

    // Safety net — every default rule set includes a catch-all rule,
    // so this should never be reached.
    throw new Error(
      `No classification rule matched input for effective date ${effectiveDate.toISOString()}`,
    );
  }

  /**
   * Synchronous classify for use when async is not needed (e.g. in-memory).
   *
   * Uses the default rule set only.  Throws if no rule matches.
   */
  classifySync(input: ClassificationInput): ClassificationEngineResult {
    const ruleSet = this.defaultRuleSet;

    for (const rule of ruleSet.rules) {
      const result = rule.evaluate(input);
      if (result !== null) {
        return {
          result,
          ruleSet: {
            version: ruleSet.version,
            label: ruleSet.label,
            effectiveFrom: ruleSet.effectiveFrom,
            effectiveTo: ruleSet.effectiveTo,
          },
          ruleName: rule.name,
        };
      }
    }

    throw new Error('No classification rule matched the given input');
  }

  /**
   * Map a repository record (descriptors) to a full rule set with evaluation
   * functions.
   *
   * The mapping is done by name lookup against the built-in rule registry.
   * This keeps the database schema lean — rules are stored as a JSON array
   * of { name, version, description } triples, and the actual evaluation
   * logic lives in TypeScript.
   */
  private mapToRuleSet(
    record: import('../ports/classification-rule-repository.port').ClassificationRuleSetRecord,
  ): ClassificationRuleSet {
    const allRules = this.defaultRuleSet.rules;
    const registry = new Map<string, ClassificationRule>();
    for (const rule of allRules) {
      registry.set(rule.name, rule);
    }

    const resolved: ClassificationRule[] = [];
    for (const descriptor of record.rules) {
      const rule = registry.get(descriptor.name);
      if (rule) {
        resolved.push({ ...rule, version: descriptor.version });
      } else {
        this.logger.warn(
          `Rule "${descriptor.name}" (v${descriptor.version}) not found ` +
            'in registry — skipping.',
        );
      }
    }

    return {
      rules: resolved,
      version: record.versionLabel,
      label: record.label,
      effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo,
    };
  }
}