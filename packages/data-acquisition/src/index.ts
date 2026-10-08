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
export type { TransportRateRefreshResult } from './abstract/transport-rate.service';

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

// Conservative brand derivation from the feed display name — populates
// product_master.brand when (as today) no feed carries one; the values
// feed the did-you-mean brand vocabulary (task 3.2) and bm25 brand
// ranking. Also consumed by scripts/backfill-brand.mts for the
// lead-sequenced production backfill (kept import-free so the script
// can load it under node --experimental-strip-types).
export { deriveBrand } from './services/derive-brand';

// Feed display-text entity decoder — reused by the entity backfill
// (scripts/seed-d1.ts) so persisted rows decode with the same rules
// ingestion used.
export { decodeHtmlEntities } from './services/html-entities';

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

export { AlkoFeedAdapter, parseAlkoAssortment } from './adapters/alko.adapter';

export { AlksFeedAdapter } from './adapters/alks.adapter';
export { parseAlksStoreProducts } from './adapters/alks.parser';

// longero.fi Store API adapter — thin subclass of the shared WooCommerce
// Store API walk (woo-store.adapter) reusing parseAlksStoreProducts
// (task 2.1 change onboard-longero-merchant; generalized in task 2.2
// change onboard-kippis-merchant). Composition (adapter maps) is wired
// in the api-worker compositions, not here.
export { LongeroFeedAdapter } from './adapters/longero.adapter';

// kippis.net Store API adapter — the third WooCommerce merchant that
// triggered the shared walk extraction (task 2.2, change
// onboard-kippis-merchant).
export { KippisFeedAdapter } from './adapters/kippis.adapter';

// mydrink.ee Store API adapter — the fourth WooCommerce merchant
// (task 2.1, change onboard-mydrink-merchant): a thin subclass of the
// shared walk; the Estonian category vocabulary it consumes was mapped
// additively in task 1.2.
export { MydrinkFeedAdapter } from './adapters/mydrink.adapter';

// araxes.ee Store API adapter — the fifth WooCommerce merchant
// (task 2.1, change onboard-araxes-merchant): a thin subclass of the
// shared walk; the bare-spelling Estonian category vocabulary it
// consumes was mapped additively in task 1.2. Composition (adapter
// maps) is wired in the api-worker compositions, not here.
export { AraxesFeedAdapter } from './adapters/araxes.adapter';

// ---------------------------------------------------------------------------
// Sitemap crawl sources (change sitemap-crawl-merchants) — one shared
// cycle (sitemap once → product-URL filter → lastmod diff → polite walk →
// watermark save) over one shared extractor, behind IFeedAdapter; the four
// v1 merchants pin only merchantId + extractor config + URL predicate +
// refresh mode.
// ---------------------------------------------------------------------------

export {
  SitemapCrawlFeedAdapter,
  InMemoryLastmodWatermarkStore,
} from './adapters/sitemap-crawl.adapter';
export type {
  SitemapCrawlOptions,
  SitemapCrawlWiring,
} from './adapters/sitemap-crawl.adapter';

export {
  ViinarannastaFeedAdapter,
  VIINARANNASTA_PRODUCT_URL_PATTERN,
} from './adapters/viinarannasta.adapter';
export {
  ViinikauppaFeedAdapter,
  VIINIKAUPPA_PRODUCT_URL_PATTERN,
} from './adapters/viinikauppa.adapter';
export {
  LicoreaFeedAdapter,
  LICOREA_PRODUCT_URL_PATTERN,
} from './adapters/licorea.adapter';
export {
  DrinkonlineFeedAdapter,
  DRINKONLINE_PRODUCT_URL_PATTERN,
} from './adapters/drinkonline.adapter';

