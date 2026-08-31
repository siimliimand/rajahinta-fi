/**
 * Integration test — historical price intelligence on D1 + R2 (task 2.7,
 * change migrate-to-cloudflare). D1 port of
 * tests/integration/historical-price-flow.test.ts; the pg original stays
 * untouched until cutover.
 *
 * The pg suite was already implementation-agnostic (in-memory stores
 * implementing the data-platform abstracts); the port swaps exactly those
 * stores for the Cloudflare stack and keeps every behavioral assertion:
 *
 *   - observations: R2JsonlObservationStore (tests/integration/d1/harness)
 *     — appends through the REAL R2PriceObservationPort into the 2.3
 *     JSONL layout, reads replayed per design D4 amended;
 *   - summaries: D1PriceHistorySummaryRepository (real SQLite, migrations
 *     applied) — the long-term analytical record;
 *   - watermarks: D1AggregationWatermarkRepository.
 *
 * Everything else is the proven composition: real engines (golden-dataset
 * wiring), the real ingestion pipeline, the REAL TimeSeriesAggregation
 * Worker (proving watermark-scan parity over the R2 layout through the
 * same class the pg stack used), and the real HistoricalDataController
 * over HTTP with read-time tax attribution.
 *
 * @module HistoricalPriceFlowD1IntegrationTest
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Job } from 'bullmq';

// --- core-domain: types/tokens via index, engines via deep paths (golden
// --- convention, identical to the pg suite) ---
import {
  PriceObservationRecorderService,
  TaxChangeAttributionService,
  TAX_RULE_REPOSITORY_PORT,
  type ITaxRuleRepositoryPort,
  type TaxRuleRecordPort,
  type ITransportOfferQuery,
  type TransportOffer,
  type CalculatorProductData,
  TAX_TYPES,
} from '@rajahinta/core-domain';
import { ClassificationGateService } from '@rajahinta/core-domain/normalization/classification-gate.service';
import { AlcoholExciseService } from '@rajahinta/core-domain/tax/services/alcohol-excise.service';
import { ContainerDutyService } from '@rajahinta/core-domain/tax/services/container-duty.service';
import { TransportEstimationService } from '@rajahinta/core-domain/transport/transport-estimation.service';
import { ConfidenceFrameworkService } from '@rajahinta/core-domain/reliability/confidence-framework.service';
import { ReliabilityService } from '@rajahinta/core-domain/reliability/reliability.service';
import { SourceGovernanceService } from '@rajahinta/core-domain/governance/services/source-governance.service';
import type {
  ISourceGovernanceRepository,
  SourceGovernanceRecord,
} from '@rajahinta/core-domain/governance/ports/source-governance-repository.port';
import type { PermissionCheckResult } from '@rajahinta/core-domain/governance/source-governance.types';

// --- data-platform: abstract repository classes + record types ---
import {
  PriceObservationRepository,
  PriceHistorySummaryRepository,
  ProductRepository,
  type PriceHistorySummaryUpsertInput,
} from '@rajahinta/data-platform';

// --- data-acquisition: real pipeline services ---
import {
  PipelineOrchestratorService,
} from '../../../packages/data-acquisition/src/services/pipeline-orchestrator.service';
import {
  FeedIngestionService,
} from '../../../packages/data-acquisition/src/services/feed-ingestion.service';
import {
  DataMappingService,
} from '../../../packages/data-acquisition/src/services/data-mapping.service';
import {
  DataQualityService,
} from '../../../packages/data-acquisition/src/services/data-quality.service';
import {
  ContentLintService,
} from '../../../packages/data-acquisition/src/content/content-lint.service';
import type {
  IFeedAdapter,
  RawFeedRecord,
} from '../../../packages/data-acquisition/src/interfaces/feed-adapter.interface';
import type {
  MerchantConfig,
} from '../../../packages/data-acquisition/src/config/merchants.config';
import type {
  IUpsertRepository,
  UpsertProductInput,
  UpsertOfferInput,
  UpsertResult,
  UpsertOfferResult,
} from '../../../packages/data-acquisition/src/interfaces/upsert-port.interface';
import {
  QUEUES,
} from '../../../packages/data-acquisition/src/index';

// --- application-api: HTTP layer + guard modules ---
import {
  HistoricalDataController,
  FeatureFlagsModule,
  RateLimitingModule,
  AgeGateModule,
  RATE_LIMITER,
} from '@rajahinta/application-api';
// Worker class is not re-exported from the package index — deep import.
import {
  TimeSeriesAggregationWorker,
  type TimeSeriesAggregationJobData,
} from '../../../packages/application-api/src/jobs/workers/time-series-aggregation.worker';
// Task-2.2 composition glue (apps/backend) — the offer-change hook adapter.
import { OfferChangeRecorderHook } from '../../../apps/backend/src/adapters/offer-change-recorder-hook.adapter';

// --- D1/R2 harness: migrated D1 + R2 JSONL observation store ---
import {
  openMigratedD1,
  R2JsonlObservationStore,
} from './harness';
import { D1AggregationWatermarkRepository } from '../../../packages/data-platform/src/repositories/d1/aggregation-watermark.repository';
import { D1PriceHistorySummaryRepository } from '../../../packages/data-platform/src/repositories/d1/price-history-summary.repository';

// ---------------------------------------------------------------------------
// Tax-rule seed — two excise versions with a boundary at 2026-01-02T00:00Z
// (identical to the pg suite)
// ---------------------------------------------------------------------------

const V1_FROM = new Date('2024-01-01T00:00:00Z');
const EXCISE_BOUNDARY = new Date('2026-01-02T00:00:00Z');
const V1_LABEL = 'v1.0-2024';
const V2_LABEL = '2026-01';

function exciseRule(
  id: number,
  rate: string,
  from: Date,
  to: Date | null,
  label: string,
  tier: Record<string, number>,
): TaxRuleRecordPort {
  return {
    id,
    taxType: TAX_TYPES.excise,
    productCategory: 'beer',
    rate,
    effectiveFrom: from,
    effectiveTo: to,
    calculationFormulaReference: 'PER_DEGREE_PLATO',
    officialSource: 'Finnish Tax Administration (vero.fi) — integration fixture',
    verificationDate: new Date('2024-03-01'),
    versionLabel: label,
    exemptionConditions: tier,
  };
}

/** Container duty — one version spanning the whole timeline (no boundary). */
const CONTAINER_DUTY_RULE: TaxRuleRecordPort = {
  id: 25,
  taxType: TAX_TYPES.containerDuty,
  productCategory: 'all_beverages',
  rate: '0.51',
  effectiveFrom: V1_FROM,
  effectiveTo: null,
  calculationFormulaReference: 'FLAT_PER_LITRE',
  officialSource: 'Finnish Tax Administration (vero.fi) — integration fixture',
  verificationDate: new Date('2024-03-01'),
  versionLabel: V1_LABEL,
  exemptionConditions: null,
};

