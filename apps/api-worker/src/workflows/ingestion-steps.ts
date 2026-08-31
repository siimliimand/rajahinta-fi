/**
 * Ingestion Workflow step orchestration (task 4.2, design D6) — the
 * Cloudflare-free core of the price-ingestion Workflow.
 *
 * The pipeline stages of PipelineOrchestratorService become durable
 * Workflow steps, one per stage, in the orchestrator's real order:
 * resolve merchant → governance gate → fetch feed → map (+ lint) →
 * upsert (+ offer-change hook) → data quality. Each step runs under
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
  FxRateDatasetService,
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
import { SystembolagetFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/systembolaget.adapter';
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
import { InMemorySourceGovernanceRepository } from '../../../../packages/application-api/src/ops/governance/in-memory-source-governance.repository';
import { D1MerchantRegistryRepository } from '../../../../packages/data-platform/src/repositories/d1/merchant-registry.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1TaxRuleRepositoryAdapter } from '../../../../packages/data-platform/src/repositories/d1/tax-rate.repository';
import { D1TransportOfferRepository } from '../../../../packages/data-platform/src/repositories/d1/transport-offer.repository';
import { D1FxRateRepository } from '../../../../packages/data-platform/src/repositories/d1/fx-rate.repository';
import { D1FxRateDatasetRepositoryAdapter } from '../../../../packages/data-platform/src/repositories/d1/fx-rate-port.adapter';
import { R2PriceObservationPort } from '../../../../packages/data-platform/src/repositories/d1/price-observation.repository';
import type { ObservationLogStore } from '../../../../packages/data-platform/src/d1/observation-log';
import type { Env } from '../env';
import { completeJob, releaseJob } from '../do/client';
import { D1UpsertRepository } from '../adapters/d1-upsert.repository';
import {
  D1ProductDataPort,
  D1TransportOfferQuery,
} from '../adapters/d1-domain-ports';
import { OfferChangeRecorderHook } from '../adapters/offer-change-recorder-hook';
import { observationLogStore } from '../adapters/r2-observation-log.store';
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
  readonly mapping: DataMappingService;
  readonly contentLint: ContentLintService;
  readonly upserts: IUpsertRepository;
  readonly dataQuality: DataQualityService;
  /** Optional exactly as in PipelineOrchestratorService — hosts without a recorder run unchanged. */
  readonly offerChangeHook?: IOfferChangeHook;
}

/** Composition overrides (tests / alternative backing stores). */
export interface IngestionStageCompositionOptions {
  /** Governance backing; default is the process-local fail-closed store. */
  readonly governanceRepository?: ISourceGovernanceRepository;
  /** Observation log binding override (tests use an in-memory store). */
  readonly observationStoreOverride?: ObservationLogStore;
  /** Feed adapters; default registers systembolaget + alko as pipeline.ts does. */
  readonly feedAdaptersOverride?: Map<string, IFeedAdapter>;
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
  const fxDatasets = new FxRateDatasetService(
    new D1FxRateDatasetRepositoryAdapter(new D1FxRateRepository(env.DB)),
  );

  const adapters =
    options.feedAdaptersOverride ??
    (() => {
      const map = new Map<string, IFeedAdapter>();
      const systembolaget = new SystembolagetFeedAdapter(fxDatasets);
      const alko = new AlkoFeedAdapter();
      map.set(systembolaget.merchantId, systembolaget);
      map.set(alko.merchantId, alko);
      return map;
    })();

  const upsertRepository =
    options.upsertRepositoryOverride ?? new D1UpsertRepository(env.DB);
  const governance = new SourceGovernanceService(
    options.governanceRepository ?? new InMemorySourceGovernanceRepository(),
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
}

/** map-records step output (mapping + content lint). */
export interface MappedRecords {
  readonly pairs: readonly SerializedMappedPair[];
  readonly contentViolations: readonly ContentViolation[];
}

/** Per-offer state the quality step consumes (observedAt serialized). */
export interface SerializedQualityOffer {
  readonly merchant: string;
  readonly productId: number;
  readonly observedAtIso: string;
  readonly reliabilityStatus: string;
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
      };
    }),
    contentViolations,
  };
}

/** upsert-offers — the orchestrator's upsert loop + offer-change hook. */
export async function upsertOffersStep(
  services: IngestionStageServices,
  config: MerchantConfig,
  mapped: MappedRecords,
): Promise<UpsertOutcome> {
  let recordsAdded = 0;
  let recordsUpdated = 0;
  let offersChanged = 0;
  const upsertErrors: string[] = [];
  const upsertedOffers: SerializedQualityOffer[] = [];

  for (const pair of mapped.pairs) {
    try {
      const upsertResult = await services.upserts.upsertProduct(pair.product);
      if (upsertResult.created) {
        recordsAdded++;
      } else {
        recordsUpdated++;
      }

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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown upsert error';
      upsertErrors.push(
        `Failed to upsert product "${pair.product.name}": ${message}`,
      );
    }
  }

  return { recordsAdded, recordsUpdated, offersChanged, upsertErrors, upsertedOffers };
}

/** data-quality step — run only when at least one offer was upserted. */
export async function dataQualityStep(
  services: IngestionStageServices,
  upserted: readonly SerializedQualityOffer[],
): Promise<DataQualityReport | null> {
  if (upserted.length === 0) return null;
  return services.dataQuality.runQualityCheck(
    upserted.map((offer) => ({
      merchant: offer.merchant,
      productId: offer.productId,
      observedAt: new Date(offer.observedAtIso),
      reliabilityStatus: offer.reliabilityStatus,
    })),
  );
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
    const fetched = await step.do('fetch-feed', INGESTION_STEP_RETRY, () =>
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

    // -- Step 5: upsert (+ offer-change hook) ------------------------------
    const upserts = await step.do('upsert-offers', INGESTION_STEP_RETRY, () =>
      upsertOffersStep(services, config, mapped),
    );

    // -- Step 6: data quality ----------------------------------------------
    await step.do('data-quality', INGESTION_STEP_RETRY, () =>
      dataQualityStep(services, upserts.upsertedOffers),
    );

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
      errors: [...fetched.errors, ...upserts.upsertErrors],
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
