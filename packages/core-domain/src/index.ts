import { Module } from '@nestjs/common';
import type { Disclaimer } from './calculator/calculator.types';
import { TaxModule } from './tax/tax.module';
import { NormalizationModule } from './normalization/normalization.module';
import { SourceGovernanceModule } from './governance/governance.module';
import { ClassificationModule } from './classification/classification.module';
import { ReliabilityModule } from './reliability/reliability.module';
import { CalculatorModule } from './calculator/calculator.module';
import { DeclarationModule } from './declaration/declaration.module';
import { RankingModule } from './ranking/ranking.module';
import { CorrectionModule } from './correction/correction.module';
import { CorrectionService } from './correction/correction.service';

// ---------------------------------------------------------------------------
// Domain entities — pure TypeScript, zero framework logic
// ---------------------------------------------------------------------------

/** Alcohol excise categories defined by Finnish Tax Administration. */
export type ExciseCategory = 'beer' | 'wine' | 'spirits' | 'intermediate' | 'other';

/** Container types subject to Finnish container duty. */
export type ContainerType = 'glass' | 'plastic' | 'metal' | 'carton' | 'other';

/** Reliability status for externally sourced facts. */
export type DataReliability = 'EXACT' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';

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
// Disclaimer — structural part of every calculation result
// Re-exported from calculator types for use across the domain.
// ---------------------------------------------------------------------------

export const DISCLAIMER_FI: Disclaimer = {
  text: 'Arvioitu kokonaiskustannus Suomessa. Ei ole lopullinen verovelvollisuuden määrä. Lopullinen verovelvollisuus määräytyy Tullin ja Verohallinnon vahvistamien verokantojen ja säännösten mukaan.',
  language: 'fi',
  version: '1.0',
};

export const DISCLAIMER_EN: Disclaimer = {
  text: 'Estimated total cost in Finland. Not final legal tax liability. Final tax liability is determined by the tax rates and regulations established by Finnish Customs and the Tax Administration.',
  language: 'en',
  version: '1.0',
};

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
} from './classification/services/classification-rule-engine.service';
export type { ClassificationEngineResult } from './classification/services/classification-rule-engine.service';
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

export { CalculatorModule } from './calculator/calculator.module';
export { LandedCostCalculatorService } from './calculator/landed-cost-calculator.service';
export type {
  CalculatorInput,
  CalculatorResult,
  CalculatorProductData,
  CalculatorRetailOfferData,
  CostCategory,
  ItemizedCost,
  CreateCalculationRecordInput,
  Disclaimer,
  IProductDataPort,
  ICalculationRecordPort,
} from './calculator/calculator.types';
export {
  PRODUCT_DATA_PORT,
  CALCULATION_RECORD_PORT,
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
export type { ReliabilityStatus, ReliabilityDomain, Duration } from './reliability/reliability.types';
export {
  RELIABILITY_ORDER,
  DEFAULT_STALENESS_THRESHOLDS,
  HOUR,
  DAY,
  WEEK,
} from './reliability/reliability.types';

// ---------------------------------------------------------------------------
// Ranking & Sorting — objective sort orders for beverage price comparison
// ---------------------------------------------------------------------------

export { RankingModule } from './ranking/ranking.module';
export { RankingService } from './ranking/ranking.service';
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
// NestJS module — registration shell; domain logic is injected via providers
// ---------------------------------------------------------------------------

@Module({
  imports: [TaxModule, SourceGovernanceModule, ClassificationModule, NormalizationModule, ReliabilityModule, CalculatorModule, DeclarationModule, RankingModule, CorrectionModule],
  exports: [TaxModule, SourceGovernanceModule, ClassificationModule, NormalizationModule, TaxCalculationEngine, ReliabilityModule, CalculatorModule, DeclarationModule, RankingModule, CorrectionModule, CorrectionService],
})
export class CoreDomainModule {}