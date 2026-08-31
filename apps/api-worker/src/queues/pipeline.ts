/**
 * Ingestion pipeline composition for the API Worker (task 4.1, design
 * D6) — the Worker counterpart of the Nest composition root.
 *
 * Everything is constructed manually from the real production classes:
 * core-domain engines (plain TS, G3-proven in a Worker — imports go
 * through src/adapters/core-domain-bridge.ts, the bundle alias target),
 * data-acquisition pipeline services (source-file imports — the package
 * barrel pulls @nestjs/bull and must stay out of a Worker bundle), and
 * the D1/R2 port adapters of task 2.3/2.5. No Nest container — which is
 * what keeps the flow re-hostable: task 4.2 moves the invocation into a
 * Workflow behind the same {@link runIngestion} interface.
 *
 * Governance stays fail-closed (the SourceGovernanceService semantics of
 * the BullMQ scheduler): the default repository is the process-local
 * in-memory store (no governance table exists in the schema yet — the
 * same Phase-1 state as the backend), so absent records, a governance
 * error, or any status other than GRANTED gate the merchant out before
 * any fetch or persistence.
 *
 * @module IngestionPipeline
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
import type { ISourceGovernanceRepository } from '@rajahinta/core-domain';
// Not re-exported from the core-domain barrel — direct source imports
// (the same classes the G3 spike composed).
import { ClassificationGateService } from '../../../../packages/core-domain/src/normalization/classification-gate.service';
import { ConfidenceFrameworkService } from '../../../../packages/core-domain/src/reliability/confidence-framework.service';
import { ContentLintService } from '../../../../packages/data-acquisition/src/content/content-lint.service';
import { DataMappingService } from '../../../../packages/data-acquisition/src/services/data-mapping.service';
import { DataQualityService } from '../../../../packages/data-acquisition/src/services/data-quality.service';
import { FeedIngestionService } from '../../../../packages/data-acquisition/src/services/feed-ingestion.service';
import { PipelineOrchestratorService } from '../../../../packages/data-acquisition/src/services/pipeline-orchestrator.service';
import { AlkoFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/alko.adapter';
import { SystembolagetFeedAdapter } from '../../../../packages/data-acquisition/src/adapters/systembolaget.adapter';
import type { IFeedAdapter } from '../../../../packages/data-acquisition/src/interfaces/feed-adapter.interface';
import type { MerchantConfig } from '../../../../packages/data-acquisition/src/interfaces/merchant-config.interface';
import { merchantConfigFromRegistry } from '../../../../packages/data-acquisition/src/interfaces/merchant-config.interface';
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
import { D1UpsertRepository } from '../adapters/d1-upsert.repository';
import { D1ProductDataPort, D1TransportOfferQuery } from '../adapters/d1-domain-ports';
import { OfferChangeRecorderHook } from '../adapters/offer-change-recorder-hook';
import { observationLogStore } from '../adapters/r2-observation-log.store';

/**
 * The narrow invocation surface the Queue consumer calls (and task 4.2's
 * Workflow will call): run one merchant's ingestion pipeline end to end.
 * Keeping the flow behind this interface is what makes the Workflow
 * re-host a drop-in.
 */
export interface IngestionPipeline {
  /** Run the full fetch → map → lint → upsert → observe flow for one merchant. */
  runForMerchant(
    config: MerchantConfig,
  ): Promise<Awaited<ReturnType<PipelineOrchestratorService['runForMerchant']>>>;
}

/** Composition seam for tests — swap any store/repository backing. */
export interface PipelineCompositionOptions {
  /** Governance backing; default is the process-local in-memory store. */
  readonly governanceRepository?: ISourceGovernanceRepository;
  /** Observation log binding override (tests use an in-memory store). */
  readonly observationStoreOverride?: ObservationLogStore;
}

/** D1-backed merchant registry (task 2.5). */
export function composeMerchantRegistry(env: Env): D1MerchantRegistryRepository {
  return new D1MerchantRegistryRepository(env.DB);
}

/**
 * Governance service over the given (default: in-memory, fail-closed)
 * repository — the same GRANTED-only gate the BullMQ scheduler and the
 * pipeline orchestrator applied.
 */
export function composeGovernanceService(
  repository: ISourceGovernanceRepository = new InMemorySourceGovernanceRepository(),
): SourceGovernanceService {
  return new SourceGovernanceService(repository);
}

/** D1-backed FX dataset service — shared by the FX review cron and the Systembolaget SEK→EUR conversion. */
export function composeFxRateDatasetService(env: Env): FxRateDatasetService {
  return new FxRateDatasetService(
    new D1FxRateDatasetRepositoryAdapter(new D1FxRateRepository(env.DB)),
  );
}

/**
 * Compose the ingestion pipeline over the Worker bindings.
 *
 * Feed adapters register under their merchantId exactly as the
 * DataAcquisitionModule factory did (systembolaget, alko); the
 * offer-change hook appends one R2 observation per changed offer.
 */
export function composeIngestionPipeline(
  env: Env,
  options: PipelineCompositionOptions = {},
): IngestionPipeline {
  // Data acquisition services
  const fxDatasets = composeFxRateDatasetService(env);
  const adapters = new Map<string, IFeedAdapter>();
  const systembolaget = new SystembolagetFeedAdapter(fxDatasets);
  const alko = new AlkoFeedAdapter();
  adapters.set(systembolaget.merchantId, systembolaget);
  adapters.set(alko.merchantId, alko);
  const feedIngestion = new FeedIngestionService(adapters);
  const dataMapping = new DataMappingService();
  const dataQuality = new DataQualityService(new ReliabilityService());
  const contentLint = new ContentLintService();

  // Write port + governance gate
  const upsertRepository = new D1UpsertRepository(env.DB);
  const governance = composeGovernanceService(options.governanceRepository);

  // Offer-change hook → core-domain recorder → R2 observation log
  const gate = new ClassificationGateService();
  const taxRules = new D1TaxRuleRepositoryAdapter(env.DB);
  const alcoholExcise = new AlcoholExciseService(taxRules);
  const containerDuty = new ContainerDutyService(taxRules);
  const transportEstimation = new TransportEstimationService(
    new D1TransportOfferQuery(new D1TransportOfferRepository(env.DB)),
  );
  const confidence = new ConfidenceFrameworkService(new ReliabilityService());
  const recorder = new PriceObservationRecorderService(
    gate,
    alcoholExcise,
    containerDuty,
    transportEstimation,
    confidence,
    new D1ProductDataPort(new D1ProductSearchRepository(env.DB)),
    new R2PriceObservationPort(
      options.observationStoreOverride ?? observationLogStore(env),
    ),
  );
  const offerChangeHook = new OfferChangeRecorderHook(recorder);

  const pipeline = new PipelineOrchestratorService(
    feedIngestion,
    dataMapping,
    dataQuality,
    upsertRepository,
    governance,
    contentLint,
    offerChangeHook,
  );

  return {
    runForMerchant: (config) => pipeline.runForMerchant(config),
  };
}

export { merchantConfigFromRegistry };
