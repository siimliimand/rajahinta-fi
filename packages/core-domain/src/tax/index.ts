/**
 * /tax barrel — public exports for the tax subdomain.
 *
 * Consumers import from `@rajahinta/core-domain/tax` (or from the top-level
 * index when the module is re-exported).
 *
 * @module TaxIndex
 */

// Ports
export type { ITaxRuleRepositoryPort, TaxRuleRecordPort } from './ports/tax-rule-repository.port';
export { TAX_RULE_REPOSITORY_PORT } from './services/alcohol-excise.service';

// Services
export { AlcoholExciseService } from './services/alcohol-excise.service';
export type { ExciseResult } from './services/alcohol-excise.service';

export { ContainerDutyService } from './services/container-duty.service';
export type { ContainerDutyResult } from './services/container-duty.service';

export { TaxRuleQueryService } from './services/tax-rule-query.service';
export type { RateHistoryEntry } from './services/tax-rule-query.service';

// Pure math (exported for testing / direct use)
export {
  calculateAlcoholExcise,
  calcPerLitreOfProduct,
  calcPerLitreOfAlcohol,
  calcProgressiveAbv,
  normaliseCategory,
  FORMULA_PER_LITRE_OF_PRODUCT,
  FORMULA_PER_LITRE_OF_ALCOHOL,
  FORMULA_PROGRESSIVE_ABV,
  DEFAULT_RATES,
  DEFAULT_BEER_TIERS,
} from './services/alcohol-excise.math';

export {
  calculateContainerDuty,
  calcContainerDuty,
  isStandardPackaging,
  normalisePackaging,
  FORMULA_FLAT_PER_LITRE,
  DEFAULT_CONTAINER_DUTY_RATE,
} from './services/container-duty.math';

// Deposit-return system exemption
export { checkDepositExemption } from './services/deposit-checker';
export type { DepositCheckResult } from './services/deposit-checker';

// Module
export { TaxModule } from './tax.module';
export type { AlcoholExciseCategory } from './services/alcohol-excise.math';