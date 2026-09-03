/**
 * Classification Rule Engine.
 *
 * Loads versioned rule sets by effective date and applies them in priority
 * order.  Ships built-in rule sets for the pre- and post-reform Finnish
 * legislation (the 1 September 2024 joint-liability reform, HE 45/2024 vp /
 * Act 432/2024, Excise Taxation Act 182/2010), and a mechanism to override
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
 * Create the built-in v1.0 rule set — Finnish legislation **before** the
 * 1 September 2024 joint-liability reform (HE 45/2024 vp / Act 432/2024,
 * Excise Taxation Act 182/2010).
 *
 * Kept as a complete, self-contained historical artifact: past calculations
 * must resolve under the rules effective on their calculation date. Its
 * window is closed; the reform rule set takes over on 2024-09-01.
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
    label: 'Finnish legislation — pre-1 Sep 2024 joint-liability reform',
    effectiveFrom: new Date('2024-01-01'),
    // Inclusive end (ClassificationRuleSet.effectiveTo): the reform rule set
    // becomes effective 1 Sep 2024. End-of-day so any same-day timestamp
    // resolves inside the correct window.
    effectiveTo: new Date('2024-08-31T23:59:59.999Z'),
  };
}

// ---------------------------------------------------------------------------
// Post-reform rule set — v2.0-2026.1
// ---------------------------------------------------------------------------

/** Date the 1 Sep 2024 joint-liability reform rule set becomes effective. */
export const JOINT_LIABILITY_REFORM_FROM = new Date('2024-09-01T00:00:00.000Z');

/** Version label of the currently effective built-in rule set. */
export const CURRENT_RULE_SET_VERSION = '2.0-2026.1';

/**
 * Create the built-in v2.0-2026.1 rule set — Finnish legislation **from** the
 * 1 September 2024 joint-liability reform (HE 45/2024 vp / Act 432/2024,
 * Excise Taxation Act 182/2010).
 *
 * The classification taxonomy is unchanged from v1.0 (Distance Selling /
 * Distance Buying / Traveller Import); what changed is the statutory
 * obligation attached to each outcome:
 *
 * - Distance Selling — the **seller** files the advance notice and pays the
 *   duties, but the Finnish **buyer is jointly liable** when the seller
 *   neglects those duties.
 * - Distance Buying — the **buyer must file an advance notice and lodge a
 *   guarantee** before dispatch; unnotified goods risk seizure by Customs.
 * - Traveller Import — **no advance notice** within personal-use allowances.
 *
 * The evaluation bodies duplicate v1.0 deliberately: each rule set stays a
 * complete, self-contained historical artifact (append-only versioning —
 * never edit a published set in place).
 */
