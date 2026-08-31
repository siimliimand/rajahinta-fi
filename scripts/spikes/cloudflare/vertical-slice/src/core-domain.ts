/**
 * G3 vertical slice spike — core-domain bridge.
 *
 * Imports the production calculator engines directly from the
 * packages/core-domain TypeScript sources (read-only; no workspace
 * install, no dist build). This is the spike's central claim under test:
 * the pure-TS domain layer ports to a Worker unmodified.
 *
 * Only the calculator's transitive closure is imported — core-domain's
 * audit/history modules pull Node built-ins and are deliberately NOT
 * part of the slice.
 *
 * @module G3SpikeCoreDomain
 */

// Engines (real production classes — zero mocking, golden-test wiring)
export { LandedCostCalculatorService } from '../../../../../packages/core-domain/src/calculator/landed-cost-calculator.service';
export { ClassificationGateService } from '../../../../../packages/core-domain/src/normalization/classification-gate.service';
export { AlcoholExciseService } from '../../../../../packages/core-domain/src/tax/services/alcohol-excise.service';
export { ContainerDutyService } from '../../../../../packages/core-domain/src/tax/services/container-duty.service';
export { TransactionClassificationService } from '../../../../../packages/core-domain/src/classification/transaction-classification.service';
export { TransportClassificationService } from '../../../../../packages/core-domain/src/transport/transport-classification.service';
export { TransportEstimationService } from '../../../../../packages/core-domain/src/transport/transport-estimation.service';
export { ConfidenceFrameworkService } from '../../../../../packages/core-domain/src/reliability/confidence-framework.service';
export { ReliabilityService } from '../../../../../packages/core-domain/src/reliability/reliability.service';

// Constants + error types
export { TAX_TYPES } from '../../../../../packages/core-domain/src/tax/tax-categories';
export {
  ClassificationGateRejectionError,
  ProductNotFoundError,
  NoRetailOffersError,
} from '../../../../../packages/core-domain/src/calculator/calculator.types';

// Port contracts the D1 adapters implement
export type {
  IProductDataPort,
  ICalculationRecordPort,
  CalculatorProductData,
  CalculatorRetailOfferData,
  CalculatorInput,
  CreateCalculationRecordInput,
} from '../../../../../packages/core-domain/src/calculator/calculator.types';
export type {
  ITaxRuleRepositoryPort,
  TaxRuleRecordPort,
} from '../../../../../packages/core-domain/src/tax/ports/tax-rule-repository.port';
export type { ITransportOfferQuery } from '../../../../../packages/core-domain/src/transport/transport-offer-query.interface';
export type { TransportOffer } from '../../../../../packages/core-domain/src/transport/transport-offer.type';
export type { TransportArrangement } from '../../../../../packages/core-domain/src/calculator/calculator.types';
