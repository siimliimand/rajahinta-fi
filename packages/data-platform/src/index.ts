// ---------------------------------------------------------------------------
// Drizzle schema definitions — sourced from ./schema.ts
// ---------------------------------------------------------------------------

export {
  productMaster,
  retailOffers,
  taxRules,
  transportOffers,
  calculationRecords,
  accounts,
  savedBaskets,
  savedScenarios,
  priceObservations,
  priceHistorySummaries,
  aggregationWatermarks,
  merchantTerms,
  basketCalculationRecords,
  fxRateDatasets,
  fxRates,
  sessions,
  auditEvents,
  clickCounterSnapshots,
  merchantRegistry,
} from './schema';

// ---------------------------------------------------------------------------
// Repository abstractions — sourced from ./abstracts.ts
// ---------------------------------------------------------------------------

export {
  ProductRepository,
  TaxRateRepository,
  TransportOfferRepository,
  CalculationRecordRepository,
  AccountRepository,
  SavedBasketRepository,
  SavedScenarioRepository,
  PriceObservationRepository,
  PriceHistorySummaryRepository,
  AggregationWatermarkRepository,
  MerchantTermsRepository,
  BasketCalculationRecordRepository,
  FxRateRepository,
  SessionRepository,
  MerchantRegistryRepository,
  ClickCounterSnapshotRepository,
} from './abstracts';
export type {
  PriceObservationRecord,
  PriceHistorySummaryRecord,
  PriceHistorySummaryUpsertInput,
  ProductActivitySince,
  MerchantTermsRecord,
  BasketCalculationRecord,
  SavedScenarioInputs,
  SavedScenarioRecord,
  FxRateDatasetRecord,
  FxRateRow,
  ResolvedFxRate,
  SessionRecord,
  MerchantRegistryRecord,
  ClickCounterSnapshotRecord,
  CalculationHistoryEntry,
} from './abstracts';

// ---------------------------------------------------------------------------
// Concrete repository implementations — Drizzle-based
// ---------------------------------------------------------------------------

export { DrizzleProductRepository } from './repositories/product.repository';
export { DrizzleTaxRateRepository, TaxRuleRepositoryAdapter } from './repositories/tax-rate.repository';
export { DrizzleTransportOfferRepository } from './repositories/transport-offer.repository';
export { DrizzleCalculationRecordRepository } from './repositories/calculation-record.repository';
export { DrizzleCorrectionRepository } from './repositories/correction.repository';
export { DrizzleAccountRepository } from './repositories/account.repository';
export { DrizzleSavedBasketRepository } from './repositories/saved-basket.repository';
export { DrizzleSavedScenarioRepository } from './repositories/saved-scenario.repository';
export { DrizzlePriceObservationRepository } from './repositories/price-observation.repository';
export { DrizzlePriceHistorySummaryRepository } from './repositories/price-history-summary.repository';
export { DrizzleAggregationWatermarkRepository } from './repositories/aggregation-watermark.repository';
export { DrizzleMerchantTermsRepository } from './repositories/merchant-terms.repository';
export { DrizzleBasketCalculationRecordRepository } from './repositories/basket-calculation-record.repository';
export { DrizzleFxRateRepository } from './repositories/fx-rate.repository';
export { FxRateDatasetRepositoryAdapter } from './repositories/fx-rate-port.adapter';
export { DrizzleSessionRepository } from './repositories/session.repository';
export { DrizzleAuditEventRepository } from './repositories/audit-event.repository';
export { DrizzleMerchantRegistryRepository } from './repositories/merchant-registry.repository';
export { DrizzleClickCounterSnapshotRepository } from './repositories/click-counter-snapshot.repository';

// ---------------------------------------------------------------------------
// Repository-boundary decimal coercion for pg numeric columns (task 3.5)
// ---------------------------------------------------------------------------

export { pgNumericToNumber, requirePgNumeric } from './db/pg-numeric';

// ---------------------------------------------------------------------------
// Retention — monthly-partition maintenance and anonymous-row pruning
// ---------------------------------------------------------------------------

export {
  CalculationRecordRetentionService,
  type RetentionRunResult,
} from './maintenance/calculation-record-retention.service';

