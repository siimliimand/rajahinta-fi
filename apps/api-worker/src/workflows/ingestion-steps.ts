/**
 * Ingestion Workflow step orchestration (task 4.2, design D6) — the
 * Cloudflare-free core of the price-ingestion Workflow.
 *
 * The pipeline stages of PipelineOrchestratorService become durable
 * Workflow steps, one per stage, in the orchestrator's real order:
 * resolve merchant → governance gate → fetch feed → map (+ lint) →
 * volume-ceiling gate → upsert (+ offer-change hook) → data quality.
 * Each step runs under
 * {@link INGESTION_STEP_RETRY} — BullMQ price-ingestion parity
 * (attempts: 5, exponential 30 s base — the same shape
 * `retryDelaySeconds` gives Queue redeliveries), so a transient failure
 * now retries INSIDE the instance instead of through Queue redelivery.
 *
 * This module deliberately imports nothing from `cloudflare:workers` /
 * `cloudflare:workflows`: the Node vitest pool cannot resolve those
 * specifiers, so tests drive {@link runIngestionWorkflow} through a fake
 * step emulating `step.do` replay/retry semantics. The real entrypoint
 * shell (./ingestion.workflow.ts) is the only cloudflare-importing file;
 * it passes the runtime's own classes in as deps.
 *
 * ## Claim ownership (the documented pick)
 *
 * The Queue consumer keeps its DO job-claim SKIP (already-completed /
 * in-flight) but no longer completes the claim. The workflow owns the
 * claim lifecycle from handoff on: its `complete-job-claim` step marks
 * the key completed on success, and a `release-job-claim` step (run from
 * the catch path) releases it when the instance terminally fails — a
 * failed run must never leave a marker that suppresses its own retry.
 * Between claim and completion the key reads as `in-flight` (duplicate
 * deliveries skip), and the DO's stale-claim reclamation is the
 * dead-attempt safety net; a redelivery that re-claims the key hands off
 * to the SAME instance id (= dedupe key), so the runtime's
 * duplicate-instance guard makes the handoff idempotent.
 *
 * ## Stage composition
 *
 * {@link composeIngestionStageServices} mirrors queues/pipeline.ts
 * construction line for line (same classes, same fail-closed governance
 * default, same offer-change hook wiring). It lives here — not as an
 * export of pipeline.ts — so the queues directory stays consumer-handoff
 * only in this wave; the two compositions must be kept in sync until the
 * lead consolidates them.
 *
 * @module IngestionWorkflowSteps
 */

