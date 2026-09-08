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
  SessionRepository,
  MerchantRegistryRepository,
  ClickCounterSnapshotRepository,
  ShopReportRepository,
  BlacklistRepository,
  CalculationOutcomeRepository,
  BlogPostRepository,
  NewsletterSubscriberRepository,
  ShareSnapshotRepository,
} from './abstracts';
import { PriceAlertRepository } from './repositories/d1/price-alert.repository';
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
import { DrizzleSessionRepository } from './repositories/session.repository';
import { DrizzleAuditEventRepository } from './repositories/audit-event.repository';
import { DrizzleMerchantRegistryRepository } from './repositories/merchant-registry.repository';
import { DrizzleClickCounterSnapshotRepository } from './repositories/click-counter-snapshot.repository';
import { CalculationRecordRetentionService } from './maintenance/calculation-record-retention.service';
import {
  MerchantReliabilityRepository,
  DrizzleMerchantReliabilityRepository,
} from './repositories/merchant-reliability.repository';
import { D1ShopReportRepository } from './repositories/d1/shop-report.repository';
import { D1BlacklistRepository } from './repositories/d1/blacklist.repository';
import { D1CalculationOutcomeRepository } from './repositories/d1/calculation-outcome.repository';
import { D1BlogPostRepository } from './repositories/d1/blog-post.repository';
import { D1NewsletterSubscriberRepository } from './repositories/d1/newsletter-subscriber.repository';
import {
  NewsletterNotificationRepository,
  D1NewsletterNotificationRepository,
} from './repositories/d1/newsletter-notification.repository';
import { D1ShareSnapshotRepository } from './repositories/d1/share-snapshot.repository';
import { D1PriceAlertRepository } from './repositories/d1/price-alert.repository';

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
    // Trust tables (task 1.3, change trust-and-reach-roadmap): shop
    // reports, blacklist entries, and user-reported calculation
    // outcomes — consumed by the moderation console and the public
    // accuracy statistic wired by later tasks.
    {
      provide: ShopReportRepository,
      useClass: D1ShopReportRepository,
    },
    {
      provide: BlacklistRepository,
      useClass: D1BlacklistRepository,
    },
    {
      provide: CalculationOutcomeRepository,
      useClass: D1CalculationOutcomeRepository,
    },
    // Content / share / newsletter repositories (task 1.4, change
    // trust-and-reach-roadmap): blog posts behind the publication gate,
    // double opt-in newsletter consent, and shareable frozen results —
    // plus the kind-aware alert contract (duplicate per product+kind).
    {
      provide: BlogPostRepository,
      useClass: D1BlogPostRepository,
    },
    {
      provide: NewsletterSubscriberRepository,
      useClass: D1NewsletterSubscriberRepository,
    },
    // Newsletter delivery intent log (task 5.3, change
    // trust-and-reach-roadmap) — the crash-safe send record behind the
    // ops notify-subscribers action.
    {
      provide: NewsletterNotificationRepository,
      useClass: D1NewsletterNotificationRepository,
    },
    {
      provide: ShareSnapshotRepository,
      useClass: D1ShareSnapshotRepository,
    },
    {
      provide: PriceAlertRepository,
      useClass: D1PriceAlertRepository,
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
    DrizzleSessionRepository,
    DrizzleMerchantRegistryRepository,
    DrizzleClickCounterSnapshotRepository,
    // Trust + content/share D1 repositories (tasks 1.3/1.4, change
    // trust-and-reach-roadmap)
    D1ShopReportRepository,
    D1BlacklistRepository,
    D1CalculationOutcomeRepository,
    D1BlogPostRepository,
    D1NewsletterSubscriberRepository,
    D1NewsletterNotificationRepository,
    D1ShareSnapshotRepository,
    D1PriceAlertRepository,
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
    SessionRepository,
    MerchantRegistryRepository,
    ClickCounterSnapshotRepository,
    // Trust repositories (task 1.3, change trust-and-reach-roadmap)
    ShopReportRepository,
    BlacklistRepository,
    CalculationOutcomeRepository,
    // Content / share / newsletter + kind-aware alert contracts
    // (task 1.4, change trust-and-reach-roadmap)
    BlogPostRepository,
    NewsletterSubscriberRepository,
    NewsletterNotificationRepository,
    ShareSnapshotRepository,
    PriceAlertRepository,
    DrizzleAuditEventRepository,
    CalculationRecordRetentionService,
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
    DrizzleSavedScenarioRepository,
    DrizzlePriceObservationRepository,
    DrizzlePriceHistorySummaryRepository,
    DrizzleAggregationWatermarkRepository,
    DrizzleMerchantTermsRepository,
    DrizzleBasketCalculationRecordRepository,
    DrizzleMerchantReliabilityRepository,
    DrizzleSessionRepository,
    DrizzleMerchantRegistryRepository,
    DrizzleClickCounterSnapshotRepository,
    // Trust + content/share D1 repositories (tasks 1.3/1.4, change
    // trust-and-reach-roadmap)
    D1ShopReportRepository,
    D1BlacklistRepository,
    D1CalculationOutcomeRepository,
    D1BlogPostRepository,
    D1NewsletterSubscriberRepository,
    D1NewsletterNotificationRepository,
    D1ShareSnapshotRepository,
    D1PriceAlertRepository,
  ],
})
export class DataPlatformModule {}