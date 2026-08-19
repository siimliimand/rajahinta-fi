import { Injectable, Inject } from '@nestjs/common';
import {
  ITaxRuleRepositoryPort,
  TaxRuleRecordPort,
  AbvTierConditions,
} from '../ports/tax-rule-repository.port';
import {
  AlcoholExciseCategory,
  calculateAlcoholExcise,
  normaliseCategory,
  resolveOtherFermentedFormula,
  DEFAULT_RATES,
} from './alcohol-excise.math';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ExciseResult {
  readonly category: string;
  readonly abv: number;
  readonly volumeLitres: number;
  readonly rateApplied: number;
  readonly taxCents: number;
  readonly taxDatasetVersion: string;
  readonly reliability: 'VERIFIED' | 'ESTIMATED';
  /** The tax-rule version ID that was applied, or null when falling back to defaults. */
  readonly ruleId: number | null;
}

// ---------------------------------------------------------------------------
// Injection token — allows the composition root to wire the adapter
// ---------------------------------------------------------------------------

export const TAX_RULE_REPOSITORY_PORT = 'TAX_RULE_REPOSITORY_PORT';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Alcohol Excise sub-engine.
 *
 * Calculates Finnish alcohol excise duty by looking up the applicable
 * tax rule from the repository and applying the correct formula based on
 * the rule's {@code calculationFormulaReference}.
 *
 * Looks up ALL active rules for the category and selects the one whose
 * ABV tier (from {@code exemptionConditions}) matches the product's ABV.
 * Exemption rules (rate "0.00") match ABV ≤ maxAlcoholByVolume and produce
 * zero tax.  Non-zero-rate rules with a maxAlcoholByVolume alone are tier
 * boundaries, not exemptions — the rate applies when ABV falls within the
 * tier.
 *
 * If no rule is found for the given date, falls back to hardcoded default
 * rates and returns {@code reliability: 'ESTIMATED'}.
 *
 * @module AlcoholExciseService
 */
@Injectable()
export class AlcoholExciseService {
  constructor(
    @Inject(TAX_RULE_REPOSITORY_PORT)
    private readonly taxRepo: ITaxRuleRepositoryPort,
  ) {}

