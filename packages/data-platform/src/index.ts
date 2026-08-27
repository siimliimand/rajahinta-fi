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
  priceObservations,
  priceHistorySummaries,
  aggregationWatermarks,
  merchantTerms,
  basketCalculationRecords,
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
  PriceObservationRepository,
  PriceHistorySummaryRepository,
  AggregationWatermarkRepository,
  MerchantTermsRepository,
  BasketCalculationRecordRepository,
} from './abstracts';
export type {
  PriceObservationRecord,
  PriceHistorySummaryRecord,
  PriceHistorySummaryUpsertInput,
  ProductActivitySince,
  MerchantTermsRecord,
  BasketCalculationRecord,
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
export { DrizzlePriceObservationRepository } from './repositories/price-observation.repository';
export { DrizzlePriceHistorySummaryRepository } from './repositories/price-history-summary.repository';
export { DrizzleAggregationWatermarkRepository } from './repositories/aggregation-watermark.repository';
export { DrizzleMerchantTermsRepository } from './repositories/merchant-terms.repository';
export { DrizzleBasketCalculationRecordRepository } from './repositories/basket-calculation-record.repository';

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
// Drizzle connection provider
// ---------------------------------------------------------------------------

export { DRIZZLE, DrizzleProvider } from './db/drizzle.provider';
export type { DrizzleDatabase } from './db/drizzle.provider';
export { DrizzleModule } from './db/drizzle.module';

// ---------------------------------------------------------------------------
// NestJS module
// ---------------------------------------------------------------------------

export { DataPlatformModule } from './data-platform.module';