/**
 * DataPlatform Module — NestJS module that registers all concrete Drizzle
 * repository implementations and exports them under their abstract class
 * injection tokens.
 *
 * Also registers the {@code TaxRuleRepositoryAdapter} under the
 * {@code TAX_RULE_REPOSITORY_PORT} token consumed by core-domain services.
 *
 * ## Usage
 *
 * ```typescript
 * import { DataPlatformModule } from '@rajahinta/data-platform';
 *
 * @Module({ imports: [DataPlatformModule] })
 * export class AppModule {}
 * ```
 *
 * @module DataPlatformModule
 */
import { Module } from '@nestjs/common';
import { TAX_RULE_REPOSITORY_PORT, CORRECTION_REPOSITORY_PORT } from '@rajahinta/core-domain';
import { DrizzleModule } from './db/drizzle.module';
import {
  ProductRepository,
  TaxRateRepository,
  TransportOfferRepository,
  CalculationRecordRepository,
  AccountRepository,
  SavedBasketRepository,
  PriceObservationRepository,
  PriceHistorySummaryRepository,
} from './abstracts';
import { DrizzleProductRepository } from './repositories/product.repository';
import { DrizzleTaxRateRepository } from './repositories/tax-rate.repository';
import { DrizzleTransportOfferRepository } from './repositories/transport-offer.repository';
import { DrizzleCalculationRecordRepository } from './repositories/calculation-record.repository';
import { TaxRuleRepositoryAdapter } from './repositories/tax-rate.repository';
import { DrizzleCorrectionRepository } from './repositories/correction.repository';
import { DrizzleAccountRepository } from './repositories/account.repository';
import { DrizzleSavedBasketRepository } from './repositories/saved-basket.repository';
import { DrizzlePriceObservationRepository } from './repositories/price-observation.repository';
import { DrizzlePriceHistorySummaryRepository } from './repositories/price-history-summary.repository';

@Module({
  imports: [DrizzleModule],
  providers: [
    // Concrete repositories registered under their abstract class tokens
    {
      provide: ProductRepository,
      useClass: DrizzleProductRepository,
    },
    {
      provide: TaxRateRepository,
      useClass: DrizzleTaxRateRepository,
    },
    {
      provide: TransportOfferRepository,
      useClass: DrizzleTransportOfferRepository,
    },
    {
      provide: CalculationRecordRepository,
      useClass: DrizzleCalculationRecordRepository,
    },
    // Domain-port adapter for tax rule lookup
    {
      provide: TAX_RULE_REPOSITORY_PORT,
      useClass: TaxRuleRepositoryAdapter,
    },
    // Domain-port adapter for correction (stub — no DB schema yet)
    {
      provide: CORRECTION_REPOSITORY_PORT,
      useClass: DrizzleCorrectionRepository,
    },
    // Account and saved-basket repositories
    {
      provide: AccountRepository,
      useClass: DrizzleAccountRepository,
    },
    {
      provide: SavedBasketRepository,
      useClass: DrizzleSavedBasketRepository,
    },
    // Append-only price-observation log. NOT registered under the domain
    // PRICE_OBSERVATION_PORT here — that wiring belongs to the composition
    // root (change 2026-08-26-phase2-historical-price-intelligence, task 2.2).
    {
      provide: PriceObservationRepository,
      useClass: DrizzlePriceObservationRepository,
    },
    // Materialized daily/weekly chart aggregates — written by the
    // time-series aggregation worker (task 3.1), read by the
    // historical-data API (task 4.1) of change
    // 2026-08-26-phase2-historical-price-intelligence.
    {
      provide: PriceHistorySummaryRepository,
      useClass: DrizzlePriceHistorySummaryRepository,
    },
    // Also register the concrete classes directly (they are @Injectable)
    DrizzleProductRepository,
    DrizzleTaxRateRepository,
    DrizzleTransportOfferRepository,
    DrizzleCalculationRecordRepository,
    TaxRuleRepositoryAdapter,
    DrizzleCorrectionRepository,
    DrizzleAccountRepository,
    DrizzleSavedBasketRepository,
    DrizzlePriceObservationRepository,
    DrizzlePriceHistorySummaryRepository,
  ],
  exports: [
    // Abstract class tokens — inject by abstract class for loose coupling
    ProductRepository,
    TaxRateRepository,
    TransportOfferRepository,
    CalculationRecordRepository,
    AccountRepository,
    SavedBasketRepository,
    PriceObservationRepository,
    PriceHistorySummaryRepository,
    // Domain-port adapter tokens
    TAX_RULE_REPOSITORY_PORT,
    CORRECTION_REPOSITORY_PORT,
    // Concrete implementations — inject directly when needed
    DrizzleProductRepository,
    DrizzleTaxRateRepository,
    DrizzleTransportOfferRepository,
    DrizzleCalculationRecordRepository,
    TaxRuleRepositoryAdapter,
    DrizzleCorrectionRepository,
    DrizzleAccountRepository,
    DrizzleSavedBasketRepository,
    DrizzlePriceObservationRepository,
    DrizzlePriceHistorySummaryRepository,
  ],
})
export class DataPlatformModule {}