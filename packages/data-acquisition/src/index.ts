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
  FX_DATASET_REVIEW: 'fx-dataset-review',
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
export type { TransportRateRefreshResult } from './abstract/transport-rate.service';

/**
 * Checks for newly published official tax rate changes.
 * Rates are never auto-published — discoveries create a task for
 * manual/legal confirmation before any new dataset version goes live.
 */
export { TaxDatasetReviewService } from './abstract/tax-dataset-review.service';

/**
 * Checks a configurable FX source (ECB reference rates default) for
 * newly available rates and creates a PENDING_CONFIRMATION dataset —
 * the confirmation task. Never auto-publishes (task 1.3, design D2).
 */
export { FxDatasetReviewService } from './services/fx-dataset-review.service';
export type { FxDatasetReviewResult } from './services/fx-dataset-review.service';

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
// Config — merchant source shape derived from the database-backed
// merchant registry (task 7.2/7.3, design D7; static config deleted)
// ---------------------------------------------------------------------------

export type { MerchantConfig } from './interfaces/merchant-config.interface';
export { merchantConfigFromRegistry } from './interfaces/merchant-config.interface';

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
export { AlkoFeedAdapter, parseAlkoAssortment } from './adapters/alko.adapter';

export type { IUpsertRepository, UpsertProductInput, UpsertOfferInput, UpsertResult, UpsertOfferResult } from './interfaces/upsert-port.interface';
export { UPSERT_REPOSITORY_TOKEN } from './interfaces/upsert-port.interface';

// Offer-change hook — invoked by the pipeline once per changed offer; the
// composition root binds the price-observation recorder to it (change
// 2026-08-26-phase2-historical-price-intelligence, task 2.2).
export type { IOfferChangeHook, ChangedOfferEvent } from './interfaces/offer-change-hook.interface';
export { OFFER_CHANGE_HOOK_TOKEN } from './interfaces/offer-change-hook.interface';

export { DrizzleUpsertRepository } from './adapters/upsert-port.adapter';

// ---------------------------------------------------------------------------
// Transport-rate refresh — real carrier sources through the governance
// gate (task 7.4, design D6 — Posti first)
// ---------------------------------------------------------------------------

export type {
  ICarrierRateSource,
  CarrierRateOffer,
} from './interfaces/carrier-rate-source.port';
export { CARRIER_RATE_SOURCES_TOKEN, POSTI_RATE_FEED_URL } from './interfaces/carrier-rate-source.port';

export type {
  ITransportOfferWritePort,
  TransportOfferWrite,
  TransportReliabilityStatus,
} from './interfaces/transport-offer-write.port';
export { TRANSPORT_OFFER_WRITE_PORT } from './interfaces/transport-offer-write.port';

export {
  PostiCarrierRateSource,
  parsePostiRates,
} from './adapters/posti-rate.source';
export type { RateFeedFetcher } from './adapters/posti-rate.source';

export { DrizzleTransportOfferWriteAdapter } from './adapters/transport-offer-write.adapter';

// ---------------------------------------------------------------------------
// FX rate source + dataset review — configurable source (ECB reference
// rates default), governed dataset workflow (task 1.3, design D2)
// ---------------------------------------------------------------------------

export type {
  FxRateSnapshot,
  IFxRateSource,
} from './interfaces/fx-rate-source.port';
export {
  FX_RATE_SOURCE_PORT,
  FX_RATE_SOURCE_URL_TOKEN,
  FX_RATE_SOURCE_URL_DEFAULT,
} from './interfaces/fx-rate-source.port';

export {
  EcbReferenceRateSource,
  parseEcbReferenceRates,
} from './adapters/ecb-rate.source';
export type { FxRateFetcher } from './adapters/ecb-rate.source';

// ---------------------------------------------------------------------------
// Rate review — scheduled checks, manual confirmation entries
// ---------------------------------------------------------------------------

export type { RateReviewResult, RateReviewEntry, RateReviewStatus, RateReviewResolution } from './interfaces/rate-review.types';

