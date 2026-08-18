import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DataPlatformModule } from '@rajahinta/data-platform';

// ---------------------------------------------------------------------------
// Queue names — background jobs off the request path
// ---------------------------------------------------------------------------

export const QUEUES = {
  PRICE_INGESTION: 'price-ingestion',
  TRANSPORT_REFRESH: 'transport-refresh',
  TAX_DATASET_REVIEW: 'tax-dataset-review',
  TIME_SERIES_AGGREGATION: 'time-series-aggregation',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ---------------------------------------------------------------------------
// Abstract service contracts — concrete implementations registered in features
// ---------------------------------------------------------------------------

/**
 * Ingests product/price data from external merchant sources.
 * Runs as a queued BullMQ job to stay off the request path.
 * @deprecated Use {@link PipelineOrchestratorService} instead.
 */
export { PriceIngestionService } from './abstract/price-ingestion.service';

/**
 * Refreshes carrier transport rates periodically.
 * @deprecated Use {@link PipelineOrchestratorService} instead.
 */
export { TransportRateService } from './abstract/transport-rate.service';

/**
 * Checks for newly published official tax rate changes.
 * Rates are never auto-published — discoveries create a task for
 * manual/legal confirmation before any new dataset version goes live.
 */
export { TaxDatasetReviewService } from './abstract/tax-dataset-review.service';

// ---------------------------------------------------------------------------
// Pipeline services
// ---------------------------------------------------------------------------

export { PipelineOrchestratorService } from './services/pipeline-orchestrator.service';
export type { PipelineRunReport } from './services/pipeline-orchestrator.service';

export { FeedIngestionService } from './services/feed-ingestion.service';

export { DataMappingService } from './services/data-mapping.service';
export type { MappedPair } from './services/data-mapping.service';

export { DataQualityService } from './services/data-quality.service';
export { DataQualityModule } from './services/data-quality.module';
export type { DataQualityReport, QualityCheckOffer, OfferFreshnessResult } from './services/data-quality.service';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type { MerchantConfig } from './config/merchants.config';
export { DEFAULT_MERCHANTS, MERCHANT_CONFIG_TOKEN } from './config/merchants.config';

// ---------------------------------------------------------------------------
// Interfaces — cross-layer contracts
// ---------------------------------------------------------------------------

export type {
  IDataSourceRegistry,
  IPriceDataSource,
  ITransportRateDataSource,
  ITaxRateDataSource,
} from './interfaces/data-source.interface';
export type { IngestionResult, RateRefreshResult, PublishedRatesCheckResult } from './interfaces/data-source.interface';

export type { IFeedAdapter, RawFeedRecord } from './interfaces/feed-adapter.interface';
export { FEED_ADAPTERS_TOKEN } from './interfaces/feed-adapter.interface';

export { SystembolagetFeedAdapter } from './adapters/systembolaget.adapter';

export type { IUpsertRepository, UpsertProductInput, UpsertOfferInput, UpsertResult } from './interfaces/upsert-port.interface';
export { UPSERT_REPOSITORY_TOKEN } from './interfaces/upsert-port.interface';

export { DrizzleUpsertRepository } from './adapters/upsert-port.adapter';

// ---------------------------------------------------------------------------
// Rate review — scheduled checks, manual confirmation entries
// ---------------------------------------------------------------------------

export type { RateReviewResult, RateReviewEntry, RateReviewStatus, RateReviewResolution } from './interfaces/rate-review.types';

export type { IRateReviewRepository } from './interfaces/rate-review-repository.port';
export { RATE_REVIEW_REPOSITORY_PORT } from './interfaces/rate-review-repository.port';

export { RateReviewSchedulerService } from './services/rate-review-scheduler.service';
export type { RateReviewConfig } from './services/rate-review-scheduler.service';
export { RATE_REVIEW_CONFIG_TOKEN, DEFAULT_RATE_REVIEW_CONFIG } from './services/rate-review-scheduler.service';

export { RateReviewModule } from './services/rate-review.module';

// ---------------------------------------------------------------------------
// Imports for module registration
// ---------------------------------------------------------------------------

import { PipelineOrchestratorService } from './services/pipeline-orchestrator.service';
import { FeedIngestionService } from './services/feed-ingestion.service';
import { DataMappingService } from './services/data-mapping.service';
import { DataQualityService } from './services/data-quality.service';
import { PriceIngestionService } from './abstract/price-ingestion.service';
import { TransportRateService } from './abstract/transport-rate.service';
import { TaxDatasetReviewService } from './abstract/tax-dataset-review.service';
import { SourceGovernanceModule, ReliabilityModule } from '@rajahinta/core-domain';
import { RATE_REVIEW_REPOSITORY_PORT } from './interfaces/rate-review-repository.port';
import { RateReviewSchedulerService, RATE_REVIEW_CONFIG_TOKEN, DEFAULT_RATE_REVIEW_CONFIG } from './services/rate-review-scheduler.service';
import { MERCHANT_CONFIG_TOKEN, DEFAULT_MERCHANTS } from './config/merchants.config';
import { FEED_ADAPTERS_TOKEN } from './interfaces/feed-adapter.interface';
import { UPSERT_REPOSITORY_TOKEN } from './interfaces/upsert-port.interface';
import type { IFeedAdapter } from './interfaces/feed-adapter.interface';
import { SystembolagetFeedAdapter } from './adapters/systembolaget.adapter';
import { DrizzleUpsertRepository } from './adapters/upsert-port.adapter';
import { PipelinePriceIngestionAdapter } from './adapters/pipeline-price-ingestion.adapter';
import { PipelineTransportRateAdapter } from './adapters/pipeline-transport-rate.adapter';
import { PipelineTaxDatasetReviewAdapter } from './adapters/pipeline-tax-dataset-review.adapter';
import { InMemoryRateReviewRepository } from './adapters/rate-review-repository.adapter';

// ---------------------------------------------------------------------------
// NestJS module — registers Bull queues, exposes pipeline services
// ---------------------------------------------------------------------------

@Module({
  imports: [
    DataPlatformModule,
    SourceGovernanceModule,
    ReliabilityModule,
    BullModule.registerQueue(
      { name: QUEUES.PRICE_INGESTION },
      { name: QUEUES.TRANSPORT_REFRESH },
      { name: QUEUES.TAX_DATASET_REVIEW },
      { name: QUEUES.TIME_SERIES_AGGREGATION },
    ),
  ],
  providers: [
    // Concrete pipeline services
    PipelineOrchestratorService,
    FeedIngestionService,
    DataMappingService,
    DataQualityService,

    // Default merchant config — override at app level to provide real URLs
    { provide: MERCHANT_CONFIG_TOKEN, useValue: DEFAULT_MERCHANTS },

    // Feed adapters — registered as a Map keyed by merchantId
    SystembolagetFeedAdapter,
    {
      provide: FEED_ADAPTERS_TOKEN,
      useFactory: (systembolaget: SystembolagetFeedAdapter): Map<string, IFeedAdapter> => {
        const map = new Map<string, IFeedAdapter>();
        map.set(systembolaget.merchantId, systembolaget);
        return map;
      },
      inject: [SystembolagetFeedAdapter],
    },

    // Rate-review scheduler with default 24h interval
    RateReviewSchedulerService,
    { provide: RATE_REVIEW_CONFIG_TOKEN, useValue: DEFAULT_RATE_REVIEW_CONFIG },

    // Upsert repository — Drizzle-backed adapter
    DrizzleUpsertRepository,
    { provide: UPSERT_REPOSITORY_TOKEN, useClass: DrizzleUpsertRepository },

    // Rate-review repository port — in-memory adapter for Phase 1
    { provide: RATE_REVIEW_REPOSITORY_PORT, useClass: InMemoryRateReviewRepository },

    // Deprecated abstract services — wired to pipeline-backed concrete adapters
    { provide: PriceIngestionService, useClass: PipelinePriceIngestionAdapter },
    { provide: TransportRateService, useClass: PipelineTransportRateAdapter },
    { provide: TaxDatasetReviewService, useClass: PipelineTaxDatasetReviewAdapter },
  ],
  exports: [
    BullModule,
    PipelineOrchestratorService,
    FeedIngestionService,
    DataMappingService,
    DataQualityService,
    PriceIngestionService,
    TransportRateService,
    TaxDatasetReviewService,
    RateReviewSchedulerService,
    RATE_REVIEW_CONFIG_TOKEN,
    MERCHANT_CONFIG_TOKEN,
    FEED_ADAPTERS_TOKEN,
  ],
})
export class DataAcquisitionModule {}