// ---------------------------------------------------------------------------
// Drizzle schema definitions — sourced from ./schema.ts
// ---------------------------------------------------------------------------

export {
  productMaster,
  retailOffers,
  taxRules,
  transportOffers,
  calculationRecords,
} from './schema';

// ---------------------------------------------------------------------------
// Repository abstractions — sourced from ./abstracts.ts
// ---------------------------------------------------------------------------

export {
  ProductRepository,
  TaxRateRepository,
  TransportOfferRepository,
  CalculationRecordRepository,
} from './abstracts';

// ---------------------------------------------------------------------------
// Concrete repository implementations — Drizzle-based
// ---------------------------------------------------------------------------

export { DrizzleProductRepository } from './repositories/product.repository';
export { DrizzleTaxRateRepository, TaxRuleRepositoryAdapter } from './repositories/tax-rate.repository';
export { DrizzleTransportOfferRepository } from './repositories/transport-offer.repository';
export { DrizzleCalculationRecordRepository } from './repositories/calculation-record.repository';

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
// Drizzle connection provider
// ---------------------------------------------------------------------------

export { DRIZZLE, DrizzleProvider } from './db/drizzle.provider';
export type { DrizzleDatabase } from './db/drizzle.provider';
export { DrizzleModule } from './db/drizzle.module';

// ---------------------------------------------------------------------------
// NestJS module
// ---------------------------------------------------------------------------

export { DataPlatformModule } from './data-platform.module';