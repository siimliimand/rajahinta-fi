import { Module } from '@nestjs/common';
import { TaxModule } from './tax/tax.module';
import { NormalizationModule } from './normalization/normalization.module';
import { SourceGovernanceModule } from './governance/governance.module';
import { ClassificationModule } from './classification/classification.module';

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
// ---------------------------------------------------------------------------

export interface Disclaimer {
  readonly text: string;
  readonly language: 'fi' | 'en';
}

export const DISCLAIMER_FI: Disclaimer = {
  text: 'Arvioitu kokonaiskustannus Suomessa, ei lopullinen verovelvollisuuden määrä.',
  language: 'fi',
};

export const DISCLAIMER_EN: Disclaimer = {
  text: 'Estimated total cost in Finland, not final legal tax liability.',
  language: 'en',
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

// ---------------------------------------------------------------------------
// NestJS module — registration shell; domain logic is injected via providers
// ---------------------------------------------------------------------------

@Module({
  imports: [TaxModule, SourceGovernanceModule, ClassificationModule, NormalizationModule],
  exports: [TaxModule, SourceGovernanceModule, ClassificationModule, NormalizationModule, TaxCalculationEngine],
})
export class CoreDomainModule {}