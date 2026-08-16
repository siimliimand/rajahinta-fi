import { Injectable, Inject } from '@nestjs/common';
import {
  ITaxRuleRepositoryPort,
  TaxRuleRecordPort,
} from '../ports/tax-rule-repository.port';
import {
  calculateContainerDuty,
  normalisePackaging,
  DEFAULT_CONTAINER_DUTY_RATE,
} from './container-duty.math';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ContainerDutyResult {
  readonly volumeLitres: number;
  readonly ratePerLitre: number;
  readonly dutyCents: number;
  readonly taxDatasetVersion: string;
  readonly reliability: 'VERIFIED' | 'ESTIMATED';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Beverage-Container Duty sub-engine.
 *
 * Calculates Finnish container duty (pantillinen vero) based on volume and
 * packaging type.  The general rate is €0.51 per litre for standard containers
 * (glass, plastic, metal, carton).  Non-standard packaging (keg, bulk) is
 * flagged as ESTIMATED.
 *
 * @module ContainerDutyService
 */
@Injectable()
export class ContainerDutyService {
  constructor(
    @Inject('TAX_RULE_REPOSITORY_PORT')
    private readonly taxRepo: ITaxRuleRepositoryPort,
  ) {}

  /**
   * Calculate container duty for a beverage.
   *
   * @param volumeLitres  Container volume in litres.
   * @param packaging     Packaging type string (e.g. "glass", "plastic", "keg").
   */
  async calculate(
    volumeLitres: number,
    packaging: string,
  ): Promise<ContainerDutyResult> {
    const normalised = normalisePackaging(packaging);

    // Try repository lookup
    const rule = await this.taxRepo.findApplicable(
      'container_duty',
      normalised,
      new Date(),
    );

    if (rule) {
      return this.computeFromRule(rule, volumeLitres, normalised);
    }

    // Fallback
    return this.computeFallback(volumeLitres, normalised);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private computeFromRule(
    rule: TaxRuleRecordPort,
    volumeLitres: number,
    _packaging: string,
  ): ContainerDutyResult {
    const rateNumeric = parseDecimal(rule.rate);
    const { dutyCents, rateApplied } = calculateContainerDuty(
      rateNumeric,
      volumeLitres,
    );

    const reliability: 'VERIFIED' | 'ESTIMATED' =
      rule.verificationDate !== null ? 'VERIFIED' : 'ESTIMATED';

    return {
      volumeLitres,
      ratePerLitre: rateApplied,
      dutyCents,
      taxDatasetVersion: rule.versionLabel,
      reliability,
    };
  }

  private computeFallback(
    volumeLitres: number,
    _packaging: string,
  ): ContainerDutyResult {
    const { dutyCents, rateApplied } = calculateContainerDuty(
      DEFAULT_CONTAINER_DUTY_RATE,
      volumeLitres,
    );

    return {
      volumeLitres,
      ratePerLitre: rateApplied,
      dutyCents,
      taxDatasetVersion: 'FALLBACK',
      reliability: 'ESTIMATED', // no verified rule → always ESTIMATED
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