export { runCrawlCycle } from './crawl/crawl-cycle';
export type { CrawlCycleOptions } from './crawl/crawl-cycle';
export {
  CRAWL_CHUNK_FETCHES,
  InMemoryCrawlCursorStore,
} from './crawl/crawl-chunk-cycle';
export type {
  CrawlCursorState,
  CrawlChunkOutcome,
  CrawlDiscoverOutcome,
  ICrawlCursorStore,
} from './crawl/crawl-chunk-cycle';
export {
  advanceCrawlCursor,
  beginCrawlCycle,
  walkCrawlChunk,
} from './crawl/crawl-chunk-cycle';
export {
  walkProductPages,
  CRAWLER_USER_AGENT,
  MIN_REQUEST_SPACING_MS,
  defaultSleep,
  defaultPageFetcher,
} from './crawl/crawl-walker';
export type {
  PageFetcher,
  PageProcessor,
  PageWalkOptions,
  PageWalkResult,
  CrawlPageOutcome,
  Sleep,
} from './crawl/crawl-walker';
export type { ILastmodWatermarkStore } from './crawl/lastmod-watermark.port';
export type { SitemapWatermark, SitemapDiffConfig, SitemapDiffResult } from './crawl/lastmod-diff';
export { diffSitemapEntries } from './crawl/lastmod-diff';
export { filterSitemapEntries, urlPatternPredicate } from './crawl/product-url-filter';
export type { ProductUrlPredicate } from './crawl/product-url-filter';
export { fetchSitemap } from './crawl/sitemap.fetch';
export type { SitemapFetchResult } from './crawl/sitemap.fetch';
export { parseSitemapXml } from './crawl/sitemap.parse';
export type { SitemapEntry } from './crawl/sitemap.parse';
export { extractProductPage } from './crawl/extract/extract-page';
export type { PageExtraction } from './crawl/extract/extract-page';
export type { ExtractorConfig } from './crawl/extract/extractor-config';
export {
  abvPercentFromFinnishDescription,
  DRINKONLINE_EXTRACTOR_CONFIG,
  LICOREA_EXTRACTOR_CONFIG,
  VIINARANNASTA_EXTRACTOR_CONFIG,
  VIINIKAUPPA_EXTRACTOR_CONFIG,
} from './crawl/extract/source-configs';

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
export { CARRIER_RATE_SOURCES_TOKEN } from './interfaces/carrier-rate-source.port';

export type {
  ITransportOfferWritePort,
  TransportOfferWrite,
  TransportReliabilityStatus,
} from './interfaces/transport-offer-write.port';
export { TRANSPORT_OFFER_WRITE_PORT } from './interfaces/transport-offer-write.port';

// Posti — manually curated dataset source (the price-list JSON endpoint
// is CDN-blocked for datacenter/Cloudflare egress; see the module
// docblock). Ingestion is owned by the api-worker's monthly curated
// sync cron, NOT the CARRIER_RATE_SOURCES map below.
export { PostiCarrierRateSource, buildPostiRates, POSTI_OBSERVED_AT } from './adapters/posti-rate.source';

// Fransberg (fransberg.eu) — manually curated dataset source (no live
// feed to fetch). Ingestion is owned by the api-worker's monthly
// curated-rate-refresh cron, NOT the CARRIER_RATE_SOURCES map below:
// that map feeds the '*' wildcard refresh, which would re-append the
// static dataset every six hours.
export {
  FransbergCarrierRateSource,
  buildFransbergRates,
  FRANSBERG_OBSERVED_AT,
  FRANSBERG_MAX_PARCEL_KG,
  FRANSBERG_PALLET_KG,
} from './adapters/fransberg-rate.source';

// Omniva (omniva.ee) — manually curated dataset source (the
// international-parcel price list for private customers is a PDF; see
// the module docblock). Ingestion is owned by the api-worker's monthly
// curated-rate-refresh cron, NOT the CARRIER_RATE_SOURCES map below.
export {
  OmnivaCarrierRateSource,
  buildOmnivaRates,
  OMNIVA_OBSERVED_AT,
} from './adapters/omniva-rate.source';

