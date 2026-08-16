import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

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

export type { IUpsertRepository, UpsertProductInput, UpsertOfferInput, UpsertResult } from './interfaces/upsert-port.interface';
export { UPSERT_REPOSITORY_TOKEN } from './interfaces/upsert-port.interface';

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
import { RateReviewSchedulerService, RATE_REVIEW_CONFIG_TOKEN, DEFAULT_RATE_REVIEW_CONFIG } from './services/rate-review-scheduler.service';
import { MERCHANT_CONFIG_TOKEN, DEFAULT_MERCHANTS } from './config/merchants.config';
import { FEED_ADAPTERS_TOKEN } from './interfaces/feed-adapter.interface';

// ---------------------------------------------------------------------------
// NestJS module — registers Bull queues, exposes pipeline services
// ---------------------------------------------------------------------------

@Module({
  imports: [
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

    // Feed adapters multi-provider (empty by default; populated by merchant features)
    { provide: FEED_ADAPTERS_TOKEN, useValue: new Map<string, import('./interfaces/feed-adapter.interface').IFeedAdapter>() },

    // Rate-review scheduler with default 24h interval
    RateReviewSchedulerService,
    { provide: RATE_REVIEW_CONFIG_TOKEN, useValue: DEFAULT_RATE_REVIEW_CONFIG },
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