export function createPostReformRuleSet(): ClassificationRuleSet {
  const rules: ClassificationRule[] = [
    {
      name: 'TravellerImport',
      version: '2.0',
      description:
        'Buyer physically carries goods across the border within ' +
        'personal-use allowances. No advance notice required; duty-free ' +
        'traveller allowances apply on entry (Alcohol Act 1102/2017, ' +
        'chapter 5).',
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
      version: '2.0',
      description:
        'Seller arranges transport to Finland and is responsible for the ' +
        'advance notice and the duty payment before dispatch. From ' +
        '1 Sep 2024 the Finnish buyer is jointly liable if the seller ' +
        'neglects to file the advance notice, submit the transport ' +
        'identifier, or pay the duties (Excise Taxation Act 182/2010 as ' +
        'amended by Act 432/2024).',
      evaluate(input: ClassificationInput): ClassificationResult | null {
        // We only get here if buyerIsTravelling is false.
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
      version: '2.0',
      description:
        'Buyer arranges independent transport via an identified carrier. ' +
        'The buyer is solely liable for excise and container duty and must ' +
        'file an advance notice and lodge a guarantee with the Tax ' +
        'Administration before dispatch; unnotified goods risk seizure by ' +
        'Customs.',
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
      version: '2.0',
      description:
        'Transport arrangement could not be determined. Defaults to distance ' +
        'buying with LOW confidence — the buyer must verify their duty ' +
        'liability and advance-notice obligation before dispatch.',
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
    version: CURRENT_RULE_SET_VERSION,
    label:
      'Finnish legislation — post-1 Sep 2024 joint-liability reform ' +
      '(Excise Taxation Act 182/2010 as amended by Act 432/2024)',
    effectiveFrom: JOINT_LIABILITY_REFORM_FROM,
    effectiveTo: null,
  };
}

// ---------------------------------------------------------------------------
// Built-in rule-set registry — effective-date selection
// ---------------------------------------------------------------------------

/**
 * All built-in rule sets, ordered by effective date. Selection picks the set
 * whose window contains the requested date; the last set is the fallback.
 */
export function createBuiltInRuleSets(): ClassificationRuleSet[] {
  return [createDefaultRuleSet(), createPostReformRuleSet()];
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

  /**
   * Built-in rule sets, ordered by effective date — used when no repository
   * is wired, and as the fallback when the repository has no set for a date.
   */
  private readonly builtInRuleSets: ClassificationRuleSet[] =
    createBuiltInRuleSets();

  constructor(
    @Inject(CLASSIFICATION_RULE_REPOSITORY_PORT)
    private readonly repository?: IClassificationRuleRepositoryPort,
  ) {}

  /**
   * Select the built-in rule set effective on the given date.
   *
   * A set matches when `effectiveFrom <= date` and either `effectiveTo` is
   * null or `date <= effectiveTo` (inclusive end). Returns the newest set
   * when no window matches (defensive — the built-in windows cover 2024-01-01
   * onward with no gap).
   */
  private selectBuiltInRuleSet(date: Date): ClassificationRuleSet {
    for (const set of this.builtInRuleSets) {
      if (
        set.effectiveFrom.getTime() <= date.getTime() &&
        (set.effectiveTo === null || date.getTime() <= set.effectiveTo.getTime())
      ) {
        return set;
      }
    }
    return this.builtInRuleSets[this.builtInRuleSets.length - 1];
  }

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
            'falling back to the built-in set for that date.',
        );
        ruleSet = this.selectBuiltInRuleSet(effectiveDate);
      }
    } else {
      ruleSet = this.selectBuiltInRuleSet(effectiveDate);
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
   * Uses the built-in rule set effective on `asOf` (defaults to now).
   * Throws if no rule matches.
   */
  classifySync(
    input: ClassificationInput,
    asOf?: Date,
  ): ClassificationEngineResult {
    const ruleSet = this.selectBuiltInRuleSet(asOf ?? new Date());

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
   * Descriptors are resolved against the built-in registry keyed by
   * `${versionLabel}/${ruleName}`, so a stored v1.0 record resolves under
   * v1.0 semantics and a v2.0-2026.1 record under reform semantics. Records
   * with an unknown version label fall back to name lookup against the
   * currently effective set (with a warning) — never silently misversioned
   * evaluation. This keeps the database schema lean — rules are stored as a
   * JSON array of { name, version, description } triples, and the actual
   * evaluation logic lives in TypeScript.
   */
  private mapToRuleSet(
    record: import('../ports/classification-rule-repository.port').ClassificationRuleSetRecord,
  ): ClassificationRuleSet {
    const registry = new Map<string, ClassificationRule>();
    for (const set of this.builtInRuleSets) {
      for (const rule of set.rules) {
        registry.set(`${set.version}/${rule.name}`, rule);
      }
    }
    const currentSet = this.selectBuiltInRuleSet(new Date());

    const resolved: ClassificationRule[] = [];
    for (const descriptor of record.rules) {
      const rule =
        registry.get(`${record.versionLabel}/${descriptor.name}`) ??
        currentSet.rules.find((r) => r.name === descriptor.name);
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