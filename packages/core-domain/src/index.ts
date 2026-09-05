import { Module } from '@nestjs/common';
import type { Disclaimer } from './calculator/calculator.types';
import type { ReliabilityStatus } from './reliability/reliability.types';
import { TaxModule, type TaxModuleOptions } from './tax/tax.module';
import { NormalizationModule } from './normalization/normalization.module';
import { SourceGovernanceModule } from './governance/governance.module';
import { ClassificationModule } from './classification/classification.module';
import { ReliabilityModule } from './reliability/reliability.module';
import { CalculatorModule, type CalculatorPorts } from './calculator/calculator.module';
import { DeclarationModule } from './declaration/declaration.module';
import { RankingModule } from './ranking/ranking.module';
import { CorrectionModule } from './correction/correction.module';
import { EntitlementModule } from './entitlement/entitlement.module';
import { HistoryModule, type HistoryModulePorts } from './history/history.module';
import { OptimizerModule, type OptimizerModulePorts } from './optimizer/optimizer.module';

// ---------------------------------------------------------------------------
// Domain entities — pure TypeScript, zero framework logic
// ---------------------------------------------------------------------------

/** Alcohol excise categories defined by Finnish Tax Administration. */
export type ExciseCategory = 'beer' | 'wine' | 'spirits' | 'intermediate' | 'other';

/** Container types subject to Finnish container duty. */
export type ContainerType = 'glass' | 'plastic' | 'metal' | 'carton' | 'other';

/** Reliability status for externally sourced facts. */
export type DataReliability = ReliabilityStatus;

/** Transaction classification per Finnish distance-selling rules. */
export type TransactionClass = 'distance-selling' | 'distance-buying' | 'traveller-import';

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

/** A versioned tax-rate dataset with effective dates. */
export interface TaxRateVersion {
  readonly id: string;
  readonly versionLabel: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
}

/** Base units for alcohol excise calculation. */
export interface ExciseBase {
  readonly category: ExciseCategory;
  readonly volumeLitres: number;
  readonly alcoholByVolume: number;
}

/** Container-duty estimation request. */
export interface ContainerDutyRequest {
  readonly containerType: ContainerType;
  readonly volumeLitres: number;
  readonly depositSystemVerified: boolean;
}

// ---------------------------------------------------------------------------
// Calculation results with provenance
// ---------------------------------------------------------------------------

export interface ExciseCalculation {
  readonly exciseAmountCents: number;
  readonly category: ExciseCategory;
  readonly rateVersionId: string;
  readonly calculatedAt: Date;
  readonly evidence: {
    readonly volumeLitres: number;
    readonly alcoholByVolume: number;
    readonly rateAppliedCentsPerUnit: number;
  };
}