export { DrizzleTransportOfferWriteAdapter } from './adapters/transport-offer-write.adapter';

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
import { SourceGovernanceModule, ReliabilityModule } from '@rajahinta/core-domain';
import { RATE_REVIEW_REPOSITORY_PORT, RATE_CHANGE_SOURCE_PORT } from './interfaces/rate-review-repository.port';
import { RateReviewSchedulerService, ConfigBackedRateChangeSource, RATE_REVIEW_CONFIG_TOKEN, RATE_CHANGE_SOURCE_CONFIG_TOKEN, DEFAULT_RATE_REVIEW_CONFIG, DEFAULT_RATE_CHANGE_SOURCE_CONFIG } from './services/rate-review-scheduler.service';
import { FEED_ADAPTERS_TOKEN } from './interfaces/feed-adapter.interface';
import { UPSERT_REPOSITORY_TOKEN } from './interfaces/upsert-port.interface';
import type { IFeedAdapter } from './interfaces/feed-adapter.interface';
import { AlkoFeedAdapter } from './adapters/alko.adapter';
import { AlksFeedAdapter } from './adapters/alks.adapter';
import { DrinkonlineFeedAdapter } from './adapters/drinkonline.adapter';
import { LicoreaFeedAdapter } from './adapters/licorea.adapter';
import { ViinarannastaFeedAdapter } from './adapters/viinarannasta.adapter';
import { ViinikauppaFeedAdapter } from './adapters/viinikauppa.adapter';
import { DrizzleUpsertRepository } from './adapters/upsert-port.adapter';
import { PipelinePriceIngestionAdapter } from './adapters/pipeline-price-ingestion.adapter';
import { PipelineTransportRateAdapter } from './adapters/pipeline-transport-rate.adapter';
import { PipelineTaxDatasetReviewAdapter } from './adapters/pipeline-tax-dataset-review.adapter';
import { InMemoryRateReviewRepository } from './adapters/rate-review-repository.adapter';
import { DrizzleTransportOfferWriteAdapter } from './adapters/transport-offer-write.adapter';
import { CARRIER_RATE_SOURCES_TOKEN } from './interfaces/carrier-rate-source.port';
import { TRANSPORT_OFFER_WRITE_PORT } from './interfaces/transport-offer-write.port';
import type { ICarrierRateSource } from './interfaces/carrier-rate-source.port';

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
    ContentLintService,

    // Feed adapters — registered as a Map keyed by merchantId.
    // alko (change drop-sweden-eur-only-alko-benchmark): the domestic
    // reference merchant through the same adapter surface and governance
    // gate; its registry row keeps an empty feedUrl until a live feed is
    // entitled — the golden fixture pins the parser. alks (change
    // alks-feed-and-import-vat): the alks.fi store as the second row,
    // resolved through the same map. The four sitemap-crawl merchants
    // (task 2.1, change sitemap-crawl-merchants) join the same map —
    // their workflow/producer wiring is task 3.1, not here.
    AlkoFeedAdapter,
    AlksFeedAdapter,
    ViinarannastaFeedAdapter,
    ViinikauppaFeedAdapter,
    LicoreaFeedAdapter,
    DrinkonlineFeedAdapter,
    {
      provide: FEED_ADAPTERS_TOKEN,
      useFactory: (
        alko: AlkoFeedAdapter,
        alks: AlksFeedAdapter,
        viinarannasta: ViinarannastaFeedAdapter,
        viinikauppa: ViinikauppaFeedAdapter,
        licorea: LicoreaFeedAdapter,
        drinkonline: DrinkonlineFeedAdapter,
      ): Map<string, IFeedAdapter> => {
        const map = new Map<string, IFeedAdapter>();
        map.set(alko.merchantId, alko);
        map.set(alks.merchantId, alks);
        map.set(viinarannasta.merchantId, viinarannasta);
        map.set(viinikauppa.merchantId, viinikauppa);
        map.set(licorea.merchantId, licorea);
        map.set(drinkonline.merchantId, drinkonline);
        return map;
      },
      inject: [
        AlkoFeedAdapter,
        AlksFeedAdapter,
        ViinarannastaFeedAdapter,
        ViinikauppaFeedAdapter,
        LicoreaFeedAdapter,
        DrinkonlineFeedAdapter,
      ],
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

    // Transport-rate refresh (task 7.4) — LIVE carrier sources keyed by
    // carrierId, the transport-offer write port, and the governance-gated
    // refresh service behind the TransportRateService slot. The map is
    // empty since 2026-09-28: both carriers (posti, fransberg) are
    // curated in-repo datasets ingested by the api-worker's monthly
    // curated-rate-refresh cron; a future entitled live feed re-registers
    // its source here.
    {
      provide: CARRIER_RATE_SOURCES_TOKEN,
      useFactory: (): Map<string, ICarrierRateSource> => new Map<string, ICarrierRateSource>(),
    },
    DrizzleTransportOfferWriteAdapter,
    { provide: TRANSPORT_OFFER_WRITE_PORT, useClass: DrizzleTransportOfferWriteAdapter },

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
  ],
})
export class DataAcquisitionModule {}