  /**
   * Calculate excise duty for a beverage.
   *
   * @param category      Product category (beer, wine, spirits, cider, rtd, intermediate, other).
   * @param abv           Alcohol by volume as a decimal fraction (0–1, e.g. 0.40 for 40 %).
   * @param volumeLitres  Volume in litres.
   * @param asOf          Optional effective-date lookup (defaults to now).
   */
  async calculate(
    category: string,
    abv: number,
    volumeLitres: number,
    asOf?: Date,
  ): Promise<ExciseResult> {
    const lookupDate = asOf ?? new Date();
    const normalised = normaliseCategory(category);

    // Get ALL active rules for this category (multiple ABV tiers)
    const rules = await this.taxRepo.findAllApplicable(
      'excise',
      normalised,
      lookupDate,
    );

    if (rules.length > 0) {
      // Find the rule whose ABV tier matches the product's ABV
      const matchedRule = this.findMatchingRule(rules, abv);
      if (matchedRule) {
        return this.computeFromRule(matchedRule, normalised, abv, volumeLitres, category);
      }
      // No ABV tier matched — use the most recently effective rule
      return this.computeFromRule(rules[0], normalised, abv, volumeLitres, category);
    }

    // Fallback — no rule found
    return this.computeFallback(normalised, abv, volumeLitres);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Select the rule whose ABV tier matches the product's ABV.
   *
   * ABV tiers are defined by {@code exemptionConditions}:
   * - `maxAlcoholByVolume` alone (no `minAlcoholByVolume`):
   *   exemption tier — ABV ≤ threshold.  Exemption is only applied when
   *   the rule's rate is "0.00" (see {@link isExempt}).
   * - `minAlcoholByVolume` alone: ABV ≥ threshold.
   * - Both: ABV within [min, max].
   * - Neither: catch-all (no ABV constraints).
   *
   * @param rules  All active rules for the category, ordered by effectiveFrom desc.
   * @param abv    Product ABV as a decimal fraction (0–1).
   * @returns The matching rule, or null if none match.
   */
  private findMatchingRule(
    rules: TaxRuleRecordPort[],
    abv: number,
  ): TaxRuleRecordPort | null {
    // Convert decimal ABV (0–1) to percentage (0–100) for comparison with
    // seed data, which stores ABV values as percentages.
    const abvPct = abv * 100;

    for (const rule of rules) {
      const cond = rule.exemptionConditions;
      if (!cond) {
        // No tier constraints — this rule matches any ABV
        return rule;
      }

      if (this.matchesTier(cond, abvPct)) {
        return rule;
      }
    }

    return null;
  }

  /**
   * Check whether a product with the given ABV (in percentage) falls within
   * the tier defined by {@code conditions}.
   */
  private matchesTier(
    conditions: AbvTierConditions,
    abvPct: number,
  ): boolean {
    const { minAlcoholByVolume: min, maxAlcoholByVolume: max } = conditions;

    if (min !== undefined && max !== undefined) {
      return abvPct >= min && abvPct <= max;
    }
    if (min !== undefined) {
      return abvPct >= min;
    }
    if (max !== undefined) {
      return abvPct <= max;
    }
    // Empty conditions — treat as catch-all
    return true;
  }

  /**
   * Determine whether the product is exempt from excise duty based on the
   * rule's rate and exemption conditions.
   *
   * A rule is exempt ONLY when its rate is "0.00" AND the ABV falls within
   * the exemption threshold (maxAlcoholByVolume alone, no minAlcoholByVolume).
   *
   * Rules with non-zero rates are never exempt — their `maxAlcoholByVolume`
   * is a tier boundary, not an exemption threshold.
   */
  private isExempt(rule: TaxRuleRecordPort, abvPct: number): boolean {
    // Only zero-rate rules can be exemption rules
    if (rule.rate !== '0.00') return false;

    const cond = rule.exemptionConditions;
    if (!cond) return false;

    // Exemption is indicated by maxAlcoholByVolume alone (no minAlcoholByVolume)
    if (cond.maxAlcoholByVolume !== undefined && cond.minAlcoholByVolume === undefined) {
      return abvPct <= cond.maxAlcoholByVolume;
    }

    return false;
  }

  private computeFromRule(
    rule: TaxRuleRecordPort,
    category: AlcoholExciseCategory,
    abv: number,
    volumeLitres: number,
    originalCategory?: string,
  ): ExciseResult {
    const abvPct = abv * 100;

    // Check exemption first — if the product's ABV is below the exemption
    // threshold, the rate is zero.
    if (this.isExempt(rule, abvPct)) {
      const reliability: 'VERIFIED' | 'ESTIMATED' =
        rule.verificationDate !== null ? 'VERIFIED' : 'ESTIMATED';

      return {
        category,
        abv,
        volumeLitres,
        rateApplied: 0,
        taxCents: 0,
        taxDatasetVersion: rule.versionLabel,
        reliability,
        ruleId: rule.id,
      };
    }

    // Resolve formula — for other_fermented, the formula depends on whether
    // the original product is cider (per-litre-of-product) or RTD (per-litre-of-alcohol).
    const formulaRef =
      category === 'other_fermented' && originalCategory
        ? resolveOtherFermentedFormula(originalCategory)
        : rule.calculationFormulaReference;

    const rateNumeric = parseDecimal(rule.rate);
    const { taxCents, rateApplied } = calculateAlcoholExcise(
      formulaRef,
      rateNumeric,
      abv,
      volumeLitres,
      category,
    );

    const reliability: 'VERIFIED' | 'ESTIMATED' =
      rule.verificationDate !== null ? 'VERIFIED' : 'ESTIMATED';

    return {
      category,
      abv,
      volumeLitres,
      rateApplied,
      taxCents,
      taxDatasetVersion: rule.versionLabel,
      reliability,
      ruleId: rule.id,
    };
  }

  private computeFallback(
    category: AlcoholExciseCategory,
    abv: number,
    volumeLitres: number,
  ): ExciseResult {
    const defaults = DEFAULT_RATES[category] ?? DEFAULT_RATES.other_fermented;
    const { taxCents, rateApplied } = calculateAlcoholExcise(
      defaults.formula,
      defaults.rate,
      abv,
      volumeLitres,
      category,
    );

    return {
      category,
      abv,
      volumeLitres,
      rateApplied,
      taxCents,
      taxDatasetVersion: 'FALLBACK',
      reliability: 'ESTIMATED',
      ruleId: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDecimal(value: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new TypeError(`Cannot parse tax rate as decimal: "${value}"`);
  }
  return n;
}