export interface ContainerDutyCalculation {
  readonly dutyAmountCents: number;
  readonly reliability: 'EXACT' | 'ESTIMATED';
  readonly evidence: {
    readonly containerType: ContainerType;
    readonly volumeLitres: number;
    readonly rateAppliedCentsPerLitre: number;
    readonly depositExemptionApplied: boolean;
  };
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Tax — excise duty, container duty, and tax rule repository port
// ---------------------------------------------------------------------------

export { TAX_RULE_REPOSITORY_PORT } from './tax/index';
export type { ITaxRuleRepositoryPort, TaxRuleRecordPort, AbvTierConditions } from './tax/index';

// ---------------------------------------------------------------------------
// FX rate datasets — versioned, manually-confirmed conversion-rate datasets
// ---------------------------------------------------------------------------

export { FX_RATE_DATASET_REPOSITORY_PORT } from './fx/index';
export type { IFxRateDatasetRepositoryPort } from './fx/index';
export { FxRateDatasetService } from './fx/index';
export type {
  FxDatasetStatus,
  FxDatasetVersion,
  FxRateEntry,
  NewFxDataset,
  ResolvedFxDatasetRate,
} from './fx/index';
export { FX_DATASET_STATUSES } from './fx/index';
export { FxModule, type FxModuleOptions } from './fx/index';

// Tax formula reference constants — values stored in taxRules.calculationFormulaReference
export {
  FORMULA_PER_LITRE_OF_PRODUCT,
  FORMULA_PER_LITRE_OF_ALCOHOL,
  FORMULA_PER_CENTILITRE_ETHANOL,
  FORMULA_PER_DEGREE_PLATO,
  FORMULA_FLAT_PER_LITRE,
} from './tax/index';

// Tax services — excise duty and container duty calculations
export { AlcoholExciseService, ContainerDutyService } from './tax/index';
export type { ExciseResult, ContainerDutyResult } from './tax/index';

// Tax-type constants — canonical vocabulary used across seed, engine, tests
export { TAX_TYPES, TAX_CATEGORY_KEYS } from './tax/index';
export type { TaxType, TaxCategory } from './tax/index';
// Category canonicalisation — read-side consumers (e.g. historical-data
// attribution windows) must query rules with the same normalised category
// the engines resolved observations against.
export { normaliseCategory } from './tax/index';

// ---------------------------------------------------------------------------
// Documentation section markers
// ---------------------------------------------------------------------------

// Disclaimer — structural part of every calculation result
// Re-exported from the dedicated leaf module; the constants previously
// lived here, which created a barrel import cycle from the calculator and
// optimizer services.
// ---------------------------------------------------------------------------

export { DISCLAIMER_FI, DISCLAIMER_EN } from './disclaimer';

// ---------------------------------------------------------------------------
// Landed-cost aggregate — top-level result object
// ---------------------------------------------------------------------------

export interface LandedCostResult {
  readonly retailPriceCents: number;
  readonly transportCostCents: number;
  readonly exciseDuty: ExciseCalculation | null;
  readonly containerDuty: ContainerDutyCalculation | null;
  readonly totalCostCents: number;
  readonly currency: 'EUR';
  readonly disclaimer: Disclaimer;
  readonly calculationTimestamp: Date;
  readonly transactionClass: TransactionClass;
}

// ---------------------------------------------------------------------------
// Engine interface — pure function contract, no framework dependency
// ---------------------------------------------------------------------------

export abstract class TaxCalculationEngine {
  abstract calculateExcise(base: ExciseBase): Promise<ExciseCalculation>;
  abstract calculateContainerDuty(
    request: ContainerDutyRequest,
  ): Promise<ContainerDutyCalculation>;
  abstract calculateLandedCost(params: {
    retailPriceCents: number;
    transportCostCents: number;
    exciseBase: ExciseBase | null;
    containerDutyRequest: ContainerDutyRequest | null;
    transactionClass: TransactionClass;
  }): Promise<LandedCostResult>;
}

// ---------------------------------------------------------------------------
// Module boundary — pure interfaces for cross-layer contracts
// ---------------------------------------------------------------------------

export type { ICalculationEngine, LandedCostParams } from './interfaces/calculation-engine.interface';

// ---------------------------------------------------------------------------
// Transport Estimation — carrier rates, weight-tier matching, route queries
// ---------------------------------------------------------------------------

export { TransportEstimationModule } from './transport/transport-estimation.module';
export { TransportEstimationService, NotFoundError } from './transport/transport-estimation.service';
export { BasketShippingCalculator } from './transport/basket-shipping-calculator.service';
export { TransportClassificationService } from './transport/transport-classification.service';
export type { ITransportOfferQuery } from './transport/transport-offer-query.interface';
export { TRANSPORT_OFFER_QUERY } from './transport/transport-offer-query.interface';
export type { TransportOffer, TransportEstimate, WeightBracket } from './transport/transport-offer.type';
export type { BasketItem, BasketShippingResult, BasketShippingThresholdCheck, BasketItemBreakdown } from './transport/basket-shipping.types';
export type { TransactionTransportType } from './transport/transport-classification.types';

// ---------------------------------------------------------------------------
// Source Governance — merchant data-source provenance, permission tracking
// ---------------------------------------------------------------------------

export type {
  AcquisitionMethod,
  PermissionStatus,
  SourceGovernanceRecord,
  RegisterSourceInput,
  PermissionCheckResult,
} from './governance/source-governance.types';

export type { ISourceGovernanceRepository } from './governance/ports/source-governance-repository.port';
export { SOURCE_GOVERNANCE_REPOSITORY_PORT } from './governance/ports/source-governance-repository.port';

export { SourceGovernanceService } from './governance/services/source-governance.service';
export { SourceGovernanceModule } from './governance/governance.module';

// ---------------------------------------------------------------------------
// Transaction Classification — highest-liability proprietary logic
// ---------------------------------------------------------------------------

export { ClassificationModule } from './classification/classification.module';
export { TransactionClassificationService } from './classification/transaction-classification.service';
export {
  ClassificationRuleEngine,
  createDefaultRuleSet,
  createPostReformRuleSet,
  createBuiltInRuleSets,
  JOINT_LIABILITY_REFORM_FROM,
  CURRENT_RULE_SET_VERSION,
} from './classification/services/classification-rule-engine.service';
export type { ClassificationEngineResult } from './classification/services/classification-rule-engine.service';
export { ClassificationRuleSetService } from './classification/services/classification-rule-set.service';
export type { PublishRuleSetInput } from './classification/services/classification-rule-set.service';
export type {
  ClassificationInput,
  ClassificationResult,
  ClassificationLabel,
  ConfidenceLevel,
} from './classification/classification.types';
export type {
  ClassificationRule,
  ClassificationRuleSet,
} from './classification/classification-rule.types';
export {
  CLASSIFICATION_RULE_REPOSITORY_PORT,
} from './classification/ports/classification-rule-repository.port';
export type {
  IClassificationRuleRepositoryPort,
  ClassificationRuleSetRecord,
} from './classification/ports/classification-rule-repository.port';

// ---------------------------------------------------------------------------
// Normalization — raw product cleansing, category mapping, volume/ABV validation
// ---------------------------------------------------------------------------

export { NormalizationModule } from './normalization/normalization.module';
export { NormalizationService } from './normalization/normalization.service';
export {
  normalizeBrandName,
  normalizeCategory,
  standardizeVolume,
  standardizeContainerType,
  validateAbv,
} from './normalization/normalization.service';
export type {
  CanonicalCategory,
  CanonicalContainerType,
  NormalizedProduct,
  RawProductInput,
  VolumeUnit,
} from './normalization/normalization.types';

// Classification vocabulary + source-category normalization (task 7.1) —
// the classification gate and the ingestion adapters share these.
export {
  CANONICAL_CATEGORY_KEYS,
  KNOWN_REGULATORY_CLASSIFICATIONS,
  REGULATORY_CLASSIFICATION_PLACEHOLDER,
} from './normalization/normalization.types';
export {
  mapSourceCategory,
  isKnownTaxCategory,
  SWEDISH_SOURCE_CATEGORY_MAP,
} from './normalization/source-category.mapper';
export type { SourceCategoryMapping } from './normalization/source-category.mapper';

// -- Product matching / deduplication --

export { ProductMatcherModule } from './normalization/product-matcher.module';
export { ProductMatcherService } from './normalization/product-matcher.service';
export {
  tokenize,
  jaccardSimilarity,
  levenshteinDistance,
  scoreNameSimilarity,
  scoreBrandSimilarity,
  scoreVolumeMatch,
  scoreAbvMatch,
  scoreCategoryMatch,
  scoreProduct,
  scoreToConfidence,
} from './normalization/product-matcher.service';
export type {
  MatchConfidence,
  MatchMethod,
  ProductMatchCandidate,
  ProductMatchResult,
} from './normalization/product-matcher.types';
export type { IProductMasterQuery, ProductMasterRecord } from './normalization/ports/product-master-query.port';
export { PRODUCT_MASTER_QUERY_PORT } from './normalization/ports/product-master-query.port';

// ---------------------------------------------------------------------------
// Calculator — landed-cost orchestrator
// ---------------------------------------------------------------------------

export { CalculatorModule, type CalculatorPorts } from './calculator/calculator.module';
export { LandedCostCalculatorService } from './calculator/landed-cost-calculator.service';
export type {
  CalculatorInput,
  CalculatorResult,
  CalculatorProductData,
  CalculatorRetailOfferData,
  CostCategory,
  ItemizedCost,
  OfferExclusion,
  OfferExclusionReason,
  OriginalPrice,
  CreateCalculationRecordInput,
  Disclaimer,
  TransportArrangement,
  IProductDataPort,
  ICalculationRecordPort,
} from './calculator/calculator.types';
export {
  PRODUCT_DATA_PORT,
  CALCULATION_RECORD_PORT,
  hasValidEurConversion,
  ClassificationGateRejectionError,
  ProductNotFoundError,
  NoRetailOffersError,
} from './calculator/calculator.types';

// ---------------------------------------------------------------------------
// Declaration — excise declaration assistant
// ---------------------------------------------------------------------------

export { DeclarationModule } from './declaration/declaration.module';
export { ExciseDeclarationService } from './declaration/excise-declaration.service';
export type {
  DeclarationSummary,
  DeclarationProduct,
  DeclarationContainer,
  DeclarationTransport,
  DeclarationEstimatedExcise,
  DeclarationAdvanceNoticeInfo,
  CalculationRecordData,
  ICalculationRecordQueryPort,
  ReadonlyInterface,
  DeclarationSafetyConstraint,
} from './declaration/declaration.types';
export {
  CALCULATION_RECORD_QUERY_PORT,
  CalculationRecordNotFoundError,
  NO_SUBMISSION_GUARANTEE,
} from './declaration/declaration.types';

// ---------------------------------------------------------------------------
// Reliability — data-point freshness, availability, and composition
// ---------------------------------------------------------------------------

export { ReliabilityModule } from './reliability/reliability.module';
export { ReliabilityService } from './reliability/reliability.service';
export { MerchantReliabilityScoreService } from './reliability/merchant-reliability-score.service';
export type {
  MerchantReliabilityScore,
  MerchantReliabilityScoreInput,
} from './reliability/merchant-reliability-score.types';
export { MerchantReliabilityInputError } from './reliability/merchant-reliability-score.types';
export type { ReliabilityStatus, ReliabilityDomain, Duration } from './reliability/reliability.types';
export {
  RELIABILITY_ORDER,
  DEFAULT_STALENESS_THRESHOLDS,
  HOUR,
  DAY,
  WEEK,
} from './reliability/reliability.types';

// ---------------------------------------------------------------------------
// Unit price — cents per gram of pure ethanol (read-time derived, never persisted)
// ---------------------------------------------------------------------------

export { eurPerGram, ETHANOL_DENSITY_G_PER_L } from './unitprice/eur-per-gram';
export type {
  UnitPriceResult,
  UnitPriceValue,
  UnitPriceUnavailable,
  UnitPriceStatus,
  UnitPriceUnavailableReason,
} from './unitprice/unitprice.types';

// ---------------------------------------------------------------------------
// Packing — deterministic carrier box suggestion (FFD, mixing warning)
// ---------------------------------------------------------------------------

export { suggestPacking } from './packing/packing';
export {
  MIXED_MATERIAL_MAX_UNITS,
  MIXED_MATERIAL_MAX_COMBINED_WEIGHT_G,
} from './packing/thresholds';
export type {
  CarrierBoxType,
  ExcludedPackingItem,
  MixingTrigger,
  MixingWarning,
  PackedBox,
  PackedBoxGroup,
  PackingExclusionReason,
  PackingItem,
  PackingMaterial,
  PackingStatus,
  PackingSuggestion,
} from './packing/packing.types';

// ---------------------------------------------------------------------------
// Event calculator — norms-based consumption + minimal-surplus shopping list
// ---------------------------------------------------------------------------

export {
  calculateEventShoppingList,
  computeConsumption,
  toShoppingList,
} from './eventcalc/eventcalc';
export { RETAIL_UNITS_BY_DRINK_TYPE } from './eventcalc/retail-units';
export type {
  EventCalcInput,
  EventCalcResult,
  EventCalcStatus,
  EventDrinkType,
  EventNormRow,
  EventProfile,
  EventShoppingList,
  NoPublishedNormsResult,
  EventConsumptionLine,
  ShoppingListLine,
  PlannedUnit,
  InconsistentNormsReason,
} from './eventcalc/eventcalc.types';
export {
  EVENT_CALC_DRINK_TYPES,
  EVENT_CALC_EVENT_PROFILES,
  InvalidEventInputError,
  InconsistentNormsError,
  MixedNormVersionsError,
} from './eventcalc/eventcalc.types';

// ---------------------------------------------------------------------------
// Ranking & Sorting — objective sort orders for beverage price comparison
// ---------------------------------------------------------------------------

export { RankingModule } from './ranking/ranking.module';
export { RankingService } from './ranking/ranking.service';
export { RankingConfigService } from './ranking/ranking-config.service';
export type { RankingConfig } from './ranking/ranking-config.service';
export type { NeutralSortInput, SortOrder } from './ranking/ranking.types';

// ---------------------------------------------------------------------------
// Correction — flagging calculations and data points for human review
// ---------------------------------------------------------------------------

export { CorrectionModule } from './correction/correction.module';
export { CorrectionService } from './correction/correction.service';
export type {
  FlaggedItem,
  FlagStatus,
  FlagTargetType,
  ResolutionAction,
  ResolutionActionType,
  FlagResolutionDetail,
} from './correction/correction.types';
export type {
  ICorrectionRepository,
  ICorrectionCalculationRecordQuery,
} from './correction/correction-repository.port';
export {
  CORRECTION_REPOSITORY_PORT,
  CORRECTION_CALCULATION_RECORD_QUERY_PORT,
} from './correction/correction-repository.port';
export {
  CalculationNotFoundError,
  FlagNotFoundError,
  FlagAlreadyResolvedError,
} from './correction/correction.service';

// ---------------------------------------------------------------------------
// History — append-only price-observation log for historical price intelligence
// ---------------------------------------------------------------------------

export { HistoryModule } from './history/history.module';
export type { HistoryModulePorts } from './history/history.module';
export { PriceObservationRecorderService } from './history/price-observation-recorder.service';
export { TaxChangeAttributionService } from './history/services/tax-change-attribution.service';
export type {
  StepClassification,
  TaxRuleEffectiveWindow,
  TaxChangeAttributionInput,
  AttributionMovedInputs,
  RuleVersionBoundary,
  AttributedStep,
} from './history/services/tax-change-attribution.service';
export { AttributionInputError } from './history/services/tax-change-attribution.service';
export type {
  PriceObservation,
  RecordedPriceObservation,
  RecordObservationInput,
  ObservationInputReliability,
  TaxRuleVersionSnapshot,
} from './history/price-observation.types';
export type { IPriceObservationPort } from './history/price-observation.port';
export { PRICE_OBSERVATION_PORT } from './history/price-observation.port';

// ---------------------------------------------------------------------------
// Optimizer — multi-item basket optimization against landed costs
// ---------------------------------------------------------------------------

export { OptimizerModule } from './optimizer/optimizer.module';
export type { OptimizerModulePorts } from './optimizer/optimizer.module';
export { MERCHANT_TERMS_PORT, BASKET_CALCULATION_RECORD_PORT } from './optimizer/index';
export type { IMerchantTermsPort, MerchantTerms } from './optimizer/index';
export type { IBasketCalculationRecordPort, CreateBasketCalculationRecordInput } from './optimizer/index';
export {
  MAX_BASKET_ITEMS,
  MAX_CANDIDATE_MERCHANTS_PER_ITEM,
  MAX_TOTAL_COMBINATIONS,
  BasketOptimizerService,
  BasketValidationError,
  BasketClassificationGateError,
  BasketCombinationLimitError,
} from './optimizer/index';
export type {
  BasketInputItem,
  BasketOptimizationInput,
  ConsolidatedTransportReliability,
  ConsolidatedTransport,
  MinimumOrderThresholdCheck,
  BasketShipment,
  BasketOptimizationMetadata,
  BasketOptimizationAlternate,
  BasketOptimizationResult,
} from './optimizer/index';

// ---------------------------------------------------------------------------
// Entitlement — feature-access tier management
// ---------------------------------------------------------------------------

export { EntitlementModule } from './entitlement/entitlement.module';
export { EntitlementService } from './entitlement/entitlement.service';
export type {
  AccountContext,
  Entitlement,
  EntitlementTier,
  FeatureId,
  TierTransition,
  TierTransitionSource,
} from './entitlement/entitlement.types';
export {
  FEATURE_TIER_MAP,
  isTierSufficient,
  isTierTransitionWellFormed,
} from './entitlement/entitlement.types';

// ---------------------------------------------------------------------------
// Audit — immutable audit log for high-liability domain changes
// ---------------------------------------------------------------------------

export { AuditModule } from './audit/audit.module';
export { AuditService } from './audit/audit.service';
export { AUDIT_REPOSITORY_PORT } from './audit/audit-repository.port';
export type { IAuditRepository } from './audit/audit-repository.port';
export type { AuditEntry, AuditAction, AuditQuery } from './audit/audit.types';

// ---------------------------------------------------------------------------
// NestJS module — registration shell; domain logic is injected via providers
// ---------------------------------------------------------------------------

@Module({
  imports: [TaxModule, SourceGovernanceModule, ClassificationModule, NormalizationModule, ReliabilityModule, CalculatorModule, DeclarationModule, RankingModule, CorrectionModule, EntitlementModule, HistoryModule, OptimizerModule],
  exports: [TaxModule, SourceGovernanceModule, ClassificationModule, NormalizationModule, ReliabilityModule, CalculatorModule, DeclarationModule, RankingModule, CorrectionModule, EntitlementModule, HistoryModule, OptimizerModule],
})
export class CoreDomainModule {}

/**
 * Deliberately undecorated class used as the identity of the CONFIGURED
 * domain module returned by {@link CoreDomainModule.forRoot}. A fresh class
 * is required because Nest merges a DynamicModule's fields with the static
 * @Module metadata of the referenced class — reusing CoreDomainModule as
 * the identity would drag the default (null-port) CalculatorModule into
 * the configured graph alongside the port-injected one.
 */
export class CoreDomainConfiguredModule {}

export interface CoreDomainOptions
  extends CalculatorPorts, TaxModuleOptions, HistoryModulePorts, OptimizerModulePorts {}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CoreDomainModule {
  /**
   * Configure the domain with concrete calculator port implementations
   * (product data + calculation record persistence) and an optional
   * tax-rule repository. Pass-through to CalculatorModule.forRoot /
   * TaxModule.forRoot — see their docs for why the providers must
   * live inside the consuming module's own scope.
   */
  export function forRoot(options: CoreDomainOptions) {
    const domainImports = [SourceGovernanceModule, ClassificationModule, NormalizationModule, ReliabilityModule, DeclarationModule, RankingModule, CorrectionModule, EntitlementModule];
    const calculator = CalculatorModule.forRoot(options);
    const tax = TaxModule.forRoot(options);
    // The history module shares the product-data port and tax-rule
    // repository with the calculator; extraProviders are re-registered in
    // its scope so its port adapters resolve their own dependencies.
    const history = HistoryModule.forRoot({
      taxRuleRepository: options.taxRuleRepository,
      priceObservationPort: options.priceObservationPort,
      productDataPort: options.productDataPort,
      extraProviders: options.extraProviders,
    });
    // The optimizer shares the product-data port with the calculator and
    // adds its own merchant-terms and basket-record ports; extraProviders
    // are re-registered in its scope so its port adapters resolve their own
    // dependencies.
    const optimizer = OptimizerModule.forRoot({
      productDataPort: options.productDataPort,
      calculationRecordPort: options.calculationRecordPort,
      taxRuleRepository: options.taxRuleRepository,
      merchantTermsPort: options.merchantTermsPort,
      basketCalculationRecordPort: options.basketCalculationRecordPort,
      transportOfferQuery: options.transportOfferQuery,
      extraProviders: options.extraProviders,
    });
    return {
      module: CoreDomainConfiguredModule,
      imports: [...domainImports, calculator, tax, history, optimizer],
      exports: [...domainImports, calculator, tax, history, optimizer],
    };
  }
}