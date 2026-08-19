import { Injectable, Inject } from '@nestjs/common';
import {
  ITaxRuleRepositoryPort,
  TaxRuleRecordPort,
} from '../ports/tax-rule-repository.port';
import {
  AlcoholExciseCategory,
  calculateAlcoholExcise,
  normaliseCategory,
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

    // Try repository lookup
    const rule = await this.taxRepo.findApplicable(
      'excise',
      normalised,
      lookupDate,
    );

    if (rule) {
      return this.computeFromRule(rule, normalised, abv, volumeLitres);
    }

    // Fallback — no rule found
    return this.computeFallback(normalised, abv, volumeLitres);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private computeFromRule(
    rule: TaxRuleRecordPort,
    category: AlcoholExciseCategory,
    abv: number,
    volumeLitres: number,
  ): ExciseResult {
    const rateNumeric = parseDecimal(rule.rate);
    const { taxCents, rateApplied } = calculateAlcoholExcise(
      rule.calculationFormulaReference,
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