// ---------------------------------------------------------------------------
// Merchant reliability — abstract token + aggregate type are co-located with
// the concrete implementation (repositories/merchant-reliability.repository.ts)
// ---------------------------------------------------------------------------

export { MerchantReliabilityRepository } from './repositories/merchant-reliability.repository';
export type { MerchantReliabilityAggregate } from './repositories/merchant-reliability.repository';

// ---------------------------------------------------------------------------
// Price alerts — D1-only tables (task 2.1, change
// product-roadmap-phases-1-4); abstract + concrete are co-located in the
// repository files (merchant-reliability precedent; no pg counterpart)
// ---------------------------------------------------------------------------

export {
  PriceAlertRepository,
  D1PriceAlertRepository,
} from './repositories/d1/price-alert.repository';
export type {
  PriceAlertRecord,
  PriceAlertCreateInput,
  PriceAlertUpdatePatch,
  PriceAlertStatus,
} from './repositories/d1/price-alert.repository';
export {
  AlertNotificationRepository,
  D1AlertNotificationRepository,
} from './repositories/d1/alert-notification.repository';
export type {
  AlertNotificationRecord,
  AlertNotificationIntentInput,
  AlertChannel,
  AlertDeliveryStatus,
} from './repositories/d1/alert-notification.repository';

// ---------------------------------------------------------------------------
// Product dimensions + carrier box types — D1-only tables (task 3.1, change
// product-roadmap-phases-1-4); abstract + concrete are co-located in the
// repository files (price-alert precedent; no pg counterpart)
// ---------------------------------------------------------------------------

export {
  ProductDimensionsRepository,
  D1ProductDimensionsRepository,
} from './repositories/d1/product-dimensions.repository';
export type {
  ProductDimensionRecord,
  ProductDimensionUpsertInput,
  ProductDimensionMaterial,
} from './repositories/d1/product-dimensions.repository';
export {
  CarrierBoxTypesRepository,
  D1CarrierBoxTypesRepository,
} from './repositories/d1/carrier-box-types.repository';
export type { CarrierBoxTypeRecord } from './repositories/d1/carrier-box-types.repository';

// ---------------------------------------------------------------------------
// Module boundary — pure interfaces for cross-layer contracts
// ---------------------------------------------------------------------------

export type {
  IRepositoryRegistry,
  IProductRepository,
  ITaxRateRepository,
  ITransportOfferRepository,
  IAuditRepository,
  ICalculationRecordRepository,
  ProductMasterRecord,
  RetailOfferRecord,
  TaxRuleRecord,
  TransportOfferRecord,
  CalculationAuditEntry,
  CalculationRecord,
} from './interfaces/repository-registry.interface';

// ---------------------------------------------------------------------------
// Staging seed — idempotent database populator for staging environments
// ---------------------------------------------------------------------------

export { seedStagingDatabase } from './seed/staging-seed';

// ---------------------------------------------------------------------------
// Tax rule seed — idempotent seeder for official excise duty rates
// ---------------------------------------------------------------------------

export { seedTaxRules } from './seed/tax-rules.seed';

// ---------------------------------------------------------------------------
// Merchant registry seed — idempotent bootstrap of the initial merchant set
// (task 7.2; replaces the static merchants.config.ts data)
// ---------------------------------------------------------------------------

export {
  seedMerchantRegistry,
  type MerchantRegistrySeedRow,
} from './seed/merchant-registry.seed';

// ---------------------------------------------------------------------------
// Carrier box-type seed — curated PostNord/DHL standard catalogue (task 3.1),
// the packing module's only source of box geometry; D1-only table
// ---------------------------------------------------------------------------

export {
  seedCarrierBoxTypes,
  CARRIER_BOX_TYPES_SEED,
  type CarrierBoxTypeSeedRow,
} from './seed/carrier-box-types.seed';

// ---------------------------------------------------------------------------
// Drizzle connection provider
// ---------------------------------------------------------------------------

export { DRIZZLE, DrizzleProvider } from './db/drizzle.provider';
export type { DrizzleDatabase } from './db/drizzle.provider';
export { DrizzleModule } from './db/drizzle.module';

// ---------------------------------------------------------------------------
// NestJS module
// ---------------------------------------------------------------------------

export { DataPlatformModule } from './data-platform.module';