const SEED_RULES: TaxRuleRecordPort[] = [
  // Excise beer v1 — effective strictly before the boundary.
  exciseRule(1, '0.00', V1_FROM, EXCISE_BOUNDARY, V1_LABEL, { maxAlcoholByVolume: 0.5 }),
  exciseRule(101, '28.35', V1_FROM, EXCISE_BOUNDARY, V1_LABEL, { minAlcoholByVolume: 0.5, maxAlcoholByVolume: 3.5 }),
  exciseRule(102, '36.20', V1_FROM, EXCISE_BOUNDARY, V1_LABEL, { minAlcoholByVolume: 3.5 }),
  // Excise beer v2 — effective from the boundary (rate rises to 40 ¢/cl).
  exciseRule(2, '0.00', EXCISE_BOUNDARY, null, V2_LABEL, { maxAlcoholByVolume: 0.5 }),
  exciseRule(103, '28.35', EXCISE_BOUNDARY, null, V2_LABEL, { minAlcoholByVolume: 0.5, maxAlcoholByVolume: 3.5 }),
  exciseRule(104, '40.00', EXCISE_BOUNDARY, null, V2_LABEL, { minAlcoholByVolume: 3.5 }),
  CONTAINER_DUTY_RULE,
];

/**
 * Time-aware in-memory tax-rule repository (the pg suite's own class, kept
 * byte-for-byte): `asOf` selects rules effective at the instant,
 * `findHistoryRates` returns windows overlapping the range. The engines and
 * the attribution join share this one time-aware rule set.
 */
class InMemoryTaxRuleRepository implements ITaxRuleRepositoryPort {
  private effectiveAt(rule: TaxRuleRecordPort, at: Date): boolean {
    return (
      rule.effectiveFrom.getTime() <= at.getTime() &&
      (rule.effectiveTo === null || rule.effectiveTo.getTime() > at.getTime())
    );
  }

  private overlaps(rule: TaxRuleRecordPort, from: Date, to: Date): boolean {
    return (
      rule.effectiveFrom.getTime() < to.getTime() &&
      (rule.effectiveTo === null || rule.effectiveTo.getTime() > from.getTime())
    );
  }

  async findApplicable(
    taxType: string,
    productCategory: string,
    asOf?: Date,
  ): Promise<TaxRuleRecordPort | null> {
    const at = asOf ?? new Date();
    return (
      SEED_RULES.find(
        (r) =>
          r.taxType === taxType &&
          r.productCategory === productCategory &&
          this.effectiveAt(r, at),
      ) ?? null
    );
  }

  async findAllApplicable(
    taxType: string,
    productCategory: string,
    asOf?: Date,
  ): Promise<TaxRuleRecordPort[]> {
    const at = asOf ?? new Date();
    return SEED_RULES.filter(
      (r) =>
        r.taxType === taxType &&
        r.productCategory === productCategory &&
        this.effectiveAt(r, at),
    );
  }

  async findHistoryRates(
    taxType: string,
    productCategory: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<TaxRuleRecordPort[]> {
    return SEED_RULES.filter(
      (r) =>
        r.taxType === taxType &&
        r.productCategory === productCategory &&
        this.overlaps(r, fromDate, toDate),
    );
  }

  async findActiveVersionLabels(): Promise<readonly string[]> {
    const now = new Date();
    const labels = SEED_RULES.filter((r) => this.effectiveAt(r, now)).map(
      (r) => r.versionLabel,
    );
    return [...new Set(labels)];
  }
}

// ---------------------------------------------------------------------------
// In-memory transport offers (domain port)
// ---------------------------------------------------------------------------

const TRANSPORT_OBSERVED_AT = new Date('2026-01-01T00:00:00Z');

const TRANSPORT_OFFERS: TransportOffer[] = [
  {
    id: 900,
    carrier: 'beverage-de',
    originCountry: 'DE',
    destinationCountry: 'FI',
    weightBracket: { minKg: 0, maxKg: 1 },
    packageTier: 'can',
    priceCents: 150,
    currency: 'EUR',
    sellerInvolvementIndicator: true,
    observedAt: TRANSPORT_OBSERVED_AT,
    refreshedAt: TRANSPORT_OBSERVED_AT,
    reliabilityStatus: 'EXACT',
  },
  {
    id: 901,
    carrier: 'systembolaget',
    originCountry: 'DE',
    destinationCountry: 'FI',
    weightBracket: { minKg: 0, maxKg: 1 },
    packageTier: 'can',
    priceCents: 180,
    currency: 'EUR',
    sellerInvolvementIndicator: true,
    observedAt: TRANSPORT_OBSERVED_AT,
    refreshedAt: TRANSPORT_OBSERVED_AT,
    reliabilityStatus: 'EXACT',
  },
  // NOTE: no offer for 'pipeline-merchant' — its observations exercise the
  // recorder's graceful transport degradation (UNAVAILABLE, zero cost).
];

class InMemoryTransportOfferQuery implements ITransportOfferQuery {
  async findAllActive(): Promise<TransportOffer[]> {
    return TRANSPORT_OFFERS;
  }

  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    return TRANSPORT_OFFERS.filter((o) => o.carrier === carrierId);
  }
}

