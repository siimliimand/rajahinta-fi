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
import {
  TAX_RULE_REPOSITORY_PORT,
  CORRECTION_REPOSITORY_PORT,
  FX_RATE_DATASET_REPOSITORY_PORT,
} from '@rajahinta/core-domain';
import { DrizzleModule } from './db/drizzle.module';
import {
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
import { DrizzleProductRepository } from './repositories/product.repository';
import { DrizzleTaxRateRepository } from './repositories/tax-rate.repository';
import { DrizzleTransportOfferRepository } from './repositories/transport-offer.repository';
import { DrizzleCalculationRecordRepository } from './repositories/calculation-record.repository';
import { TaxRuleRepositoryAdapter } from './repositories/tax-rate.repository';
import { DrizzleCorrectionRepository } from './repositories/correction.repository';
import { DrizzleAccountRepository } from './repositories/account.repository';
import { DrizzleSavedBasketRepository } from './repositories/saved-basket.repository';
import { DrizzleSavedScenarioRepository } from './repositories/saved-scenario.repository';
import { DrizzlePriceObservationRepository } from './repositories/price-observation.repository';
import { DrizzlePriceHistorySummaryRepository } from './repositories/price-history-summary.repository';
import { DrizzleAggregationWatermarkRepository } from './repositories/aggregation-watermark.repository';
import { DrizzleMerchantTermsRepository } from './repositories/merchant-terms.repository';
import { DrizzleBasketCalculationRecordRepository } from './repositories/basket-calculation-record.repository';
import { DrizzleFxRateRepository } from './repositories/fx-rate.repository';
import { FxRateDatasetRepositoryAdapter } from './repositories/fx-rate-port.adapter';
import { DrizzleSessionRepository } from './repositories/session.repository';
import { DrizzleAuditEventRepository } from './repositories/audit-event.repository';
import { DrizzleMerchantRegistryRepository } from './repositories/merchant-registry.repository';
import { DrizzleClickCounterSnapshotRepository } from './repositories/click-counter-snapshot.repository';
import { CalculationRecordRetentionService } from './maintenance/calculation-record-retention.service';
import {
  MerchantReliabilityRepository,
  DrizzleMerchantReliabilityRepository,
} from './repositories/merchant-reliability.repository';

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
    // Saved scenarios — named calculator input sets (upsert-by-name),
    // consumed by the scenario endpoints of change phase2-advanced-features
    // (task 3.1).
    {
      provide: SavedScenarioRepository,
      useClass: DrizzleSavedScenarioRepository,
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
    // Persisted incremental-scan cursors — written by the time-series
    // aggregation worker (task 3.1 of change
    // 2026-08-26-phase2-historical-price-intelligence) after successful
    // summary writes.
    {
      provide: AggregationWatermarkRepository,
      useClass: DrizzleAggregationWatermarkRepository,
    },
    // Merchant terms — store-level minimum order thresholds with
    // reliability and timestamp provenance.
    {
      provide: MerchantTermsRepository,
      useClass: DrizzleMerchantTermsRepository,
    },
    // Basket calculation records — multi-product optimizer results.
    {
      provide: BasketCalculationRecordRepository,
      useClass: DrizzleBasketCalculationRecordRepository,
    },
    // Merchant reliability aggregates — factual per-merchant counts over
    // current retail offers, consumed by the reliability score service
    // and API of change phase2-advanced-features (tasks 2.1/3.4).
    {
      provide: MerchantReliabilityRepository,
      useClass: DrizzleMerchantReliabilityRepository,
    },
    // Versioned FX rate datasets (task 1.1, change
    // technical-assessment-remediation) — append-only, manual-confirm
    // publication; consumed by the FX domain service (task 1.2).
    {
      provide: FxRateRepository,
      useClass: DrizzleFxRateRepository,
    },
    // Domain-port adapter for FX-rate datasets (task 1.3) — binds the
    // Drizzle repository onto the core-domain FX port following the
    // TAX_RULE_REPOSITORY_PORT precedent above. Consumers (the FX
    // ingestion job, the Systembolaget conversion at ingestion) inject
    // FX_RATE_DATASET_REPOSITORY_PORT / FxRateDatasetService via this
    // export.
    {
      provide: FX_RATE_DATASET_REPOSITORY_PORT,
      useClass: FxRateDatasetRepositoryAdapter,
    },
    // Server-issued opaque session tokens, hashed at rest (task 2.1) —
    // consumed by SessionTokenService in application-api/accounts; the
    // auth-guard migration itself is task 2.2.
    {
      provide: SessionRepository,
      useClass: DrizzleSessionRepository,
    },
    // Durable append-only audit log (task 4.2) — bound to the
    // AUDIT_REPOSITORY_PORT by the application-api AuditModule.
    DrizzleAuditEventRepository,
    // Database-backed merchant feed registry (task 7.2) — the scheduler
    // reads it per-merchant in task 7.3.
    {
      provide: MerchantRegistryRepository,
      useClass: DrizzleMerchantRegistryRepository,
    },
    // Durable archive of the Redis click counters (task 4.3) — written
    // by the periodic snapshot service in application-api/audit.
    {
      provide: ClickCounterSnapshotRepository,
      useClass: DrizzleClickCounterSnapshotRepository,
    },
    // Monthly-partition maintenance + anonymous-record retention
    // (task 8.1) — driven by the retention cron worker in jobs.
    CalculationRecordRetentionService,
    // Also register the concrete classes directly (they are @Injectable)
    DrizzleProductRepository,
    DrizzleTaxRateRepository,
    DrizzleTransportOfferRepository,
    DrizzleCalculationRecordRepository,
    TaxRuleRepositoryAdapter,
    DrizzleCorrectionRepository,
    DrizzleAccountRepository,
    DrizzleSavedBasketRepository,
    DrizzleSavedScenarioRepository,
    DrizzlePriceObservationRepository,
    DrizzlePriceHistorySummaryRepository,
    DrizzleAggregationWatermarkRepository,
    DrizzleMerchantTermsRepository,
    DrizzleBasketCalculationRecordRepository,
    DrizzleMerchantReliabilityRepository,
    DrizzleFxRateRepository,
    FxRateDatasetRepositoryAdapter,
    DrizzleSessionRepository,
    DrizzleMerchantRegistryRepository,
    DrizzleClickCounterSnapshotRepository,
  ],
  exports: [
    // Abstract class tokens — inject by abstract class for loose coupling
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
    MerchantReliabilityRepository,
    FxRateRepository,
    SessionRepository,
    MerchantRegistryRepository,
    ClickCounterSnapshotRepository,
    DrizzleAuditEventRepository,
    CalculationRecordRetentionService,
    // Domain-port adapter tokens
    TAX_RULE_REPOSITORY_PORT,
    CORRECTION_REPOSITORY_PORT,
    FX_RATE_DATASET_REPOSITORY_PORT,
    // Concrete implementations — inject directly when needed
    DrizzleProductRepository,
    DrizzleTaxRateRepository,
    DrizzleTransportOfferRepository,
    DrizzleCalculationRecordRepository,
    TaxRuleRepositoryAdapter,
    DrizzleCorrectionRepository,
    DrizzleAccountRepository,
    DrizzleSavedBasketRepository,
    DrizzleSavedScenarioRepository,
    DrizzlePriceObservationRepository,
    DrizzlePriceHistorySummaryRepository,
    DrizzleAggregationWatermarkRepository,
    DrizzleMerchantTermsRepository,
    DrizzleBasketCalculationRecordRepository,
    DrizzleMerchantReliabilityRepository,
    DrizzleFxRateRepository,
    FxRateDatasetRepositoryAdapter,
    DrizzleSessionRepository,
    DrizzleMerchantRegistryRepository,
    DrizzleClickCounterSnapshotRepository,
  ],
})
export class DataPlatformModule {}