/**
 * Core-domain bundle bridge (design D1/G3 pattern, task 4.1).
 *
 * Wrangler aliases `@rajahinta/core-domain` to this module (same
 * mechanism as the `@nestjs/common` shim): package files
 * (data-acquisition services, data-platform D1 adapters) import runtime
 * values from the core-domain barrel, and bundling the barrel would drag
 * the audit module's Node built-ins into the Worker. The spike-proven fix
 * is a bundler alias to an explicit subset re-exported from the
 * TypeScript SOURCES — no dist build, no audit module.
 *
 * The export set is the runtime closure of every `@rajahinta/core-domain`
 * import in the Worker's bundle graph (pipeline services, D1 adapters,
 * summary aggregation) plus the engines and types the Worker's own
 * composition consumes. Type-only imports are erased by the compiler and
 * deliberately NOT re-exported here beyond what the worker sources need.
 *
 * Adding an import of the barrel? Extend this bridge — the alias turns
 * a missing export into a bundler-time error, not a runtime surprise.
 *
 * @module CoreDomainBridge
 */

// Governance — the GRANTED-only gate (producer + pipeline + transport)
export { SourceGovernanceService } from '../../../../packages/core-domain/src/governance/services/source-governance.service';
export type { ISourceGovernanceRepository } from '../../../../packages/core-domain/src/governance/ports/source-governance-repository.port';
export type { PermissionCheckResult } from '../../../../packages/core-domain/src/governance/source-governance.types';

// Reliability
export { ReliabilityService } from '../../../../packages/core-domain/src/reliability/reliability.service';
export {
  RELIABILITY_ORDER,
  DEFAULT_STALENESS_THRESHOLDS,
} from '../../../../packages/core-domain/src/reliability/reliability.types';
export type { ReliabilityStatus } from '../../../../packages/core-domain/src/reliability/reliability.types';

// FX dataset service (FX review cron + Systembolaget SEK→EUR conversion)
export { FxRateDatasetService } from '../../../../packages/core-domain/src/fx/fx-dataset.service';
export { FX_DATASET_STATUSES } from '../../../../packages/core-domain/src/fx/fx-dataset.types';
export { FX_RATE_DATASET_REPOSITORY_PORT } from '../../../../packages/core-domain/src/fx/ports/fx-rate-dataset-repository.port';

// Feed mapping
export { mapSourceCategory } from '../../../../packages/core-domain/src/normalization/source-category.mapper';

// Calculator engines + port contracts (offer-change recorder chain)
export { ClassificationGateService } from '../../../../packages/core-domain/src/normalization/classification-gate.service';
export { AlcoholExciseService } from '../../../../packages/core-domain/src/tax/services/alcohol-excise.service';
export { ContainerDutyService } from '../../../../packages/core-domain/src/tax/services/container-duty.service';
export { TransportEstimationService } from '../../../../packages/core-domain/src/transport/transport-estimation.service';
export { ConfidenceFrameworkService } from '../../../../packages/core-domain/src/reliability/confidence-framework.service';
export { PriceObservationRecorderService } from '../../../../packages/core-domain/src/history/price-observation-recorder.service';
export { PRICE_OBSERVATION_PORT } from '../../../../packages/core-domain/src/history/price-observation.port';
export type {
  IProductDataPort,
  CalculatorProductData,
  CalculatorRetailOfferData,
} from '../../../../packages/core-domain/src/calculator/calculator.types';
export type { IPriceObservationPort } from '../../../../packages/core-domain/src/history/price-observation.port';
export type { PriceObservation } from '../../../../packages/core-domain/src/history/price-observation.types';
export type { ITransportOfferQuery } from '../../../../packages/core-domain/src/transport/transport-offer-query.interface';
export type { TransportOffer } from '../../../../packages/core-domain/src/transport/transport-offer.type';

// ---------------------------------------------------------------------------
// Calculator / optimizer composition (route ports, tasks 3.5–3.6)
// ---------------------------------------------------------------------------

export { LandedCostCalculatorService } from '../../../../packages/core-domain/src/calculator/landed-cost-calculator.service';
export { TransactionClassificationService } from '../../../../packages/core-domain/src/classification/transaction-classification.service';
export { TransportClassificationService } from '../../../../packages/core-domain/src/transport/transport-classification.service';
export { MerchantReliabilityScoreService } from '../../../../packages/core-domain/src/reliability/merchant-reliability-score.service';
export { BasketOptimizerService } from '../../../../packages/core-domain/src/optimizer/services/basket-optimizer.service';
export { BasketShippingCalculator } from '../../../../packages/core-domain/src/transport/basket-shipping-calculator.service';
export { TaxChangeAttributionService } from '../../../../packages/core-domain/src/history/services/tax-change-attribution.service';

// Domain errors + constants the route handlers map onto HTTP responses.
export {
  ProductNotFoundError,
  NoRetailOffersError,
  ClassificationGateRejectionError,
} from '../../../../packages/core-domain/src/calculator/calculator.types';
export {
  BasketValidationError,
  BasketClassificationGateError,
  BasketCombinationLimitError,
  MAX_BASKET_ITEMS,
} from '../../../../packages/core-domain/src/optimizer/optimizer.types';
export { CalculationRecordNotFoundError, CALCULATION_RECORD_QUERY_PORT } from '../../../../packages/core-domain/src/declaration/declaration.types';
export { DISCLAIMER_FI } from '../../../../packages/core-domain/src/disclaimer';
export { TAX_TYPES } from '../../../../packages/core-domain/src/tax/tax-categories';
export { normaliseCategory } from '../../../../packages/core-domain/src/tax/services/alcohol-excise.math';

// ---------------------------------------------------------------------------
// Declaration + attribution services (route ports, tasks 3.5–3.6)
// ---------------------------------------------------------------------------

export { ExciseDeclarationService } from '../../../../packages/core-domain/src/declaration/excise-declaration.service';

// History — TaxChangeAttributionService is registered above with the other
// route-port services.