// ---------------------------------------------------------------------------
// D1 summary store — the real repository, instrumented with an upsert log
// (the pg suite's InMemorySummaryStore.upsertLog, preserving the
// "re-runs are incremental and idempotent" assertions).
// ---------------------------------------------------------------------------

class InstrumentedD1SummaryStore extends D1PriceHistorySummaryRepository {
  /** Upsert key log — proves re-runs write no redundant buckets. */
  readonly upsertLog: string[] = [];

  constructor(d1: ReturnType<typeof openMigratedD1>['d1']) {
    super(d1);
  }

  private static key(s: PriceHistorySummaryUpsertInput): string {
    return [s.granularity, s.periodStart, s.productId, s.merchant ?? '*'].join('|');
  }

  override async upsertBucket(
    summary: PriceHistorySummaryUpsertInput,
  ): Promise<{ id: number }> {
    this.upsertLog.push(InstrumentedD1SummaryStore.key(summary));
    return super.upsertBucket(summary);
  }
}

// ---------------------------------------------------------------------------
// Products — two shapes, mirroring production (identical to the pg suite)
// ---------------------------------------------------------------------------

/** Product 1 — golden beer fixture shape. */
const PRODUCT_BEER: CalculatorProductData = {
  id: 1,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.55,
  normalizedName: 'Premium Lager 5%',
};

/** Product 5 — driven through the ingestion pipeline (real clock). */
const PRODUCT_PIPELINE: CalculatorProductData = {
  id: 5,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.55,
  normalizedName: 'Pipeline Pilsner 5%',
};

class InMemoryProductDataPort {
  async findProductById(id: number): Promise<CalculatorProductData | null> {
    if (id === PRODUCT_BEER.id) return PRODUCT_BEER;
    if (id === PRODUCT_PIPELINE.id) return PRODUCT_PIPELINE;
    return null;
  }

  async findRetailOffers(): Promise<never[]> {
    return [];
  }
}

/** Controller-facing product rows (data-platform abstract). */
const PRODUCT_ROWS = {
  [PRODUCT_BEER.id]: {
    id: PRODUCT_BEER.id,
    name: 'Premium Lager 5%',
    manufacturer: 'Golden Brewery',
    brand: 'Golden',
    category: 'beer',
    alcoholByVolume: '0.05',
    unitVolume: '0.5',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: '0642000000015',
    createdAt: V1_FROM,
    updatedAt: V1_FROM,
  },
  [PRODUCT_PIPELINE.id]: {
    id: PRODUCT_PIPELINE.id,
    name: 'Pipeline Pilsner 5%',
    manufacturer: 'Probe Brewery',
    brand: 'Probe',
    category: 'beer',
    alcoholByVolume: '0.05',
    unitVolume: '0.5',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: '0501234500005',
    createdAt: V1_FROM,
    updatedAt: V1_FROM,
  },
};

class InMemoryProductRepository extends ProductRepository {
  async findById(
    id: number,
  ): Promise<(typeof PRODUCT_ROWS)[keyof typeof PRODUCT_ROWS] | null> {
    return PRODUCT_ROWS[id as keyof typeof PRODUCT_ROWS] ?? null;
  }

  async searchByName(): Promise<never[]> {
    throw new Error('not used in this flow');
  }
  async findOffers(): Promise<never[]> {
    throw new Error('not used in this flow');
  }
  async findRetailOfferById(): Promise<null> {
    throw new Error('not used in this flow');
  }
  async create(): Promise<never> {
    throw new Error('not used in this flow');
  }
  async upsertByEan(): Promise<never> {
    throw new Error('not used in this flow');
  }
}

// ---------------------------------------------------------------------------
// Pipeline harness (identical to the pg suite)
// ---------------------------------------------------------------------------

const PIPELINE_MERCHANT: MerchantConfig = {
  merchantId: 'pipeline-merchant',
  name: 'Pipeline Test Merchant',
  country: 'DE',
  feedUrl: 'https://feed.example.com/catalog',
  feedFormat: 'json',
  pollingIntervalMs: 3_600_000,
};

/** Mutable feed — each pipeline run fetches the current record set. */
class InMemoryFeedAdapter implements IFeedAdapter {
  readonly merchantId = PIPELINE_MERCHANT.merchantId;
  records: RawFeedRecord[] = [];

  async fetch(): Promise<{ records: RawFeedRecord[]; errors: string[] }> {
    return { records: this.records, errors: [] };
  }
}

