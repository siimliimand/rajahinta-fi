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
import {
  checkDepositExemption,
  type DepositCheckResult,
} from './deposit-checker';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ContainerDutyResult {
  readonly volumeLitres: number;
  readonly ratePerLitre: number;
  readonly dutyCents: number;
  readonly taxDatasetVersion: string;
  readonly reliability: 'VERIFIED' | 'ESTIMATED';
  /** Details on the deposit-return system exemption decision. */
  readonly depositExemption?: DepositCheckResult;
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
   * Packaging that participates in the Finnish deposit-return system
   * (depositSystemStatus === true) is **exempted** from container duty.
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
     * @param volumeLitres          Container volume in litres.
     * @param packaging             Packaging type string (e.g. "glass", "plastic", "keg").
     * @param depositSystemStatus   Optional. `true` if packaging participates in
     *                              the Finnish deposit-return system, `false` if not,
     *                              `null` (or omitted) if unknown.  When omitted,
     *                              defaults to `null`, which triggers ESTIMATED status.
     * @param asOf                  Optional effective-date lookup (defaults to now).
     *                              Historical dates resolve against the rate version
     *                              effective on that date.
     */
    async calculate(
      volumeLitres: number,
      packaging: string,
      depositSystemStatus: boolean | null = null,
      asOf?: Date,
    ): Promise<ContainerDutyResult> {
      // Evaluate deposit-return exemption first (pure function)
      const depositCheck = checkDepositExemption(depositSystemStatus);

      // If exempted, short-circuit with zero duty
      if (depositCheck.exempted) {
        return {
          volumeLitres,
          ratePerLitre: 0,
          dutyCents: 0,
          taxDatasetVersion: 'EXEMPTED',
          reliability: depositCheck.reliability,
          depositExemption: depositCheck,
        };
      }

      const normalised = normalisePackaging(packaging);
      const lookupDate = asOf ?? new Date();

      // Try repository lookup
      const rule = await this.taxRepo.findApplicable(
        'container_duty',
        normalised,
        lookupDate,
      );

      if (rule) {
        return this.computeFromRule(rule, volumeLitres, normalised, depositCheck);
      }

      // Fallback
      return this.computeFallback(volumeLitres, normalised, depositCheck);
    }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private computeFromRule(
    rule: TaxRuleRecordPort,
    volumeLitres: number,
    _packaging: string,
    depositCheck: DepositCheckResult,
  ): ContainerDutyResult {
    const rateNumeric = parseDecimal(rule.rate);
    const { dutyCents, rateApplied } = calculateContainerDuty(
      rateNumeric,
      volumeLitres,
    );

    // Overall reliability is the stricter of rule reliability and deposit reliability
    const reliability: 'VERIFIED' | 'ESTIMATED' =
      rule.verificationDate !== null && depositCheck.reliability === 'VERIFIED'
        ? 'VERIFIED'
        : 'ESTIMATED';

    return {
      volumeLitres,
      ratePerLitre: rateApplied,
      dutyCents,
      taxDatasetVersion: rule.versionLabel,
      reliability,
      depositExemption: depositCheck,
    };
  }

  private computeFallback(
    volumeLitres: number,
    _packaging: string,
    depositCheck: DepositCheckResult,
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
      depositExemption: depositCheck,
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