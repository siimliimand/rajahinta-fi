/**
 * TaxRuleQueryService — query historical rate versions.
 *
 * Past calculations must always resolve against the rate version effective
 * on the relevant date.  This service returns all applicable rules in a
 * date range for audit-trail display, corrections, and confidence analysis.
 *
 * @module TaxRuleQueryService
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  ITaxRuleRepositoryPort,
  TaxRuleRecordPort,
} from '../ports/tax-rule-repository.port';
import { TAX_RULE_REPOSITORY_PORT } from './alcohol-excise.service';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * A single entry in the rate history for a given (taxType, productCategory).
 *
 * The {@code isCurrent} flag is a convenience: it is {@code true} when
 * {@code effectiveTo} is {@code null} (i.e. the rate is still active).
 */
export interface RateHistoryEntry {
  readonly versionLabel: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly rate: string;
  readonly source: string;
  readonly verificationDate: Date | null;
  readonly isCurrent: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class TaxRuleQueryService {
  constructor(
    @Inject(TAX_RULE_REPOSITORY_PORT)
    private readonly taxRepo: ITaxRuleRepositoryPort,
  ) {}

  /**
   * Return all tax rules for the given type and category whose effectiveness
   * window overlaps {@code [fromDate, toDate)}.
   *
   * @param taxType         "excise" (alcohol excise) or "container_duty".
   * @param productCategory Product category (beer, wine, spirits, glass, etc.).
   * @param fromDate        Start of query range (inclusive).
   * @param toDate          End of query range (exclusive).
   */
  async getRateHistory(
    taxType: string,
    productCategory: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<RateHistoryEntry[]> {
    const rules = await this.taxRepo.findHistoryRates(
      taxType,
      productCategory,
      fromDate,
      toDate,
    );

    return rules.map(toRateHistoryEntry);
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toRateHistoryEntry(rule: TaxRuleRecordPort): RateHistoryEntry {
  return {
    versionLabel: rule.versionLabel,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    rate: rule.rate,
    source: rule.officialSource,
    verificationDate: rule.verificationDate,
    isCurrent: rule.effectiveTo === null,
  };
}