/** Governance repository — one GRANTED source (permission gate passes). */
class InMemoryGovernanceRepository implements ISourceGovernanceRepository {
  private readonly record: SourceGovernanceRecord = {
    id: 1,
    merchantId: PIPELINE_MERCHANT.merchantId,
    acquisitionMethod: 'PERMITTED_FEED',
    permissionStatus: 'GRANTED',
    sourceUrl: PIPELINE_MERCHANT.feedUrl,
    statusReason: null,
    lastVerifiedAt: V1_FROM,
    createdAt: V1_FROM,
    updatedAt: V1_FROM,
  };

  async create(): Promise<SourceGovernanceRecord> {
    return this.record;
  }
  async updateStatus(): Promise<SourceGovernanceRecord | null> {
    return this.record;
  }
  async revokeAllByMerchantId(): Promise<number> {
    return 0;
  }
  async findByMerchantId(): Promise<SourceGovernanceRecord[]> {
    return [this.record];
  }
  async findById(): Promise<SourceGovernanceRecord | null> {
    return this.record;
  }
  async checkPermission(merchantId: string): Promise<PermissionCheckResult> {
    return {
      merchantId,
      permissionStatus: 'GRANTED',
      sources: [this.record],
      hasWarnings: false,
    };
  }
}

/**
 * In-memory upsert repository implementing the port's documented
 * change-detection contract (identical to the pg suite).
 */
class InMemoryUpsertRepository implements IUpsertRepository {
  private readonly productIds = new Map<string, number>();
  private nextProductId = 100;
  private nextOfferId = 1_000;
  private readonly offerSeries = new Map<string, number[]>(); // key → prices

  async upsertProduct(input: UpsertProductInput): Promise<UpsertResult> {
    const ean = input.ean ?? `${input.name}|${input.brand}|${input.containerType}|${input.unitVolume}`;
    const existing = this.productIds.get(ean);
    if (existing !== undefined) {
      return { productId: existing, created: false };
    }
    // Pre-seeded canonical IDs win (products 1 and 5 exist in the master).
    const nameToCanonical: Record<string, number> = {
      'Premium Lager 5%': PRODUCT_BEER.id,
      'Pipeline Pilsner 5%': PRODUCT_PIPELINE.id,
    };
    const id = nameToCanonical[input.name] ?? this.nextProductId++;
    this.productIds.set(ean, id);
    return { productId: id, created: true };
  }

  async upsertOffer(input: UpsertOfferInput): Promise<UpsertOfferResult> {
    const key = `${input.merchant}|${input.productId}`;
    const prices = this.offerSeries.get(key) ?? [];
    const changed = prices.length === 0 || prices[prices.length - 1] !== input.priceCents;
    prices.push(input.priceCents);
    this.offerSeries.set(key, prices);
    return { offerId: this.nextOfferId++, changed };
  }
}

function pipelineFeedRecord(priceCents: number): RawFeedRecord {
  return {
    productId: 'SKU-PIPELINE-1',
    productName: PRODUCT_PIPELINE.normalizedName,
    manufacturer: 'Probe Brewery',
    brand: 'Probe',
    category: 'beer',
    alcoholByVolume: 0.05,
    volumeMl: 500,
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystem: true,
    ean: PRODUCT_ROWS[PRODUCT_PIPELINE.id].ean,
    priceCents,
    currency: 'EUR',
    availability: 'in_stock',
    sourceUrl: 'https://feed.example.com/p/sku-pipeline-1',
  };
}

// ---------------------------------------------------------------------------
// Timeline fixtures (product 1) — expected engine outputs verified against
// the real engines (identical to the pg suite).
// ---------------------------------------------------------------------------

const TIMELINE = [
  { merchant: 'beverage-de', offerId: 100, priceCents: 200, at: '2026-01-01T10:00:00Z', landed: 441, exciseRuleId: 102 },
  { merchant: 'beverage-de', offerId: 101, priceCents: 200, at: '2026-01-02T10:00:00Z', landed: 450, exciseRuleId: 104 },
  { merchant: 'beverage-de', offerId: 102, priceCents: 250, at: '2026-01-03T10:00:00Z', landed: 500, exciseRuleId: 104 },
  { merchant: 'systembolaget', offerId: 103, priceCents: 300, at: '2026-01-01T12:00:00Z', landed: 571, exciseRuleId: 102 },
  { merchant: 'systembolaget', offerId: 104, priceCents: 300, at: '2026-01-02T12:00:00Z', landed: 580, exciseRuleId: 104 },
] as const;

/** Permissive rate limiter — never throttles during tests (e2e convention). */
const NEVER_RATE_LIMIT = {
  check: () => true,
  remaining: () => 999,
  resetAt: () => Date.now() + 60_000,
};