export type { IRateReviewRepository, RateChangeSourcePort } from './interfaces/rate-review-repository.port';
export { RATE_REVIEW_REPOSITORY_PORT, RATE_CHANGE_SOURCE_PORT } from './interfaces/rate-review-repository.port';

export { RateReviewSchedulerService, ConfigBackedRateChangeSource } from './services/rate-review-scheduler.service';
export type { RateReviewConfig } from './services/rate-review-scheduler.service';
export { RATE_REVIEW_CONFIG_TOKEN, DEFAULT_RATE_REVIEW_CONFIG, RATE_CHANGE_SOURCE_CONFIG_TOKEN, DEFAULT_RATE_CHANGE_SOURCE_CONFIG } from './services/rate-review-scheduler.service';

export { RateReviewModule } from './services/rate-review.module';

// ---------------------------------------------------------------------------
// Imports for module registration
// ---------------------------------------------------------------------------

import { PipelineOrchestratorService } from './services/pipeline-orchestrator.service';
import { FeedIngestionService } from './services/feed-ingestion.service';
import { DataMappingService } from './services/data-mapping.service';
import { DataQualityService } from './services/data-quality.service';
import { ContentLintService } from './content/content-lint.service';
import { PriceIngestionService } from './abstract/price-ingestion.service';
import { TransportRateService } from './abstract/transport-rate.service';
import { TaxDatasetReviewService } from './abstract/tax-dataset-review.service';
import { SourceGovernanceModule, ReliabilityModule, FxRateDatasetService } from '@rajahinta/core-domain';
import { RATE_REVIEW_REPOSITORY_PORT, RATE_CHANGE_SOURCE_PORT } from './interfaces/rate-review-repository.port';
import { RateReviewSchedulerService, ConfigBackedRateChangeSource, RATE_REVIEW_CONFIG_TOKEN, RATE_CHANGE_SOURCE_CONFIG_TOKEN, DEFAULT_RATE_REVIEW_CONFIG, DEFAULT_RATE_CHANGE_SOURCE_CONFIG } from './services/rate-review-scheduler.service';
import { FEED_ADAPTERS_TOKEN } from './interfaces/feed-adapter.interface';
import { UPSERT_REPOSITORY_TOKEN } from './interfaces/upsert-port.interface';
import type { IFeedAdapter } from './interfaces/feed-adapter.interface';
import { SystembolagetFeedAdapter } from './adapters/systembolaget.adapter';
import { AlkoFeedAdapter } from './adapters/alko.adapter';
import { DrizzleUpsertRepository } from './adapters/upsert-port.adapter';
import { PipelinePriceIngestionAdapter } from './adapters/pipeline-price-ingestion.adapter';
import { PipelineTransportRateAdapter } from './adapters/pipeline-transport-rate.adapter';
import { PipelineTaxDatasetReviewAdapter } from './adapters/pipeline-tax-dataset-review.adapter';
import { InMemoryRateReviewRepository } from './adapters/rate-review-repository.adapter';
import { PostiCarrierRateSource } from './adapters/posti-rate.source';
import { DrizzleTransportOfferWriteAdapter } from './adapters/transport-offer-write.adapter';
import { CARRIER_RATE_SOURCES_TOKEN } from './interfaces/carrier-rate-source.port';
import { TRANSPORT_OFFER_WRITE_PORT } from './interfaces/transport-offer-write.port';
import type { ICarrierRateSource } from './interfaces/carrier-rate-source.port';
import { EcbReferenceRateSource } from './adapters/ecb-rate.source';
import { FX_RATE_SOURCE_PORT, FX_RATE_SOURCE_URL_TOKEN, FX_RATE_SOURCE_URL_DEFAULT } from './interfaces/fx-rate-source.port';
import { FxDatasetReviewService } from './services/fx-dataset-review.service';

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
      { name: QUEUES.FX_DATASET_REVIEW },
    ),
  ],
  providers: [
    // Concrete pipeline services
    PipelineOrchestratorService,
    FeedIngestionService,
    DataMappingService,
    DataQualityService,
    ContentLintService,

    // Feed adapters — registered as a Map keyed by merchantId.
    // Alko joins Systembolaget (task 7.5, design D6/D7): the domestic
    // reference merchant through the same adapter surface and
    // governance gate. Its registry row keeps an empty feedUrl until a
    // live feed is entitled — the golden fixture pins the parser.
    SystembolagetFeedAdapter,
    AlkoFeedAdapter,
    {
      provide: FEED_ADAPTERS_TOKEN,
      useFactory: (
        systembolaget: SystembolagetFeedAdapter,
        alko: AlkoFeedAdapter,
      ): Map<string, IFeedAdapter> => {
        const map = new Map<string, IFeedAdapter>();
        map.set(systembolaget.merchantId, systembolaget);
        map.set(alko.merchantId, alko);
        return map;
      },
      inject: [SystembolagetFeedAdapter, AlkoFeedAdapter],
    },

    // Rate-review scheduler with default 24h interval
    RateReviewSchedulerService,
    { provide: RATE_REVIEW_CONFIG_TOKEN, useValue: DEFAULT_RATE_REVIEW_CONFIG },

    // Rate-change source — config-backed default (no snapshot = no detection)
    { provide: RATE_CHANGE_SOURCE_PORT, useClass: ConfigBackedRateChangeSource },
    { provide: RATE_CHANGE_SOURCE_CONFIG_TOKEN, useValue: DEFAULT_RATE_CHANGE_SOURCE_CONFIG },

    // Upsert repository — Drizzle-backed adapter
    DrizzleUpsertRepository,
    { provide: UPSERT_REPOSITORY_TOKEN, useClass: DrizzleUpsertRepository },

    // Transport-rate refresh (task 7.4) — carrier sources keyed by
    // carrierId (Posti first, design D6), the transport-offer write
    // port, and the governance-gated refresh service behind the
    // TransportRateService slot.
    PostiCarrierRateSource,
    {
      provide: CARRIER_RATE_SOURCES_TOKEN,
      useFactory: (posti: PostiCarrierRateSource): Map<string, ICarrierRateSource> => {
        const map = new Map<string, ICarrierRateSource>();
        map.set(posti.carrierId, posti);
        return map;
      },
      inject: [PostiCarrierRateSource],
    },
    DrizzleTransportOfferWriteAdapter,
    { provide: TRANSPORT_OFFER_WRITE_PORT, useClass: DrizzleTransportOfferWriteAdapter },

    // Rate-review repository port — in-memory adapter for Phase 1
    { provide: RATE_REVIEW_REPOSITORY_PORT, useClass: InMemoryRateReviewRepository },

    // FX dataset review (task 1.3, design D2) — the domain service is
    // provided HERE so its FX_RATE_DATASET_REPOSITORY_PORT injectable
    // resolves from DataPlatformModule's exported Drizzle-backed
    // adapter (TAX_RULE_REPOSITORY_PORT precedent). The configurable
    // source defaults to ECB reference rates; nothing auto-publishes.
    FxRateDatasetService,
    EcbReferenceRateSource,
    { provide: FX_RATE_SOURCE_PORT, useClass: EcbReferenceRateSource },
    { provide: FX_RATE_SOURCE_URL_TOKEN, useValue: FX_RATE_SOURCE_URL_DEFAULT },
    FxDatasetReviewService,

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
    ContentLintService,
    PriceIngestionService,
    TransportRateService,
    TaxDatasetReviewService,
    RateReviewSchedulerService,
    RATE_REVIEW_CONFIG_TOKEN,
    // Re-exported so the jobs scheduler (task 7.3) can run the same
    // fail-closed governance permission check the pipeline gates on.
    SourceGovernanceModule,
    FEED_ADAPTERS_TOKEN,
    CARRIER_RATE_SOURCES_TOKEN,
    TRANSPORT_OFFER_WRITE_PORT,
    FxDatasetReviewService,
    FX_RATE_SOURCE_PORT,
    FxRateDatasetService,
  ],
})
export class DataAcquisitionModule {}