import {
  AlcoholExciseService,
  ContainerDutyService,
  PriceObservationRecorderService,
  ReliabilityService,
  SourceGovernanceService,
  TransportEstimationService,
} from '@rajahinta/core-domain';
import type {
  ISourceGovernanceRepository,
  PermissionCheckResult,
} from '@rajahinta/core-domain';
// Source-file imports (not the data-acquisition barrel): the barrel pulls
// @nestjs/bull and must stay out of a Worker bundle — same policy as
// queues/pipeline.ts.
import { ClassificationGateService } from '../../../../packages/core-domain/src/normalization/classification-gate.service';
import { ConfidenceFrameworkService } from '../../../../packages/core-domain/src/reliability/confidence-framework.service';
import { ContentLintService } from '../../../../packages/data-acquisition/src/content/content-lint.service';
import type { ContentViolation } from '../../../../packages/data-acquisition/src/content/content-lint.service';
import { DataMappingService } from '../../../../packages/data-acquisition/src/services/data-mapping.service';
import { DataQualityService } from '../../../../packages/data-acquisition/src/services/data-quality.service';
import type { DataQualityReport } from '../../../../packages/data-acquisition/src/services/data-quality.service';
import { FeedIngestionService } from '../../../../packages/data-acquisition/src/services/feed-ingestion.service';
import type { PermissionGateResult } from '../../../../packages/data-acquisition/src/services/pipeline-orchestrator.service';
import { AlkoFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/alko.adapter';
import { AlksFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/alks.adapter';
import { KippisFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/kippis.adapter';
import { LongeroFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/longero.adapter';
import { MydrinkFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/mydrink.adapter';
import { AraxesFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/araxes.adapter';
import { BottleofItalyFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/bottleofitaly.adapter';
import { KuhnsFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/kuhns.adapter';
import { SitemapCrawlFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/sitemap-crawl.adapter';
import { DrinkonlineFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/drinkonline.adapter';
import { LicoreaFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/licorea.adapter';
import { ViinarannastaFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/viinarannasta.adapter';
import { ViinikauppaFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/viinikauppa.adapter';
import type { IFeedAdapter } from '../../../../packages/data-acquisition/src/interfaces/feed-adapter.interface';
import type { RawFeedRecord } from '../../../../packages/data-acquisition/src/interfaces/feed-adapter.interface';
import type { MerchantConfig } from '../../../../packages/data-acquisition/src/interfaces/merchant-config.interface';
import { merchantConfigFromRegistry } from '../../../../packages/data-acquisition/src/interfaces/merchant-config.interface';
import type {
  IUpsertRepository,
  UpsertOfferInput,
  UpsertProductInput,
} from '../../../../packages/data-acquisition/src/interfaces/upsert-port.interface';
import type { IOfferChangeHook } from '../../../../packages/data-acquisition/src/interfaces/offer-change-hook.interface';
import { D1MerchantRegistryRepository } from '../../../../packages/data-platform/src/repositories/d1/merchant-registry.repository';
// Type-only: the ceiling table's keys must track the canonical category
// set without adding a runtime coupling to the schema module.
import type { ProductCategory } from '../../../../packages/data-platform/src/d1/schema';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1SourceGovernanceRepository } from '../../../../packages/data-platform/src/repositories/d1/source-governance.repository';
import { D1TaxRuleRepositoryAdapter } from '../../../../packages/data-platform/src/repositories/d1/tax-rate.repository';
import { D1TransportOfferRepository } from '../../../../packages/data-platform/src/repositories/d1/transport-offer.repository';
import { R2PriceObservationPort } from '../../../../packages/data-platform/src/repositories/d1/price-observation.repository';
import type { ObservationLogStore } from '../../../../packages/data-platform/src/d1/observation-log';
import type { Env } from '../env';
import { completeJob, releaseJob } from '../do/client';
import { D1UpsertRepository } from '../adapters/d1-upsert.repository';
import { D1CrawlWatermarkStore } from '../adapters/d1-crawl-watermark.store';
import {
  D1ProductDataPort,
  D1TransportOfferQuery,
} from '../adapters/d1-domain-ports';
import { OfferChangeRecorderHook } from '../adapters/offer-change-recorder-hook';
import { observationLogStore } from '../adapters/r2-observation-log.store';
import { runCrawlFetchSteps } from './crawl-fetch-steps';
import {
  recordImplausibleVolumeShare,
  recordZeroPriceRejections,
  zeroPriceRejectionsOf,
} from '../observability/data-quality';
import type { Logger } from '../logger';
import type { IngestionRunOutcome } from '../queues/ingestion.queue';

// ---------------------------------------------------------------------------
// Step contract
// ---------------------------------------------------------------------------

/**
 * Workflow params — the Queue message body carried over one-for-one
 * (IngestionMessageBody parity). The instance id is the message's
 * dedupe key (`price-ingestion-<merchantId>-<hour>`), which makes the
 * consumer's instance creation idempotent under at-least-once delivery.
 */
export interface IngestionWorkflowParams {
  readonly dedupeKey: string;
  readonly merchantId: string;
  readonly sourceUrl: string;
}

/**
 * Per-step retry config — the structural subset of the runtime's
 * WorkflowStepConfig this orchestration uses.
 */
export interface StepRetryConfig {
  readonly retries: {
    readonly limit: number;
    /** Milliseconds; the runtime multiplies by 2^attempt for exponential. */
    readonly delay: number;
    readonly backoff: 'exponential';
  };
}

/**
 * BullMQ price-ingestion defaultJobOptions parity: attempts 5, 30 s
 * exponential base (see ingestion.queue.ts retryDelaySeconds — the
 * 2 h Queue-side cap is not expressible in a step config, but at limit
 * 5 the largest step delay is 30 s · 2⁴ = 480 s, far below it).
 */
export const INGESTION_STEP_RETRY: StepRetryConfig = {
  retries: { limit: 5, delay: 30_000, backoff: 'exponential' },
};

/**
 * Structural subset of the runtime WorkflowStep. The real class
 * satisfies it; tests emulate `step.do` (output replay by name +
 * exponential retry/backoff) with the same signature.
 */
export interface WorkflowStepLike {
  do<T>(
    name: string,
    config: StepRetryConfig,
    callback: () => Promise<T>,
  ): Promise<T>;
  /**
   * Durable hibernation sleep — the instance pauses and the next step
   * execution runs in a fresh invocation. Used to hand each chunk group
   * a fresh D1 API-request budget (see the upsert loop). Duration in ms.
   */
  sleep(name: string, sleepFor: number): Promise<void>;
}

/** Error constructor injected by the shell (cloudflare:workflows NonRetryableError in production). */
export type NonRetryableErrorCtor = new (message: string) => Error;

/** Job-claim surface the workflow uses — the DO client's complete/release. */
export interface WorkflowClaimClient {
  complete(env: Env, key: string): Promise<void>;
  release(env: Env, key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Stage collaborators (mirror of queues/pipeline.ts composition)
// ---------------------------------------------------------------------------

/** Registry lookup narrowed to what the resolve step needs (fake-friendly). */
export type MerchantRegistryLookup = {
  findByMerchantId(merchantId: string): Promise<Awaited<ReturnType<D1MerchantRegistryRepository['findByMerchantId']>> | null>;
};

/** The stage collaborators one workflow run consumes. */
export interface IngestionStageServices {
  readonly registry: MerchantRegistryLookup;
  readonly governance: SourceGovernanceService;
  readonly feeds: FeedIngestionService;
  /**
   * Sitemap-crawl adapters keyed by merchantId (task 3.1) — the same
   * instances the feeds map carries. Optional so test compositions
   * without crawl merchants stay unchanged; the fetch stage branches on
   * presence (identity gate, no flags).
   */
  readonly crawlFeedAdapters?: ReadonlyMap<string, SitemapCrawlFeedAdapter>;
  readonly mapping: DataMappingService;
  readonly contentLint: ContentLintService;
  readonly upserts: IUpsertRepository;
  readonly dataQuality: DataQualityService;
  /** Optional exactly as in PipelineOrchestratorService — hosts without a recorder run unchanged. */
  readonly offerChangeHook?: IOfferChangeHook;
}

/** Composition overrides (tests / alternative backing stores). */
export interface IngestionStageCompositionOptions {
  /** Governance backing; default is the durable D1 source_governance store (fail-closed when empty). */
  readonly governanceRepository?: ISourceGovernanceRepository;
  /** Observation log binding override (tests use an in-memory store). */
  readonly observationStoreOverride?: ObservationLogStore;
  /** Feed adapters; default registers the twelve live adapters — alko, alks, longero, kippis, mydrink, araxes, bottleofitaly, kuhns, and the four crawl merchants — as pipeline.ts does. */
  readonly feedAdaptersOverride?: Map<string, IFeedAdapter>;
  /**
   * Sitemap-crawl adapters (task 3.1); default composes the four v1
   * crawl merchants over the durable D1 watermark/cursor store, the
   * same instances the feeds map carries. Presence in this map — keyed
   * by merchantId — is the crawl path's identity gate (no flags).
   */
  readonly crawlFeedAdaptersOverride?: ReadonlyMap<string, SitemapCrawlFeedAdapter>;
  /** Write-port override (tests force upsert failures through it). */
  readonly upsertRepositoryOverride?: IUpsertRepository;
}

/**
 * Compose the stage collaborators over the Worker bindings — the
 * step-level view of `composeIngestionPipeline` (queues/pipeline.ts).
 * Keep the two in sync: same services, same construction order, same
 * fail-closed governance default.
 */
export function composeIngestionStageServices(
  env: Env,
  options: IngestionStageCompositionOptions = {},
): IngestionStageServices {
  // Durable crawl state (task 3.1): one store serves every crawl
  // merchant — rows are merchant-keyed in aggregation_watermarks.
  const crawlWatermarks = new D1CrawlWatermarkStore(env.DB);

  // Sitemap-crawl adapters (task 2.1) over the durable store: the same
  // instances register in BOTH maps — the feeds map keeps the generic
  // fetch-feed path working, the crawl map gates the chunked steps.
  const crawlAdapters =
    options.crawlFeedAdaptersOverride ??
    (() => {
      const map = new Map<string, SitemapCrawlFeedAdapter>();
      const viinarannasta = new ViinarannastaFeedAdapter({
        watermarkStore: crawlWatermarks,
        cursorStore: crawlWatermarks,
      });
      map.set(viinarannasta.merchantId, viinarannasta);
      const viinikauppa = new ViinikauppaFeedAdapter({
        watermarkStore: crawlWatermarks,
        cursorStore: crawlWatermarks,
      });
      map.set(viinikauppa.merchantId, viinikauppa);
      const licorea = new LicoreaFeedAdapter({
        watermarkStore: crawlWatermarks,
        cursorStore: crawlWatermarks,
      });
      map.set(licorea.merchantId, licorea);
      const drinkonline = new DrinkonlineFeedAdapter({
        watermarkStore: crawlWatermarks,
        cursorStore: crawlWatermarks,
      });
      map.set(drinkonline.merchantId, drinkonline);
      return map;
    })();

  const adapters =
    options.feedAdaptersOverride ??
    (() => {
      const map = new Map<string, IFeedAdapter>();
      const alko = new AlkoFeedAdapter();
      map.set(alko.merchantId, alko);
      const alks = new AlksFeedAdapter();
      map.set(alks.merchantId, alks);
      const longero = new LongeroFeedAdapter();
      map.set(longero.merchantId, longero);
      const kippis = new KippisFeedAdapter();
      map.set(kippis.merchantId, kippis);
      const mydrink = new MydrinkFeedAdapter();
      map.set(mydrink.merchantId, mydrink);
      const araxes = new AraxesFeedAdapter();
      map.set(araxes.merchantId, araxes);
      // Shopify products.json merchants (change
      // onboard-shopify-lmdw-merchants) — plain construction like the
      // store-API adapters above: no crawl stores, the shared walk owns
      // the paging (pipeline.ts parity).
      const bottleofitaly = new BottleofItalyFeedAdapter();
      map.set(bottleofitaly.merchantId, bottleofitaly);
      const kuhns = new KuhnsFeedAdapter();
      map.set(kuhns.merchantId, kuhns);
      // The crawl adapters join the same lookup (pipeline.ts parity) —
      // a non-chunked caller still resolves a must-not-throw fetch.
      for (const [merchantId, crawlAdapter] of crawlAdapters) {
        map.set(merchantId, crawlAdapter);
      }
      return map;
    })();

  const upsertRepository =
    options.upsertRepositoryOverride ?? new D1UpsertRepository(env.DB);
  const governance = new SourceGovernanceService(
    options.governanceRepository ?? new D1SourceGovernanceRepository(env.DB),
  );

  // Offer-change hook → core-domain recorder → R2 observation log
  // (identical wiring to composeIngestionPipeline).
  const recorder = new PriceObservationRecorderService(
    new ClassificationGateService(),
    new AlcoholExciseService(new D1TaxRuleRepositoryAdapter(env.DB)),
    new ContainerDutyService(new D1TaxRuleRepositoryAdapter(env.DB)),
    new TransportEstimationService(
      new D1TransportOfferQuery(new D1TransportOfferRepository(env.DB)),
    ),
    new ConfidenceFrameworkService(new ReliabilityService()),
    new D1ProductDataPort(new D1ProductSearchRepository(env.DB)),
    new R2PriceObservationPort(
      options.observationStoreOverride ?? observationLogStore(env),
    ),
  );

  return {
    registry: new D1MerchantRegistryRepository(env.DB),
    governance,
    feeds: new FeedIngestionService(adapters),
    crawlFeedAdapters: crawlAdapters,
    mapping: new DataMappingService(),
    contentLint: new ContentLintService(),
    upserts: upsertRepository,
    dataQuality: new DataQualityService(new ReliabilityService()),
    offerChangeHook: new OfferChangeRecorderHook(recorder),
  };
}

// ---------------------------------------------------------------------------
// Step outputs — step-scoped state passed between steps
// ---------------------------------------------------------------------------

/** resolve-merchant step output. */
export type ResolvedMerchant =
  | { readonly kind: 'ok'; readonly config: MerchantConfig }
  | { readonly kind: 'error'; readonly message: string };

/**
 * A mapped pair with the observation instant serialized. Step outputs
 * must survive serialization; `observedAt` travels as ISO-8601 and is
 * reconstructed as a Date inside the upsert step. Derived mechanically
 * from the upsert input so the serialized shape can never drift from
 * the real offer contract.
 */
export type SerializedOfferInput = Omit<UpsertOfferInput, 'productId' | 'observedAt'> & {
  readonly observedAtIso: string;
};

export interface SerializedMappedPair {
  readonly product: UpsertProductInput;
  readonly offerInput: SerializedOfferInput;
  /**
   * Offer-gate rejections (design D1, data-quality-and-publication-trust)
   * — present exactly when the offer must NOT be published; the product
   * still upserts offer-less and the strings ride the step's error
   * collection (orchestrator parity).
   */
  readonly offerErrors?: readonly string[];
}

/** map-records step output (mapping + content lint). */
export interface MappedRecords {
  readonly pairs: readonly SerializedMappedPair[];
  readonly contentViolations: readonly ContentViolation[];
}

/**
 * Per-offer state the quality step consumes (observedAt serialized).
 * `unitVolume` is the product's stored `unit_volume` verbatim — the
 * litres string the mapper wrote — so the quality step can evaluate the
 * unit-window invariant without re-reading D1.
 */
export interface SerializedQualityOffer {
  readonly merchant: string;
  readonly productId: number;
  readonly observedAtIso: string;
  readonly reliabilityStatus: string;
  readonly unitVolume: string;
}

/** upsert-offers step output. */
export interface UpsertOutcome {
  readonly recordsAdded: number;
  readonly recordsUpdated: number;
  readonly offersChanged: number;
  readonly upsertErrors: readonly string[];
  readonly upsertedOffers: readonly SerializedQualityOffer[];
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * resolve-merchant — re-read the registry row at run time (registry
 * edits take effect on the next job without a deploy; the message's
 * sourceUrl is enqueue-time log context only). Error strings are the
 * runIngestion (4.1) strings — an unknown merchant or a bad feed format
 * is a completed run with an error, NOT a retryable failure (retrying
 * cannot fix a missing registry row), so it lands in-band.
 */
export async function resolveMerchantStep(
  registry: MerchantRegistryLookup,
  params: IngestionWorkflowParams,
): Promise<ResolvedMerchant> {
  const row = await registry.findByMerchantId(params.merchantId);
  if (row === null) {
    return {
      kind: 'error',
      message:
        `Merchant "${params.merchantId}" is not in the merchant registry — ` +
        'onboard it (registry row + governance grant) before ingestion (D6)',
    };
  }
  const derived = merchantConfigFromRegistry(row);
  if ('error' in derived) {
    return { kind: 'error', message: derived.error };
  }
  return { kind: 'ok', config: derived.config };
}

/**
 * Governance gate — PipelineOrchestratorService.checkMerchantPermission
 * semantics verbatim (fail-closed: an outage or absent records default
 * to PENDING, gating the merchant out before any fetch or persistence).
 */
export async function governanceGateStep(
  governance: SourceGovernanceService,
  merchantId: string,
): Promise<PermissionGateResult> {
  let result: PermissionCheckResult;
  try {
    result = await governance.checkPermission(merchantId);
  } catch {
    // Fail closed on governance errors — an outage must not grant access
    // (orchestrator parity; the orchestrator additionally logged it).
    return {
      permitted: false,
      status: 'PENDING',
      reason: 'Governance check error — defaulting to PENDING',
    };
  }

  if (result.sources.length === 0) {
    return {
      permitted: false,
      status: 'PENDING',
      reason: 'No governance records found — defaulting to PENDING',
    };
  }

  if (result.permissionStatus === 'GRANTED') {
    return { permitted: true, status: 'GRANTED', reason: 'Permission granted' };
  }

  return {
    permitted: false,
    status: result.permissionStatus,
    reason: `Permission status is ${result.permissionStatus}`,
  };
}

/** fetch-feed step output (the raw adapter result, JSON-serializable). */
export interface FeedFetchOutcome {
  readonly records: readonly RawFeedRecord[];
  readonly errors: readonly string[];
}

/** fetch-feed — the merchant adapter fetch (Workers-clean: fetch + JSON). */
export async function fetchFeedStep(
  feeds: FeedIngestionService,
  config: MerchantConfig,
): Promise<FeedFetchOutcome> {
  const result = await feeds.fetchFromMerchant(
    config.merchantId,
    config.feedUrl,
    config.feedFormat,
  );
  return { records: result.records, errors: result.errors };
}

/** map-records — map to canonical shapes + content lint (warning-only). */
export async function mapRecordsStep(
  services: IngestionStageServices,
  config: MerchantConfig,
  fetched: FeedFetchOutcome,
): Promise<MappedRecords> {
  const mapped = services.mapping.mapBatch(
    [...fetched.records],
    config.merchantId,
    config.country,
  );

  // Lint is a warning mechanism — violations never block ingestion
  // (orchestrator parity).
  const contentViolations: ContentViolation[] = [];
  for (const pair of mapped) {
    const result = services.contentLint.lintProductContent(
      pair.product.name,
      '', // description — not available in Phase 1 feed data
    );
    contentViolations.push(...result.violations);
  }

  return {
    pairs: mapped.map((pair) => {
      const { observedAt, ...offerRest } = pair.offerInput;
      return {
        product: pair.product,
        offerInput: { ...offerRest, observedAtIso: observedAt.toISOString() },
        ...(pair.offerErrors !== undefined
          ? { offerErrors: [...pair.offerErrors] }
          : {}),
      };
    }),
    contentViolations,
  };
}

/**
 * Pairs per upsert step. The engine kills a step at its default 10-minute
 * timeout; ~250 pairs × a handful of sequential D1 round-trips leaves an
 * order of magnitude of headroom while keeping the number of steps per
 * run in the low tens for a full alks catalog.
 */
export const UPSERT_CHUNK_SIZE = 250;

/**
 * Chunks per D1 API-request budget window — every this-many chunk steps
 * the workflow crosses a durable sleep boundary so subsequent chunks run
 * in a fresh Worker invocation (see the upsert loop). Sized against the
 * FIRST-run per-pair cost — the worst case: a fresh product INSERT +
 * offer INSERT + changed-offer observation append per pair, ~4× a
 * re-run pair (unchanged offers skip the writes). Both measured points:
 *
 * - 2026-09-30 production, re-run profile (full alks): quota death
 *   between chunks 40–41 of 250 rows each ≈ 10k RE-run pairs.
 * - 2026-10-07 staging, first-run araxes (1,540 pairs = 7 chunks,
 *   workflow instance 1c2cddc7, change onboard-araxes-merchant):
 *   quota death after ~4 chunk-steps ≈ 1k FIRST-run pairs — with the
 *   then-constant 16, the first reset sat beyond chunk 16 and never
 *   fired at all for a 7-chunk catalog.
 *
 * 2 caps each invocation window at ≤ 2 × 250 = 500 first-run pairs —
 * a ≥2× margin under the observed ~1,100-pair first-run death window —
 * and the boundary arrives before the death window for ANY mid-size
 * catalog (a window longer than the catalog is the bug class). Each
 * boundary costs ~1 s: a full alks re-run = 12 chunks = 5 extra sleeps,
 * far inside the 10-minute step timeout.
 */
export const CHUNK_BUDGET_RESET_EVERY = 2;

/**
 * upsert-offers chunk — the orchestrator's upsert loop + offer-change
 * hook over ONE chunk of the mapped pairs (the workflow slices
 * `map-records` output into {@link UPSERT_CHUNK_SIZE} steps). Idempotent
 * under replay: products refresh by EAN/compound key, and an
 * already-persisted offer with the same observed-at instant is a no-op
 * (its changed-offer hook does not refire).
 */
export async function upsertOffersChunkStep(
  services: IngestionStageServices,
  config: MerchantConfig,
  pairs: readonly SerializedMappedPair[],
): Promise<UpsertOutcome> {
  let recordsAdded = 0;
  let recordsUpdated = 0;
  let offersChanged = 0;
  const upsertErrors: string[] = [];
  const upsertedOffers: SerializedQualityOffer[] = [];

  for (const pair of pairs) {
    try {
      const upsertResult = await services.upserts.upsertProduct(pair.product);
      if (upsertResult.created) {
        recordsAdded++;
      } else {
        recordsUpdated++;
      }

      // Offer-gate rejections (design D1, data-quality-and-publication-trust):
      // the product upserted above stays offer-less; the rejected offer
      // never persists and its drift error rides the step's error
      // collection (orchestrator parity — the hook and the quality feed
      // see no offer at all).
      if (pair.offerErrors !== undefined) {
        upsertErrors.push(...pair.offerErrors);
      } else {
        const observedAt = new Date(pair.offerInput.observedAtIso);
        const { observedAtIso: _serialized, ...offerRest } = pair.offerInput;
        const offerResult = await services.upserts.upsertOffer({
          ...offerRest,
          observedAt,
          productId: upsertResult.productId,
        });

        upsertedOffers.push({
          merchant: config.merchantId,
          productId: upsertResult.productId,
          observedAtIso: pair.offerInput.observedAtIso,
          reliabilityStatus: pair.offerInput.reliabilityStatus,
          unitVolume: pair.product.unitVolume,
        });

        // Changed-offer hook: fires exactly once per CHANGED offer, after
        // the row is durably upserted. Failure isolation is mandatory —
        // a recorder error is contained and the run continues
        // (orchestrator parity; the observation log never aborts
        // ingestion or pollutes the run's error list).
        if (offerResult.changed) {
          offersChanged++;

          if (services.offerChangeHook) {
            try {
              await services.offerChangeHook.onOfferChanged({
                productId: upsertResult.productId,
                offerId: offerResult.offerId,
                merchant: config.merchantId,
                country: pair.offerInput.country,
                priceCents: pair.offerInput.priceCents,
                reliabilityStatus: pair.offerInput.reliabilityStatus,
                observedAt,
              });
            } catch (hookErr) {
              const message =
                hookErr instanceof Error
                  ? hookErr.message
                  : 'Unknown offer-change hook error';
              // Contained, orchestrator parity — never surfaces in errors[].
              void message;
            }
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown upsert error';
      upsertErrors.push(
        `Failed to upsert product "${pair.product.name}": ${message}`,
      );
    }
  }

  return { recordsAdded, recordsUpdated, offersChanged, upsertErrors, upsertedOffers };
}

// ---------------------------------------------------------------------------
// Unit-window invariant (task 1.4, unit-integrity-and-result-trust)
// ---------------------------------------------------------------------------

/**
 * Exclusive upper bound of the canonical litre window (product-data-model):
 * a stored `unit_volume` is litres and must satisfy `0 < unit_volume < 100`.
 * Values >= 100 are ml-shaped feed data the pipeline never re-interprets
 * with a second unit convention; 0 is the parser's unresolved-volume
 * encoding, whose record persists keyed ESTIMATED (visible estimate, not
 * a silent drop) — the invariant guarantees such rows can never pass as
 * plausible-volume data.
 */
export const UNIT_VOLUME_LITRES_MAX = 100;

/**
 * One data-error entry per upserted offer whose product's stored unit
 * volume violates the canonical window — the spec's "flagged as a data
 * error". Pure so the D1 data-quality suite can pin the same predicate.
 */
export function unitVolumeViolations(
  upserted: readonly SerializedQualityOffer[],
): string[] {
  const violations: string[] = [];
  for (const offer of upserted) {
    const volume = Number(offer.unitVolume);
    if (
      !(Number.isFinite(volume) && volume > 0 && volume < UNIT_VOLUME_LITRES_MAX)
    ) {
      violations.push(
        `Data error: unit_volume ${offer.unitVolume} (product ${offer.productId}, ` +
          `merchant "${offer.merchant}") is outside the canonical litre window ` +
          `(0, ${UNIT_VOLUME_LITRES_MAX})`,
      );
    }
  }
  return violations;
}

/** data-quality step output — freshness report plus the unit-window errors. */
export interface DataQualityOutcome {
  readonly report: DataQualityReport;
  /** Rows outside `0 < unit_volume < 100` — the failed check's data errors. */
  readonly unitVolumeViolations: readonly string[];
}

/**
 * The parser's unresolved-volume encoding — what the mapper persists when
 * a feed name yields no parsable volume, and what the ceiling gate below
 * stores for a category-implausible volume: the row keeps its offer,
 * minus any plausible-volume claim.
 */
export const UNIT_VOLUME_UNAVAILABLE = '0';

/**
 * Per-category unit-volume ceilings in litres — one constants table, keyed
 * by the canonical product-category set (data-platform PRODUCT_CATEGORIES,
 * the same keys the D1 category CHECK and the tax rules share).
 * `Record<ProductCategory, number>` makes a category added to the schema
 * without a bound a compile error.
 *
 * The bounds extend, never replace, the outer 0–100 l rail
 * ({@link UNIT_VOLUME_LITRES_MAX}): each only narrows the window for a
 * category whose single units never legitimately reach it — beer and other
 * fermented drinks are singles ≤ 2 l, spirits ≤ 3 l, and the wine family
 * (still, sparkling, fortified) sells up to 6 l single units. A parsed
 * volume above the ceiling is a multipack or unit error (the live
 * "Karhu Olut 5.3% 24×33 l" case) — never a plausible per-unit value.
 */
export const UNIT_VOLUME_CATEGORY_CEILING_LITRES: Readonly<
  Record<ProductCategory, number>
> = {
  beer: 2,
  wine_still: 6,
  wine_sparkling: 6,
  intermediate_products: 6,
  other_fermented: 2,
  spirits: 3,
};

/**
 * Effective ceiling for a product category — a category outside the
 * canonical set (cannot reach D1 today; the category CHECK rejects it)
 * falls back to the outer rail rather than an unbounded pass.
 */
export function unitVolumeCategoryCeiling(category: string): number {
  return (
    UNIT_VOLUME_CATEGORY_CEILING_LITRES[category as ProductCategory] ??
    UNIT_VOLUME_LITRES_MAX
  );
}

/**
 * volume-ceiling-gate step output — the pairs to upsert (volume-nulled
 * where gated) plus one review flag per gated row.
 */
export interface VolumeCeilingGateOutcome {
  readonly pairs: readonly SerializedMappedPair[];
  readonly findings: readonly string[];
}

/**
 * volume-ceiling-gate — runs BEFORE any upsert. The unit-window check is
 * assessment-only post-upsert, but a category-implausible volume must
 * never be STORED as plausible, so this gate transforms the mapped pairs
 * first: a volume above its category ceiling is withheld to the parser's
 * unresolved encoding and the row flagged for review. Rejection is to
 * absence/review, never a drop — the row still upserts, offer intact.
 * Only finite volumes above the ceiling are gated; rail-owned shapes
 * (unresolved 0, negative, non-numeric) pass through untouched for the
 * outer window check to flag as before. Volume-plausible rows pass
 * unchanged.
 */
export async function volumeCeilingGateStep(
  mapped: MappedRecords,
): Promise<VolumeCeilingGateOutcome> {
  const pairs: SerializedMappedPair[] = [];
  const findings: string[] = [];
  for (const pair of mapped.pairs) {
    const volume = Number(pair.product.unitVolume);
    const ceiling = unitVolumeCategoryCeiling(pair.product.category);
    if (!(Number.isFinite(volume) && volume > ceiling)) {
      pairs.push(pair);
      continue;
    }
    findings.push(
      `Data error: unit_volume ${pair.product.unitVolume} for product ` +
        `"${pair.product.name}" (category "${pair.product.category}") exceeds ` +
        `the ${pair.product.category} ceiling of ${ceiling} l — volume stored ` +
        `unavailable, row held for review`,
    );
    pairs.push({
      product: { ...pair.product, unitVolume: UNIT_VOLUME_UNAVAILABLE },
      offerInput: pair.offerInput,
      // Preserve the mapping stage's own offer-gate rejections (task 1.1
      // price floor) — a pair can fail both gates, and the ceiling copy
      // must not resurrect an offer the mapper rejected.
      ...(pair.offerErrors !== undefined
        ? { offerErrors: [...pair.offerErrors] }
        : {}),
    });
  }
  return { pairs, findings };
}

/** data-quality step — run only when at least one offer was upserted. */
export async function dataQualityStep(
  services: IngestionStageServices,
  upserted: readonly SerializedQualityOffer[],
  categoryVolumeFindings: readonly string[] = [],
): Promise<DataQualityOutcome | null> {
  if (upserted.length === 0) return null;
  const report = services.dataQuality.runQualityCheck(
    upserted.map((offer) => ({
      merchant: offer.merchant,
      productId: offer.productId,
      observedAt: new Date(offer.observedAtIso),
      reliabilityStatus: offer.reliabilityStatus,
    })),
    categoryVolumeFindings.length,
  );

  // Rows outside the canonical window fail the check: they are flagged on
  // the report AND returned so the orchestration surfaces them as run-level
  // errors. Enforcement is assessment-only (post-upsert, orchestrator
  // parity with content lint) — the row itself was persisted by the
  // committed mapper design, so "rejected" here means never trusted and
  // never re-interpreted, not silently dropped.
  const unitViolations = unitVolumeViolations(upserted);
  // The ceiling gate's review flags ride the same report surface (its
  // count feeds the implausible-volume share metric). A gated row appears
  // as BOTH a held-for-review flag here and a window violation below —
  // its stored volume is the unresolved 0, which the rail must keep
  // rejecting as plausible-volume data.
  report.flaggedIssues.push(...categoryVolumeFindings, ...unitViolations);
  return { report, unitVolumeViolations: unitViolations };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run the staged pipeline inside the (real or emulated) step API.
 *
 * `services` / `stageOptions` are test seams; production composes from
 * `env`. The returned shape is the 4.1 consumer contract
 * ({@link IngestionRunOutcome}); the run report's richer detail lives in
 * the step outputs (queryable via the Workflows instance state).
 */
export async function runIngestionWorkflow(
  params: IngestionWorkflowParams,
  deps: {
    readonly env: Env;
    readonly step: WorkflowStepLike;
    readonly NonRetryableError: NonRetryableErrorCtor;
    readonly services?: IngestionStageServices;
    readonly stageOptions?: IngestionStageCompositionOptions;
    readonly claims?: WorkflowClaimClient;
    readonly log?: Logger;
  },
): Promise<IngestionRunOutcome> {
  const { step, env, NonRetryableError } = deps;
  const log = deps.log;
  const claims: WorkflowClaimClient = deps.claims ?? {
    complete: completeJob,
    release: releaseJob,
  };

  // Malformed params can never succeed — fail the instance immediately
  // (the non-retryable marker; the consumer rejects these before
  // handoff, this is the backstop).
  if (
    typeof params?.dedupeKey !== 'string' ||
    params.dedupeKey.length === 0 ||
    typeof params?.merchantId !== 'string' ||
    params.merchantId.length === 0
  ) {
    throw new NonRetryableError(
      `Malformed ingestion workflow params: ${JSON.stringify(params)}`,
    );
  }

  const services =
    deps.services ?? composeIngestionStageServices(env, deps.stageOptions);

  // Complete the claim (workflow-owned lifecycle: the consumer only
  // claims and skips). Runs as a step so the completion is durable.
  const finalize = async (result: IngestionRunOutcome): Promise<IngestionRunOutcome> => {
    await step.do('complete-job-claim', INGESTION_STEP_RETRY, () =>
      claims.complete(env, params.dedupeKey),
    );
    return result;
  };

  try {
    // -- Step 1: resolve merchant -----------------------------------------
    const resolved = await step.do('resolve-merchant', INGESTION_STEP_RETRY, () =>
      resolveMerchantStep(services.registry, params),
    );
    if (resolved.kind === 'error') {
      log?.error({ message: resolved.message, merchantId: params.merchantId });
      return await finalize({ productsIngested: 0, errors: [resolved.message] });
    }
    const config = resolved.config;

    // -- Step 2: governance gate ------------------------------------------
    const gate = await step.do('governance-gate', INGESTION_STEP_RETRY, () =>
      governanceGateStep(services.governance, config.merchantId),
    );
    if (!gate.permitted) {
      log?.warn({
        message: `Skipping merchant "${config.merchantId}": ${gate.reason}`,
        merchantId: config.merchantId,
      });
      // Gate failure is a completed, zero-product run (orchestrator
      // parity — the report carries the gate decision).
      return await finalize({ productsIngested: 0, errors: [] });
    }

    // -- Step 3: fetch feed -----------------------------------------------
    // Sitemap-crawl merchants (task 3.1) branch on their adapter's
    // presence in the crawl map — identity-gated, no flags: the fetch
    // becomes CHUNKED resumable steps (≤ 300 detail fetches per step,
    // cursor durable in aggregation_watermarks), and the accumulated
    // records hand to the SAME map/gate/upsert/quality steps below.
    // Every other merchant keeps the single fetch-feed step verbatim.
    const crawlAdapter = services.crawlFeedAdapters?.get(config.merchantId);
    const fetched =
      crawlAdapter !== undefined
        ? await runCrawlFetchSteps({
            step,
            adapter: crawlAdapter,
            config,
            retry: INGESTION_STEP_RETRY,
            log,
          })
        : await step.do('fetch-feed', INGESTION_STEP_RETRY, () =>
            fetchFeedStep(services.feeds, config),
          );
    if (fetched.errors.length > 0) {
      log?.warn({
        message: `Fetch warnings/errors for "${config.merchantId}": ${fetched.errors.join('; ')}`,
        merchantId: config.merchantId,
      });
    }
    if (fetched.records.length === 0) {
      return await finalize({
        productsIngested: 0,
        errors: [...fetched.errors],
      });
    }

    // -- Step 4: map (+ lint) ----------------------------------------------
    const mapped = await step.do('map-records', INGESTION_STEP_RETRY, () =>
      mapRecordsStep(services, config, fetched),
    );
    if (mapped.contentViolations.length > 0) {
      log?.warn({
        message: `Content violations for "${config.merchantId}": ${mapped.contentViolations.length} found`,
        merchantId: config.merchantId,
      });
    }

    // -- Step 5: volume-ceiling gate ---------------------------------------
    // Publication-trust gate (task 1.2): an implausible volume is withheld
    // to the unavailable encoding BEFORE any upsert so it can never be
    // stored — let alone published — as a plausible value. The rows still
    // upsert; the review flags ride the data-quality report below.
    const gated = await step.do('volume-ceiling-gate', INGESTION_STEP_RETRY, () =>
      volumeCeilingGateStep(mapped),
    );
    if (gated.findings.length > 0) {
      log?.warn({
        message:
          `Category volume ceilings for "${config.merchantId}": ` +
          `${gated.findings.length} offer(s) held for review — ` +
          'volume stored unavailable',
        merchantId: config.merchantId,
      });
    }

    // -- Step 6: upsert (+ offer-change hook), chunked ----------------------
    // The engine's default step timeout is 10 minutes and one pair costs
    // several sequential D1 round-trips — a full alks catalog (~2,900
    // pairs) cannot fit a single attempt (staging 2026-09-11: two 600s
    // WorkflowTimeoutErrors). Each chunk runs as its own step: replayed
    // from its saved output on re-invoke, retried independently, and
    // idempotent under replay (EAN/compound refresh + same-instant offer
    // no-ops), so a timed-out chunk re-runs cleanly.
    let upserts: UpsertOutcome = {
      recordsAdded: 0,
      recordsUpdated: 0,
      offersChanged: 0,
      upsertErrors: [],
      upsertedOffers: [],
    };
    for (
      let offset = 0, index = 1;
      offset < gated.pairs.length;
      offset += UPSERT_CHUNK_SIZE, index++
    ) {
      // D1 API-request budget: every Worker invocation carries a bounded
      // per-invocation API-request quota, and the instance's executions
      // share it — a full Alko catalog (~350 chunks) exhausts it mid-run
      // (2026-09-30 production: chunks 41+ upserted nothing, each row
      // rejected with "Too many API requests by single Worker
      // invocation"). A durable hibernation boundary every N chunks
      // gives the next chunk a fresh invocation and a fresh quota; on
      // replay the sleep is skipped per its durable name and completed
      // chunk outputs replay from cache.
      if (index > 1 && (index - 1) % CHUNK_BUDGET_RESET_EVERY === 0) {
        await step.sleep(`chunk-budget-reset-${index}`, 1_000);
      }
      const chunk = gated.pairs.slice(offset, offset + UPSERT_CHUNK_SIZE);
      const part = await step.do(`upsert-offers-${index}`, INGESTION_STEP_RETRY, () =>
        upsertOffersChunkStep(services, config, chunk),
      );
      upserts = {
        recordsAdded: upserts.recordsAdded + part.recordsAdded,
        recordsUpdated: upserts.recordsUpdated + part.recordsUpdated,
        offersChanged: upserts.offersChanged + part.offersChanged,
        upsertErrors: [...upserts.upsertErrors, ...part.upsertErrors],
        upsertedOffers: [...upserts.upsertedOffers, ...part.upsertedOffers],
      };
    }

    // -- Step 7: data quality ----------------------------------------------
    const quality = await step.do('data-quality', INGESTION_STEP_RETRY, () =>
      dataQualityStep(services, upserts.upsertedOffers, gated.findings),
    );
    if (quality !== null && quality.unitVolumeViolations.length > 0) {
      log?.warn({
        message:
          `Unit-window data errors for "${config.merchantId}": ` +
          `${quality.unitVolumeViolations.length} offer(s) outside ` +
          `(0, ${UNIT_VOLUME_LITRES_MAX}) litres`,
        merchantId: config.merchantId,
      });
    }

    // -- Step 8: data-quality export writes (task 4.1) ----------------------
    // The per-run AE points as their own step: a replayed instance returns
    // the cached output without re-invoking the callback, so the per-run
    // zero-price counter cannot double-write. Emission is no-op without
    // METRICS and best-effort (write failures swallowed in metrics.ts) —
    // this step never fails the run. The share write is guarded on the
    // data-quality step's null contract: no upserted offers → nothing
    // audited → no implausible-volume observation.
    await step.do('data-quality-metrics', INGESTION_STEP_RETRY, async () => {
      const zeroPriceRejections = zeroPriceRejectionsOf(upserts.upsertErrors);
      recordZeroPriceRejections(env, zeroPriceRejections, config.merchantId);
      if (quality !== null) {
        recordImplausibleVolumeShare(
          env,
          quality.report.implausibleVolumeCount,
          quality.report.totalOffers,
        );
      }
      return { zeroPriceRejections, qualityReported: quality !== null };
    });

    log?.info({
      message: `Workflow pipeline run for "${config.merchantId}": ` +
        `${fetched.records.length} fetched, ${upserts.recordsAdded} added, ` +
        `${upserts.recordsUpdated} updated, ${upserts.offersChanged} offers changed, ` +
        `${upserts.upsertErrors.length} upsert errors`,
      merchantId: config.merchantId,
      dedupeKey: params.dedupeKey,
    });

    return await finalize({
      productsIngested: upserts.recordsAdded + upserts.recordsUpdated,
      errors: [
        ...fetched.errors,
        ...upserts.upsertErrors,
        // The failed unit-window check lands in the run's error list — a
        // completed-with-errors run (retry cannot fix feed data), matching
        // the in-band error pattern of upsert failures.
        ...(quality?.unitVolumeViolations ?? []),
      ],
    });
  } catch (err) {
    // Terminal failure (a step exhausted its retries and the error
    // surfaced here): release the claim BEFORE the instance errors so
    // the dedupe key never suppresses its own retry.
    await step.do('release-job-claim', INGESTION_STEP_RETRY, () =>
      claims.release(env, params.dedupeKey),
    );
    throw err;
  }
}