function makeJob(
  data: TimeSeriesAggregationJobData,
): Job<TimeSeriesAggregationJobData> {
  return { data, attemptsMade: 0 } as unknown as Job<TimeSeriesAggregationJobData>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Historical price intelligence on D1/R2 — ingestion → observation → aggregation → API', () => {
  // Real SQLite D1 with committed migrations.
  const { db, d1 } = openMigratedD1();

  // Shared stores — the single graph every stage reads/writes. The
  // observation store IS the R2 JSONL layout; summaries + watermarks are
  // the real D1 repositories.
  let idSeq = 0;
  const observations = new R2JsonlObservationStore(() => ++idSeq);
  const summaries = new InstrumentedD1SummaryStore(d1);
  const watermarks = new D1AggregationWatermarkRepository(d1);

  const taxRules = new InMemoryTaxRuleRepository();
  const productDataPort = new InMemoryProductDataPort();
  const productRepository = new InMemoryProductRepository();
  const feedAdapter = new InMemoryFeedAdapter();

  /**
   * All observations of a product, in SERIES order (observedAt, id) —
   * half-open range read from epoch to far future through the store's own
   * read path.
   */
  const rowsOf = async (productId: number) =>
    observations.findByProductRange(
      productId,
      new Date(0),
      new Date('2999-12-31T00:00:00Z'),
    );

  /** All observations of a product, in APPEND order (stage-1 view). */
  const appendedRowsOf = (productId: number) =>
    observations.appendedRows().filter((r) => r.productId === productId);

  // Real recorder wired with REAL engines (golden-dataset composition).
  const recorder = new PriceObservationRecorderService(
    new ClassificationGateService(),
    new AlcoholExciseService(taxRules),
    new ContainerDutyService(taxRules),
    new TransportEstimationService(new InMemoryTransportOfferQuery()),
    new ConfidenceFrameworkService(new ReliabilityService()),
    productDataPort,
    observations,
  );

  // Real task-2.2 glue: the composition-root hook adapter.
  const hook = new OfferChangeRecorderHook(recorder);

  // Real ingestion pipeline around the hook.
  const pipeline = new PipelineOrchestratorService(
    new FeedIngestionService(new Map([[feedAdapter.merchantId, feedAdapter]])),
    new DataMappingService(),
    new DataQualityService(new ReliabilityService()),
    new InMemoryUpsertRepository(),
    new SourceGovernanceService(new InMemoryGovernanceRepository()),
    new ContentLintService(),
    hook,
  );

  // Real aggregation worker over the R2 + D1 stores.
  const worker = new TimeSeriesAggregationWorker(
    observations,
    summaries,
    watermarks,
  );

  /** Full summary-row snapshot — (granularity, periodStart, merchant) keys. */
  const summaryKeysInD1 = (): string[] =>
    (
      db.prepare(
        `SELECT granularity, period_start, product_id, merchant
           FROM price_history_summaries ORDER BY id`,
      ).all() as unknown as {
        granularity: string;
        period_start: string;
        product_id: number;
        merchant: string | null;
      }[]
    ).map(
      (r) =>
        [r.granularity, r.period_start, r.product_id, r.merchant ?? '*'].join('|'),
    );

  let app: INestApplication;

  beforeAll(async () => {
    // price_history_summaries.product_id is an FK — the controller-facing
    // products live in the in-memory read model, but the D1 summaries the
    // worker writes need their parent rows.
    for (const product of [PRODUCT_BEER, PRODUCT_PIPELINE]) {
      await d1
        .prepare(
          `INSERT INTO product_master (id, name, manufacturer, brand, category,
              unit_volume, container_type, regulatory_classification)
           VALUES (?, ?, 'D1 Flow Fixture Brewery', 'D1 Flow Fixture', 'beer',
                   0.5, 'can', 'beer')`,
        )
        .bind(product.id, product.normalizedName)
        .run();
    }

    // Feature flag enabled via the documented env override — read once at
    // FeatureFlagService construction, so it must be set before compile.
    process.env.FF_HISTORICAL_PRICE_INTELLIGENCE = 'true';

    const moduleRef = await Test.createTestingModule({
      imports: [FeatureFlagsModule, RateLimitingModule, AgeGateModule],
      controllers: [HistoricalDataController],
      providers: [
        { provide: ProductRepository, useValue: productRepository },
        { provide: PriceHistorySummaryRepository, useValue: summaries },
        { provide: PriceObservationRepository, useValue: observations },
        TaxChangeAttributionService,
        // Engines resolve rules at observedAt; read-time attribution joins
        // the same time-aware in-memory rule set the recorder used.
        { provide: TAX_RULE_REPOSITORY_PORT, useValue: taxRules },
      ],
    })
      .overrideProvider(RATE_LIMITER)
      .useValue(NEVER_RATE_LIMIT)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.FF_HISTORICAL_PRICE_INTELLIGENCE;
    db.close();
  });

  // =====================================================================
  // Stage 1 — observation capture (pipeline → hook → recorder → R2 log)
  // =====================================================================

  describe('stage 1 — observation capture through the offer-change hook', () => {
    it('appends exactly one observation per CHANGED offer from a pipeline run', async () => {
      feedAdapter.records = [pipelineFeedRecord(220)];
      const report = await pipeline.runForMerchant(PIPELINE_MERCHANT);

      expect(report.offersChanged).toBe(1);
      expect(report.errors).toEqual([]);

      const rows = appendedRowsOf(PRODUCT_PIPELINE.id);
      expect(rows).toHaveLength(1);

      const row = rows[0];
      // Quantity=1 baseline through the real engines at observedAt=now:
      // excise v2 (40 ¢/cl → 100 ¢) + deposit-exempt container duty (0 ¢)
      // + NO transport offer for this merchant (degrades: 0 ¢, UNAVAILABLE).
      expect(row.foreignRetailPriceCents).toBe(220);
      expect(row.landedCostCents).toBe(320);
      expect(row.exciseRuleVersionId).toBe(104);
      expect(row.containerDutyRuleVersionId).toBeNull();
      expect(row.transportOfferId).toBeNull();
      expect(row.transportCostCents).toBe(0);
      expect(row.inputReliability).toEqual({
        retailPrice: 'ESTIMATED', // pipeline mapping stamps ESTIMATED
        transport: 'UNAVAILABLE', // no transport offer for this merchant
        exciseRule: 'VERIFIED',
        containerDutyRule: 'VERIFIED',
      });
    });

    it('appends NO observation for an unchanged re-scrape', async () => {
      feedAdapter.records = [pipelineFeedRecord(220)]; // same price again
      const report = await pipeline.runForMerchant(PIPELINE_MERCHANT);

      expect(report.offersChanged).toBe(0);
      expect(appendedRowsOf(PRODUCT_PIPELINE.id)).toHaveLength(1); // unchanged — the hook never fired
    });

    it('appends one more observation when the price moves on a later run', async () => {
      feedAdapter.records = [pipelineFeedRecord(240)];
      const report = await pipeline.runForMerchant(PIPELINE_MERCHANT);

      expect(report.offersChanged).toBe(1);
      const rows = appendedRowsOf(PRODUCT_PIPELINE.id);
      expect(rows).toHaveLength(2);
      expect(rows[1].foreignRetailPriceCents).toBe(240);
      expect(rows[1].landedCostCents).toBe(340); // 240 + 100 excise + 0 + 0
    });

    it('records the fixed January timeline through the hook with rule versions resolved at observedAt', async () => {
      for (const event of TIMELINE) {
        await hook.onOfferChanged({
          productId: PRODUCT_BEER.id,
          offerId: event.offerId,
          merchant: event.merchant,
          country: 'DE',
          priceCents: event.priceCents,
          reliabilityStatus: 'VERIFIED',
          observedAt: new Date(event.at),
        });
      }

      const rows = appendedRowsOf(PRODUCT_BEER.id);
      expect(rows).toHaveLength(TIMELINE.length);

      for (const [i, event] of TIMELINE.entries()) {
        expect(rows[i].merchant).toBe(event.merchant);
        expect(rows[i].retailOfferId).toBe(event.offerId);
        expect(rows[i].observedAt).toEqual(new Date(event.at));
        expect(rows[i].foreignRetailPriceCents).toBe(event.priceCents);
        expect(rows[i].landedCostCents).toBe(event.landed);
        // The snapshotted rule version flips exactly at the boundary —
        // recovered from the JSONL log's *_rule_version_id columns.
        expect(rows[i].exciseRuleVersionId).toBe(event.exciseRuleId);
        // Deposit-exempt → the container-duty engine applied no rule row.
        expect(rows[i].containerDutyRuleVersionId).toBeNull();
        expect(rows[i].inputReliability).toEqual({
          retailPrice: 'VERIFIED',
          transport: 'VERIFIED',
          exciseRule: 'VERIFIED',
          containerDutyRule: 'VERIFIED',
        });
        expect(rows[i].confidence).toBe('HIGH');
      }

      // Transport selection per merchant (baseline route DE → FI).
      expect(rows[0].transportOfferId).toBe(900);
      expect(rows[0].transportCostCents).toBe(150);
      expect(rows[3].transportOfferId).toBe(901);
      expect(rows[3].transportCostCents).toBe(180);
    });
  });

  // =====================================================================
  // Stage 2 — aggregation (watermark-driven materialization into D1)
  // =====================================================================

  describe('stage 2 — TimeSeriesAggregationWorker materialization', () => {
    it('first run aggregates the full R2 log and advances the watermark from null', async () => {
      await worker.process(makeJob({}));

      // Watermark advanced from null to the latest observedAt in the log,
      // persisted in the D1 aggregation_watermarks table.
      const expected = new Date(
        Math.max(
          ...(await rowsOf(PRODUCT_BEER.id)).concat(await rowsOf(PRODUCT_PIPELINE.id))
            .map((r) => r.observedAt.getTime()),
        ),
      );
      expect(
        await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION),
      ).toEqual(expected);
      expect(summaries.upsertLog.length).toBeGreaterThan(0);
    });

    it('a pure watermark-driven re-run is incremental and idempotent', async () => {
      const keysBefore = summaryKeysInD1().sort();
      const watermarkBefore = await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION);
      // How many times each January bucket was written before the re-run.
      const januaryWritesBefore = summaries.upsertLog.filter((k) =>
        k.includes('|2026-01-0'),
      ).length;
      expect(januaryWritesBefore).toBeGreaterThan(0);

      await worker.process(makeJob({}));

      // Boundary instant is inclusively re-scanned (protocol), but the
      // January rows sit strictly BELOW the watermark — none of their
      // buckets may be re-written by the incremental scan.
      expect(
        summaries.upsertLog.filter((k) => k.includes('|2026-01-0')).length,
      ).toBe(januaryWritesBefore);
      // Idempotent re-scan: same bucket set, watermark unchanged.
      expect(summaryKeysInD1().sort()).toEqual(keysBefore);
      expect(await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION)).toEqual(
        watermarkBefore,
      );
    });

    it('an explicit bucketStart window re-aggregates below the watermark without regressing it', async () => {
      const watermarkBefore = await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION);

      // Explicit window start below the cursor (backfill / late-correction
      // trigger) lowers the scan so the January rows are re-aggregated.
      await worker.process(makeJob({ bucketStart: '2026-01-01T00:00:00.000Z' }));

      // Watermark never regresses to the re-scan window.
      expect(await watermarks.find(QUEUES.TIME_SERIES_AGGREGATION)).toEqual(
        watermarkBefore,
      );

      // Product-wide daily buckets for the January timeline, read back
      // from D1.
      const daily = await summaries.findByProductRange(
        PRODUCT_BEER.id,
        'daily',
        '2026-01-01',
        '2026-01-03',
      );
      expect(daily.map((d) => d.periodStart)).toEqual([
        '2026-01-01',
        '2026-01-02',
        '2026-01-03',
      ]);

      // 2026-01-01: beverage-de 10:00 (200/441) then systembolaget 12:00 (300/571).
      expect(daily[0]).toMatchObject({
        granularity: 'daily',
        productId: PRODUCT_BEER.id,
        merchant: null,
        priceOpenCents: 200,
        priceCloseCents: 300,
        priceMinCents: 200,
        priceMaxCents: 300,
        priceAvgCents: 250,
        landedCostOpenCents: 441,
        landedCostCloseCents: 571,
        landedCostMinCents: 441,
        landedCostMaxCents: 571,
        landedCostAvgCents: 506, // (441 + 571) / 2
        observationCount: 2,
        strictestReliability: 'VERIFIED',
      });

      // 2026-01-02: same retail prices, excise v2 lifts landed costs.
      expect(daily[1]).toMatchObject({
        periodStart: '2026-01-02',
        priceOpenCents: 200,
        priceCloseCents: 300,
        priceAvgCents: 250,
        landedCostOpenCents: 450,
        landedCostCloseCents: 580,
        landedCostMinCents: 450,
        landedCostMaxCents: 580,
        landedCostAvgCents: 515, // (450 + 580) / 2
        observationCount: 2,
        strictestReliability: 'VERIFIED',
      });

      // 2026-01-03: single observation of the merchant price move.
      expect(daily[2]).toMatchObject({
        periodStart: '2026-01-03',
        priceOpenCents: 250,
        priceCloseCents: 250,
        priceMinCents: 250,
        priceMaxCents: 250,
        priceAvgCents: 250,
        landedCostOpenCents: 500,
        landedCostCloseCents: 500,
        landedCostAvgCents: 500,
        observationCount: 1,
        strictestReliability: 'VERIFIED',
      });

      // Weekly bucket — ISO week anchored on Monday 2025-12-29 holds all
      // five observations; avg rounded half-up: price 1250/5 = 250,
      // landed (441+450+500+571+580)/5 = 508.4 → 508.
      const weekly = await summaries.findByProductRange(
        PRODUCT_BEER.id,
        'weekly',
        '2025-12-29',
        '2026-01-04',
      );
      expect(weekly).toHaveLength(1);
      expect(weekly[0]).toMatchObject({
        periodStart: '2025-12-29',
        priceOpenCents: 200,
        priceCloseCents: 250,
        priceMinCents: 200,
        priceMaxCents: 300,
        priceAvgCents: 250,
        landedCostOpenCents: 441,
        landedCostCloseCents: 500,
        landedCostMinCents: 441,
        landedCostMaxCents: 580,
        landedCostAvgCents: 508,
        observationCount: 5,
        strictestReliability: 'VERIFIED',
      });

      // Per-merchant rows exist alongside the product-wide rows.
      const merchantRows = await summaries.findByProductRange(
        PRODUCT_BEER.id,
        'daily',
        '2026-01-01',
        '2026-01-03',
        'beverage-de',
      );
      expect(merchantRows.map((r) => r.periodStart)).toEqual([
        '2026-01-01',
        '2026-01-02',
        '2026-01-03',
      ]);
      expect(merchantRows.every((r) => r.observationCount === 1)).toBe(true);
    });

    it('re-running the backfill window converges (idempotent upserts, same bucket set)', async () => {
      const bucketKeysBefore = summaryKeysInD1().sort();
      await worker.process(makeJob({ bucketStart: '2026-01-01T00:00:00.000Z' }));
      expect(summaryKeysInD1().sort()).toEqual(bucketKeysBefore);
    });
  });

  // =====================================================================
  // Stage 3 — API (series from D1 summaries + read-time attribution)
  // =====================================================================

  describe('stage 3 — GET /api/v1/products/:id/price-history (flag enabled)', () => {
    const get = (query: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/products/${PRODUCT_BEER.id}/price-history?${query}`)
        .set('x-age-confirmed', 'test-token');

    it('serves the daily price series from the materialized D1 summaries', async () => {
      const res = await get('from=2026-01-01&to=2026-01-03').expect(200);

      expect(res.body.productId).toBe(PRODUCT_BEER.id);
      expect(res.body.merchant).toBeNull();
      expect(res.body.metric).toBe('price');
      expect(res.body.granularity).toBe('day');
      expect(res.body.from).toBe('2026-01-01');
      expect(res.body.to).toBe('2026-01-03');

      const series = res.body.series;
      expect(series).toHaveLength(3);
      expect(series[0]).toEqual({
        periodStart: '2026-01-01',
        openCents: 200,
        closeCents: 300,
        minCents: 200,
        maxCents: 300,
        avgCents: 250,
        observationCount: 2,
        reliability: 'VERIFIED',
      });
      expect(series[1].periodStart).toBe('2026-01-02');
      expect(series[1].avgCents).toBe(250);
      expect(series[2].periodStart).toBe('2026-01-03');
      expect(series[2].observationCount).toBe(1);
    });

    it('projects the landed-cost metric from the same D1 summaries', async () => {
      const res = await get(
        'from=2026-01-01&to=2026-01-03&metric=landed-cost',
      ).expect(200);

      expect(res.body.metric).toBe('landed-cost');
      const series = res.body.series;
      expect(series).toHaveLength(3);
      expect(series[0]).toEqual({
        periodStart: '2026-01-01',
        openCents: 441,
        closeCents: 571,
        minCents: 441,
        maxCents: 571,
        avgCents: 506,
        observationCount: 2,
        reliability: 'VERIFIED',
      });
      expect(series[2].openCents).toBe(500);
      expect(series[2].closeCents).toBe(500);
    });

    it('serves the weekly series anchored on the ISO week Monday', async () => {
      // Range filters on the period ANCHOR: the week containing 2026-01-01
      // starts on Monday 2025-12-29, so `from` must cover that anchor.
      const res = await get(
        'from=2025-12-29&to=2026-01-03&granularity=week',
      ).expect(200);

      expect(res.body.granularity).toBe('week');
      expect(res.body.series).toHaveLength(1);
      expect(res.body.series[0]).toEqual({
        periodStart: '2025-12-29',
        openCents: 200,
        closeCents: 250,
        minCents: 200,
        maxCents: 300,
        avgCents: 250,
        observationCount: 5,
        reliability: 'VERIFIED',
      });
    });

    it('attributes the injected tax-rule boundary with bounding version labels', async () => {
      const res = await get('from=2026-01-01&to=2026-01-03').expect(200);

      const attribution = res.body.attribution;
      expect(attribution).toHaveLength(3);

      // Deterministic order: chronological by toObservedAt.
      const [taxA, taxB, priceMove] = attribution;
      expect(taxA.merchant).toBe('beverage-de');
      expect(taxB.merchant).toBe('systembolaget');
      expect(priceMove.merchant).toBe('beverage-de');

      // Both merchants crossed the injected excise boundary with an
      // unchanged price and unchanged transport — pure tax-rule steps.
      expect(taxA.toObservedAt).toBe('2026-01-02T10:00:00.000Z');
      expect(taxB.toObservedAt).toBe('2026-01-02T12:00:00.000Z');
      for (const entry of [taxA, taxB]) {
        expect(entry.classification).toBe('TAX_RULE_CHANGE');
        expect(entry.movedInputs).toEqual({
          exciseRule: true,
          containerDutyRule: false,
          merchantPrice: false,
          transport: false,
        });
        expect(entry.exciseRuleBoundary).toEqual({
          fromVersionLabel: V1_LABEL,
          toVersionLabel: V2_LABEL,
        });
        expect(entry.containerDutyRuleBoundary).toBeNull();
      }

      expect(priceMove.classification).toBe('MERCHANT_PRICE_CHANGE');
      expect(priceMove.fromObservedAt).toBe('2026-01-02T10:00:00.000Z');
      expect(priceMove.toObservedAt).toBe('2026-01-03T10:00:00.000Z');
      expect(priceMove.movedInputs).toEqual({
        exciseRule: false,
        containerDutyRule: false,
        merchantPrice: true,
        transport: false,
      });
      expect(priceMove.exciseRuleBoundary).toBeNull();
      expect(priceMove.containerDutyRuleBoundary).toBeNull();
    });

    it('scopes series, attribution, and earliest date to the requested merchant', async () => {
      const res = await get(
        'from=2026-01-01&to=2026-01-03&merchant=systembolaget',
      ).expect(200);

      expect(res.body.merchant).toBe('systembolaget');
      expect(res.body.series).toHaveLength(2);
      expect(res.body.series[0]).toEqual({
        periodStart: '2026-01-01',
        openCents: 300,
        closeCents: 300,
        minCents: 300,
        maxCents: 300,
        avgCents: 300,
        observationCount: 1,
        reliability: 'VERIFIED',
      });

      const attribution = res.body.attribution;
      expect(attribution).toHaveLength(1);
      expect(attribution[0].classification).toBe('TAX_RULE_CHANGE');
      expect(attribution[0].merchant).toBe('systembolaget');

      // Earliest read replayed from the R2 log.
      expect(res.body.earliestAvailableObservationDate).toBe(
        '2026-01-01T12:00:00.000Z',
      );
    });

    it('returns the product-wide earliest available observation date', async () => {
      const res = await get('from=2026-01-01&to=2026-01-03').expect(200);
      expect(res.body.earliestAvailableObservationDate).toBe(
        '2026-01-01T10:00:00.000Z',
      );
    });

    it('returns 403 when the age-confirmation token is missing', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/products/${PRODUCT_BEER.id}/price-history?from=2026-01-01&to=2026-01-03`)
        .expect(403);
    });

    it('returns 404 for an unknown product', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/products/999/price-history?from=2026-01-01&to=2026-01-03')
        .set('x-age-confirmed', 'test-token')
        .expect(404);
    });
  });
});

// ---------------------------------------------------------------------------
// Flag-off gate — the endpoint must stay dark while the rollout flag is off
// ---------------------------------------------------------------------------

describe('GET /api/v1/products/:id/price-history — feature flag disabled (D1 stores)', () => {
  let flagOffApp: INestApplication;

  beforeAll(async () => {
    delete process.env.FF_HISTORICAL_PRICE_INTELLIGENCE; // default: off

    const { db, d1 } = openMigratedD1();
    const taxRules = new InMemoryTaxRuleRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [FeatureFlagsModule, RateLimitingModule, AgeGateModule],
      controllers: [HistoricalDataController],
      providers: [
        { provide: ProductRepository, useValue: new InMemoryProductRepository() },
        {
          provide: PriceHistorySummaryRepository,
          useValue: new D1PriceHistorySummaryRepository(d1),
        },
        {
          provide: PriceObservationRepository,
          useValue: new R2JsonlObservationStore(),
        },
        TaxChangeAttributionService,
        { provide: TAX_RULE_REPOSITORY_PORT, useValue: taxRules },
      ],
    })
      .overrideProvider(RATE_LIMITER)
      .useValue(NEVER_RATE_LIMIT)
      .compile();

    flagOffApp = moduleRef.createNestApplication();
    await flagOffApp.init();
    db.close(); // unused by the flag gate — closed immediately
  });

  afterAll(async () => {
    await flagOffApp?.close();
  });

  it('returns 403 even with an age token while the flag is off', async () => {
    await request(flagOffApp.getHttpServer())
      .get('/api/v1/products/1/price-history?from=2026-01-01&to=2026-01-03')
      .set('x-age-confirmed', 'test-token')
      .expect(403);
  });
});
