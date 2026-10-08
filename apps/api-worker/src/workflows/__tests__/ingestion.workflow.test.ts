/**
 * Ingestion Workflow tests (task 4.2, design D6) — step orchestration
 * over a fake `step.do` (emulated replay + exponential retry semantics),
 * the full staged pipeline against the migrated D1 + real IdempotencyDO
 * job claims (in-memory DO storage), the queue → workflow handoff
 * idempotency, and the data-acquisition adapter fetch-compat smoke
 * (real fetch against recorded fixture payloads served over HTTP —
 * the Workers-clean feed path).
 *
 * @module IngestionWorkflowTest
 */

import { describe, it, expect, vi, afterAll } from 'vitest';
import type { Server } from 'node:http';
import http from 'node:http';
import {
  INGESTION_STEP_RETRY,
  UPSERT_CHUNK_SIZE,
  composeIngestionStageServices,
  dataQualityStep,
  mapRecordsStep,
  runIngestionWorkflow,
  UNIT_VOLUME_CATEGORY_CEILING_LITRES,
  UNIT_VOLUME_LITRES_MAX,
  UNIT_VOLUME_UNAVAILABLE,
  unitVolumeCategoryCeiling,
  unitVolumeViolations,
  volumeCeilingGateStep,
  type DataQualityOutcome,
  type IngestionStageServices,
  type IngestionWorkflowParams,
  type MappedRecords,
  type SerializedQualityOffer,
  type StepRetryConfig,
  type WorkflowStepLike,
} from '../ingestion-steps';
import { PRODUCT_CATEGORIES } from '../../../../../packages/data-platform/src/d1/schema';
import {
  IMPLAUSIBLE_VOLUME_SHARE_GAUGE,
  ZERO_PRICE_REJECTIONS_COUNTER,
} from '../../observability/data-quality';
import { ensureWorkflowInstance } from '../handoff';
import { processIngestionMessage } from '../../queues/ingestion.queue';
import { composeMerchantRegistry } from '../../queues/pipeline';
import {
  ReliabilityService,
  SourceGovernanceService,
} from '@rajahinta/core-domain';
import { InMemorySourceGovernanceRepository } from '../../../../../packages/application-api/src/ops/governance/in-memory-source-governance.repository';
import { D1SourceGovernanceRepository } from '../../../../../packages/data-platform/src/repositories/d1/source-governance.repository';
import { DataMappingService } from '../../../../../packages/data-acquisition/src/services/data-mapping.service';
import { DataQualityService } from '../../../../../packages/data-acquisition/src/services/data-quality.service';
import { FeedIngestionService } from '../../../../../packages/data-acquisition/src/services/feed-ingestion.service';
import { ContentLintService } from '../../../../../packages/data-acquisition/src/content/content-lint.service';
import type { IFeedAdapter, RawFeedRecord } from '../../../../../packages/data-acquisition/src/interfaces/feed-adapter.interface';
import type { IUpsertRepository, UpsertOfferInput, UpsertProductInput } from '../../../../../packages/data-acquisition/src/interfaces/upsert-port.interface';
import { IdempotencyDO } from '../../do/idempotency.do';
import {
  createMemoryDoState,
  createMemoryDoStorage,
} from '../../do/__tests__/memory-do-storage';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger, type Logger } from '../../logger';
import type { Env } from '../../env';
import { AlkoFeedAdapter } from '../../../../../packages/data-acquisition/src/adapters/alko.adapter';
import { LmdwFeedAdapter } from '../../../../../packages/data-acquisition/src/adapters/lmdw.adapter';
import { ALKO_GOLDEN_PAYLOAD } from '../../../../../packages/data-acquisition/src/adapters/__fixtures__/alko-assortment.fixture';

const LOG: Logger = createLogger('error');

// ---------------------------------------------------------------------------
// Fake step API — emulated step.do semantics
// ---------------------------------------------------------------------------

/**
 * Emulates the Workflows step API: outputs are cached per step name
 * (replay returns the durable output without re-invoking the callback)
 * and failures retry per config with exponential backoff — the delay
 * sequence 30 s · 2^attempt is RECORDED, not slept.
 */
class FakeWorkflowStep implements WorkflowStepLike {
  private readonly outputs = new Map<string, unknown>();
  readonly invocations: { name: string; attempt: number }[] = [];
  readonly delays: Record<string, number[]> = {};
  /** Durable sleeps are RECORDED, not slept (same philosophy as delays). */
  readonly sleeps: { name: string; sleepFor: number }[] = [];

  sleep(name: string, sleepFor: number): Promise<void> {
    this.sleeps.push({ name, sleepFor });
    return Promise.resolve();
  }

  do<T>(
    name: string,
    config: StepRetryConfig,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (this.outputs.has(name)) {
      return Promise.resolve(this.outputs.get(name) as T);
    }
    const attempt = this.invocations.filter((i) => i.name === name).length;
    this.invocations.push({ name, attempt });
    const limit = config?.retries?.limit ?? 0;
    const delays = (this.delays[name] ??= []);

    return new Promise<T>((resolve, reject) => {
      const runAttempt = (n: number): void => {
        callback().then(
          (out) => {
            this.outputs.set(name, out);
            resolve(out);
          },
          (err) => {
            if (n >= limit) {
              reject(err);
              return;
            }
            delays.push(config.retries.delay * 2 ** n);
            runAttempt(n + 1);
          },
        );
      };
      runAttempt(attempt);
    });
  }
}

class FakeNonRetryableError extends Error {}

function workflowParams(
  overrides?: Partial<IngestionWorkflowParams>,
): IngestionWorkflowParams {
  return {
    dedupeKey: 'price-ingestion-alko-2026-08-30-14',
    merchantId: 'alko',
    sourceUrl: 'https://alko.example/api',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stage service fixtures
// ---------------------------------------------------------------------------

function feedRecord(overrides?: Partial<RawFeedRecord>): RawFeedRecord {
  return {
    productId: 'alko-1',
    productName: 'Karhu III',
    manufacturer: 'Sinebrychoff',
    brand: 'Karhu',
    category: 'beer',
    alcoholByVolume: 0.047,
    volumeMl: 330,
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystem: true,
    ean: '6410300012345',
    priceCents: 189,
    currency: 'EUR',
    originalPriceCents: 189,
    originalCurrency: 'EUR',
    availability: 'in_stock',
    sourceUrl: null,
    ...overrides,
  };
}

function fakeAdapter(
  records: RawFeedRecord[],
  errors: string[] = [],
): IFeedAdapter {
  return {
    merchantId: 'alko',
    fetch: async () => ({ records, errors }),
  };
}

/** Recording fake write port — mirrors the upsert loop's expectations. */
function fakeUpserts(options?: {
  fail?: boolean;
}): IUpsertRepository & { upsertedProducts: UpsertProductInput[] } {
  const upsertedProducts: UpsertProductInput[] = [];
  return {
    upsertedProducts,
    upsertProduct: async (product) => {
      if (options?.fail) throw new Error('D1 write failed');
      upsertedProducts.push(product);
      return { productId: upsertedProducts.length, created: true };
    },
    upsertOffer: async (_offer: UpsertOfferInput) => ({
      offerId: 100 + upsertedProducts.length,
      changed: true,
    }),
  };
}

/** Minimal registry row matching the D1 record shape. */
function registryRow() {
  return {
    id: 1,
    merchantId: 'alko',
    name: 'Alko',
    country: 'FI',
    feedUrl: 'https://alko.example/api',
    feedFormat: 'json',
    pollingIntervalMs: 3_600_000,
    createdAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-08-30T10:00:00.000Z',
  };
}

/** Claim client fake whose callbacks honor the Promise contract of step callbacks. */
const noopClaim = async (): Promise<void> => undefined;

/**
 * Stage services with the seams the tests need: a registry lookup, a
 * governance store (GRANTED for 'alko' by default — the gate is
 * fail-closed without it), and a fake feed adapter.
 */
function stageServices(
  options: {
    registryRow?: Record<string, unknown> | null;
    upserts?: IUpsertRepository;
    governanceGranted?: boolean;
    feedRecords?: RawFeedRecord[];
  } = {},
): IngestionStageServices {
  const governanceRepository = new InMemorySourceGovernanceRepository();
  if (options.governanceGranted !== false) {
    void governanceRepository.create({
      merchantId: 'alko',
      acquisitionMethod: 'RETAILER_API',
      permissionStatus: 'GRANTED',
      sourceUrl: 'https://alko.example/api',
    });
  }
  return {
    registry: {
      findByMerchantId: async () =>
        (options.registryRow === undefined
          ? registryRow()
          : options.registryRow) as Awaited<
          ReturnType<
            IngestionStageServices['registry']['findByMerchantId']
          >
        >,
    },
    governance: new SourceGovernanceService(governanceRepository),
    feeds: new FeedIngestionService(
      new Map([['alko', fakeAdapter(options.feedRecords ?? [])]]),
    ),
    mapping: new DataMappingService(),
    contentLint: new ContentLintService(),
    upserts: options.upserts ?? fakeUpserts(),
    dataQuality: new DataQualityService(new ReliabilityService()),
  };
}

function runWorkflow(
  services: IngestionStageServices,
  claims?: { complete: (env: Env, key: string) => Promise<void>; release: (env: Env, key: string) => Promise<void> },
  step: WorkflowStepLike = new FakeWorkflowStep(),
): { promise: Promise<unknown>; step: FakeWorkflowStep } {
  const fakeStep = step as FakeWorkflowStep;
  return {
    step: fakeStep,
    promise: runIngestionWorkflow(workflowParams(), {
      env: {} as Env,
      step,
      NonRetryableError: FakeNonRetryableError,
      services,
      claims: claims ?? {
        complete: vi.fn(noopClaim),
        release: vi.fn(noopClaim),
      },
      log: LOG,
    }),
  };
}

// ---------------------------------------------------------------------------
// Step orchestration
// ---------------------------------------------------------------------------

describe('FakeWorkflowStep — emulated step.do semantics', () => {
  it('caches outputs per step name — replay returns the durable output', async () => {
    const step = new FakeWorkflowStep();
    const callback = vi.fn().mockResolvedValue({ n: 1 });

    const first = await step.do('s1', INGESTION_STEP_RETRY, callback);
    const replay = await step.do('s1', INGESTION_STEP_RETRY, callback);

    expect(first).toEqual({ n: 1 });
    expect(replay).toEqual({ n: 1 });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('retries failures with the exponential 30 s · 2^attempt delay sequence', async () => {
    const step = new FakeWorkflowStep();
    const failTwice = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValue('ok');

    const out = await step.do('flaky', INGESTION_STEP_RETRY, failTwice);

    expect(out).toBe('ok');
    expect(failTwice).toHaveBeenCalledTimes(3);
    // BullMQ parity: 30 s, 60 s — retryDelaySeconds(0) and (1).
    expect(step.delays.flaky).toEqual([30_000, 60_000]);
  });

  it('fails the step after the retry limit is exhausted', async () => {
    const step = new FakeWorkflowStep();
    const always = vi.fn().mockRejectedValue(new Error('permanent'));

    await expect(
      step.do('dead', INGESTION_STEP_RETRY, always),
    ).rejects.toThrow('permanent');
    // Initial attempt + 5 retries (BullMQ attempts: 5 parity).
    expect(always).toHaveBeenCalledTimes(6);
  });

  it('INGESTION_STEP_RETRY mirrors the BullMQ attempts:5 / 30 s base', () => {
    expect(INGESTION_STEP_RETRY).toEqual({
      retries: { limit: 5, delay: 30_000, backoff: 'exponential' },
    });
  });
});

describe('runIngestionWorkflow — staged pipeline', () => {
  it('runs one step per stage and completes the job claim on success', async () => {
    const services = stageServices({
      feedRecords: [feedRecord(), feedRecord({ productId: 'alko-2', ean: null })],
    });
    const complete = vi.fn(noopClaim);
    const { step, promise } = runWorkflow(services, { complete, release: vi.fn(noopClaim) });

    const result = (await promise) as { productsIngested: number; errors: string[] };

    expect(result).toEqual({ productsIngested: 2, errors: [] });
    expect(step.invocations.map((i) => i.name)).toEqual([
      'resolve-merchant',
      'governance-gate',
      'fetch-feed',
      'map-records',
      'volume-ceiling-gate',
      'upsert-offers-1',
      'data-quality',
      'data-quality-metrics',
      'complete-job-claim',
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('splits the upsert stage into one step per UPSERT_CHUNK_SIZE pairs', async () => {
    const records = Array.from({ length: UPSERT_CHUNK_SIZE + 1 }, (_, i) =>
      feedRecord({ productId: `alko-${i}`, ean: null }),
    );
    const services = stageServices({ feedRecords: records });
    const { step, promise } = runWorkflow(services, {
      complete: noopClaim,
      release: noopClaim,
    });

    const result = (await promise) as { productsIngested: number };

    expect(result.productsIngested).toBe(UPSERT_CHUNK_SIZE + 1);
    const names = step.invocations.map((i) => i.name);
    expect(names).toContain('upsert-offers-1');
    expect(names).toContain('upsert-offers-2');
    // Exactly two upsert steps: 250 pairs in chunk 1, the remainder in 2.
    expect(names.filter((n) => n.startsWith('upsert-offers-'))).toHaveLength(2);
  });

  it('crosses a chunk-budget sleep boundary during the upsert loop for a first-run araxes-sized catalog (≥7 chunks)', async () => {
    // Regression (staging 2026-10-07, instance 1c2cddc7, change
    // onboard-araxes-merchant): araxes' 1,540 first-run pairs = 7 chunks
    // exhausted the per-invocation D1 quota (~1k first-run pairs) before
    // the then-16-chunk window ever fired — chunks 5–7 died
    // deterministically. A mid-size catalog must cross at least one
    // durable boundary mid-loop so later chunks get a fresh quota.
    const records = Array.from(
      { length: 7 * UPSERT_CHUNK_SIZE },
      (_, i) => feedRecord({ productId: `alko-${i}`, ean: null }),
    );
    const services = stageServices({ feedRecords: records });
    const { step, promise } = runWorkflow(services, {
      complete: noopClaim,
      release: noopClaim,
    });

    const result = (await promise) as { productsIngested: number };

    expect(result.productsIngested).toBe(7 * UPSERT_CHUNK_SIZE);
    expect(
      step.sleeps.filter((s) => s.name.startsWith('chunk-budget-reset-')),
    ).not.toHaveLength(0);
  });

  it('pins the chunk-budget cadence: a 7-chunk catalog sleeps after chunks 2, 4, and 6', async () => {
    const records = Array.from(
      { length: 7 * UPSERT_CHUNK_SIZE },
      (_, i) => feedRecord({ productId: `alko-${i}`, ean: null }),
    );
    const services = stageServices({ feedRecords: records });
    const { step, promise } = runWorkflow(services, {
      complete: noopClaim,
      release: noopClaim,
    });

    await promise;

    // DELIBERATE PIN on CHUNK_BUDGET_RESET_EVERY = 2 — a constant change
    // must update this list on purpose: the boundary fires before chunks
    // 3, 5, 7 (after 2, 4, 6), i.e. ≤ 500 first-run pairs per invocation
    // window, with no sleep after the final chunk of this run.
    expect(step.sleeps.map((s) => s.name)).toEqual([
      'chunk-budget-reset-3',
      'chunk-budget-reset-5',
      'chunk-budget-reset-7',
    ]);
    expect(step.sleeps.map((s) => s.sleepFor)).toEqual([1_000, 1_000, 1_000]);
  });

  it('reports a zero-product run with the registry error and still completes the claim (runIngestion parity)', async () => {
    const services = stageServices({ registryRow: null });
    const complete = vi.fn(noopClaim);
    const { promise } = runWorkflow(services, { complete, release: vi.fn(noopClaim) });

    const result = (await promise) as { productsIngested: number; errors: string[] };

    expect(result.productsIngested).toBe(0);
    expect(result.errors[0]).toMatch(/not in the merchant registry/);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('skips fetch/map/upsert when the governance gate rejects (fail-closed)', async () => {
    const services = stageServices({ governanceGranted: false });
    const fetchSpy = vi.spyOn(services.feeds, 'fetchFromMerchant');
    const { step, promise } = runWorkflow(services);

    const result = (await promise) as { productsIngested: number; errors: string[] };

    expect(result).toEqual({ productsIngested: 0, errors: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(step.invocations.map((i) => i.name)).toEqual([
      'resolve-merchant',
      'governance-gate',
      'complete-job-claim',
    ]);
  });

  it('contains per-record upsert failures and completes the run with errors (orchestrator parity)', async () => {
    const services = stageServices({
      feedRecords: [feedRecord()],
      upserts: fakeUpserts({ fail: true }),
    });
    const complete = vi.fn(noopClaim);
    const release = vi.fn(noopClaim);
    const { promise } = runWorkflow(services, { complete, release });

    const result = (await promise) as { productsIngested: number; errors: string[] };

    // The upsert loop isolates per-record failures into errors[] — the
    // run completes (claim completed), it does not throw.
    expect(result.productsIngested).toBe(0);
    expect(result.errors[0]).toMatch(/Failed to upsert product/);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it('releases the claim on a step-level throw (retry-exhaustion path)', async () => {
    const services = stageServices();
    (services.registry as { findByMerchantId: () => Promise<never> }).findByMerchantId =
      () => Promise.reject(new Error('registry lookup failed'));
    const release = vi.fn(noopClaim);
    const { step, promise } = runWorkflow(services, { complete: vi.fn(noopClaim), release });

    await expect(promise).rejects.toThrow('registry lookup failed');

    expect(release).toHaveBeenCalledTimes(1);
    expect(step.invocations.map((i) => i.name)).toContain('release-job-claim');
  });

  it('fails fast (non-retryable) on malformed params', async () => {
    const step = new FakeWorkflowStep();

    await expect(
      runIngestionWorkflow(
        { dedupeKey: '', merchantId: '', sourceUrl: '' },
        {
          env: {} as Env,
          step,
          NonRetryableError: FakeNonRetryableError,
          services: stageServices(),
          claims: {
            complete: vi.fn(async () => undefined),
            release: vi.fn(async () => undefined),
          },
          log: LOG,
        },
      ),
    ).rejects.toBeInstanceOf(FakeNonRetryableError);

    expect(step.invocations).toHaveLength(0);
  });

  it('carries the staged pipeline over the migrated D1 end to end (offer rows written)', async () => {
    const { env, db } = workerEnv();
    const { D1UpsertRepository } = await import('../../adapters/d1-upsert.repository');
    const services = stageServices({
      feedRecords: [feedRecord()],
      upserts: new D1UpsertRepository(env.DB),
    });

    const result = (await runIngestionWorkflow(workflowParams(), {
      env,
      step: new FakeWorkflowStep(),
      NonRetryableError: FakeNonRetryableError,
      services,
      claims: {
        complete: vi.fn(async () => undefined),
        release: vi.fn(async () => undefined),
      },
      log: LOG,
    })) as { productsIngested: number };

    expect(result.productsIngested).toBe(1);
    const offerRow = db
      .prepare(
        `SELECT merchant, price_cents, reliability_status FROM retail_offers LIMIT 1`,
      )
      .get() as
      | { merchant: string; price_cents: number; reliability_status: string }
      | undefined;
    expect(offerRow).toBeDefined();
    expect(offerRow!.merchant).toBe('alko');
    expect(offerRow!.price_cents).toBe(189);
    expect(offerRow!.reliability_status).toBe('ESTIMATED');
  });

  it('a run with a zero-price rejection and an implausible volume performs both export writes (task 4.1 run seam)', async () => {
    const { points, env } = fakeMetrics();
    const services = stageServices({
      feedRecords: [
        // priceCents 0 → the mapper price-floor gate rejects the offer with
        // the "price drift" error (rides the run's error channel)…
        feedRecord({ productId: 'alko-free', ean: null, priceCents: 0 }),
        // …and the live Karhu case → the ceiling gate withholds the volume.
        feedRecord({ productId: 'alko-karhu', volumeMl: 33_000 }),
      ],
    });

    const result = (await runIngestionWorkflow(workflowParams(), {
      env,
      step: new FakeWorkflowStep(),
      NonRetryableError: FakeNonRetryableError,
      services,
      claims: {
        complete: vi.fn(async () => undefined),
        release: vi.fn(async () => undefined),
      },
      log: LOG,
    })) as { productsIngested: number; errors: string[] };

    // Both products still ingest — rejection is to trust, not existence.
    expect(result.productsIngested).toBe(2);
    expect(result.errors.some((error) => error.includes('price drift'))).toBe(true);

    const byGauge = (name: string): AnalyticsEngineDataPoint[] =>
      points.filter((point) => point.indexes?.[0] === name);

    // Zero-price rejections: one point per run, per-run count 1, merchant-labelled.
    const zeroPrice = byGauge(ZERO_PRICE_REJECTIONS_COUNTER);
    expect(zeroPrice).toHaveLength(1);
    expect(zeroPrice[0]!.doubles?.[0]).toBe(1);
    expect(zeroPrice[0]!.blobs?.[2]).toBe('{"merchant":"alko"}');

    // Implausible-volume share: 1 withheld / 1 audited offer = 1.
    const share = byGauge(IMPLAUSIBLE_VOLUME_SHARE_GAUGE);
    expect(share).toHaveLength(1);
    expect(share[0]!.doubles?.[0]).toBe(1);
  });
});

/** Worker env over the migrated in-memory D1. */
function workerEnv(): { env: Env; db: import('node:sqlite').DatabaseSync } {
  const { db, d1 } = openMigratedD1();
  return { env: { DB: d1 } as unknown as Env, db };
}

/**
 * Fake AE binding — the observability suite's sink pattern — for asserting
 * the run-seam data-quality export writes (task 4.1).
 */
function fakeMetrics(): { points: AnalyticsEngineDataPoint[]; env: Env } {
  const points: AnalyticsEngineDataPoint[] = [];
  return {
    points,
    env: {
      METRICS: {
        writeDataPoint: (point?: AnalyticsEngineDataPoint): void => {
          points.push(point ?? {});
        },
      },
    } as unknown as Env,
  };
}

/** Serialized quality-offer fixture (unit-window invariant tests, task 1.4). */
function qualityOffer(
  overrides?: Partial<SerializedQualityOffer>,
): SerializedQualityOffer {
  return {
    merchant: 'alko',
    productId: 1,
    observedAtIso: '2026-09-26T10:00:00.000Z',
    reliabilityStatus: 'ESTIMATED',
    unitVolume: '0.5',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit-window data-quality invariant (task 1.4, unit-integrity-and-result-trust)
// ---------------------------------------------------------------------------

describe('unit-window invariant — unitVolumeViolations predicate', () => {
  it('passes in-window volumes; the bounds are exclusive at both ends', () => {
    expect(
      unitVolumeViolations([
        qualityOffer({ productId: 1, unitVolume: '0.001' }),
        qualityOffer({ productId: 2, unitVolume: '0.5' }),
        qualityOffer({ productId: 3, unitVolume: '15' }), // 15 l BIB — litres, in-window
        qualityOffer({ productId: 4, unitVolume: '99.9' }),
      ]),
    ).toEqual([]);
  });

  it('flags >= 100 as data errors — the boundary itself included', () => {
    const violations = unitVolumeViolations([
      qualityOffer({ productId: 7, unitVolume: String(UNIT_VOLUME_LITRES_MAX) }),
      qualityOffer({ productId: 8, unitVolume: '500' }),
    ]);

    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('unit_volume 100');
    expect(violations[0]).toContain('product 7');
    expect(violations[1]).toContain('unit_volume 500');
  });

  it('flags <= 0 — the parser’s unresolved-volume 0 included — and non-numeric values', () => {
    const violations = unitVolumeViolations([
      qualityOffer({ productId: 9, unitVolume: '0' }),
      qualityOffer({ productId: 10, unitVolume: '-0.5' }),
      qualityOffer({ productId: 11, unitVolume: 'not-a-number' }),
    ]);

    expect(violations).toHaveLength(3);
    expect(violations[0]).toContain('unit_volume 0');
  });
});

describe('unit-window invariant — dataQualityStep', () => {
  it('flags violations on the report AND the outcome — the check fails', async () => {
    const outcome = await dataQualityStep(
      stageServices(),
      qualityOffers(['0.5', '500', '0']),
    );

    expect(outcome).not.toBeNull();
    expect(outcome!.unitVolumeViolations).toHaveLength(2);
    // Flagged as data errors on the DataQualityReport surface too.
    for (const violation of outcome!.unitVolumeViolations) {
      expect(outcome!.report.flaggedIssues).toContain(violation);
    }
    expect(outcome!.report.totalOffers).toBe(3);
  });

  it('returns no violations for a fully in-window batch', async () => {
    const outcome = await dataQualityStep(
      stageServices(),
      qualityOffers(['0.33']),
    );

    expect(outcome!.unitVolumeViolations).toEqual([]);
    expect(outcome!.report.flaggedIssues).toEqual([]);
  });
});

describe('unit-window invariant — staged pipeline flow', () => {
  it('a 0-volume feed record persists ESTIMATED and the run completes WITH the data error', async () => {
    const upserts = fakeUpserts();
    const services = stageServices({
      // volumeMl 0 is the parser's unresolved-volume encoding ("33CLx24"
      // names): the mapper persists litres "0" keyed ESTIMATED by design.
      feedRecords: [feedRecord({ volumeMl: 0 })],
      upserts,
    });
    const complete = vi.fn(noopClaim);
    const { promise } = runWorkflow(services, { complete, release: vi.fn(noopClaim) });

    const result = (await promise) as { productsIngested: number; errors: string[] };

    // Persisted by design (visible estimate, never a silent drop)…
    expect(result.productsIngested).toBe(1);
    expect(upserts.upsertedProducts[0]?.unitVolume).toBe('0');
    // …and the invariant rejects it as plausible-volume data: the check
    // fails at run level, no second unit convention applied anywhere.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/canonical litre window/);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('an ml-shaped feed volume (500 l claim) is gated to unavailable and fails the run’s check', async () => {
    const upserts = fakeUpserts();
    const services = stageServices({
      feedRecords: [feedRecord({ volumeMl: 500_000 })],
      upserts,
    });
    const { promise } = runWorkflow(services, {
      complete: noopClaim,
      release: noopClaim,
    });

    const result = (await promise) as { productsIngested: number; errors: string[] };

    expect(result.productsIngested).toBe(1);
    // Gated BEFORE upsert — the implausible 500 never stores as plausible.
    expect(upserts.upsertedProducts[0]?.unitVolume).toBe(UNIT_VOLUME_UNAVAILABLE);
    // The outer rail still fails the run for the stored-unavailable row.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/canonical litre window/);
  });
});

/** Quality offers with sequential ids and the given unit volumes. */
function qualityOffers(unitVolumes: string[]): SerializedQualityOffer[] {
  return unitVolumes.map((unitVolume, i) =>
    qualityOffer({ productId: i + 1, unitVolume }),
  );
}

// ---------------------------------------------------------------------------
// Category-bounded volume ceilings (task 1.2, data-quality-and-publication-trust)
// ---------------------------------------------------------------------------

/** Merchant config for direct mapRecordsStep calls (pipeline-shaped fixtures). */
const MERCHANT_CONFIG = {
  merchantId: 'alko',
  name: 'Alko',
  country: 'FI',
  feedUrl: 'https://alko.example/api',
  feedFormat: 'json',
  pollingIntervalMs: 3_600_000,
} as const;

/** Mapped pairs through the real mapper + lint, for direct gate-step tests. */
function mappedPairs(records: RawFeedRecord[]): Promise<MappedRecords> {
  return mapRecordsStep(stageServices({ feedRecords: records }), MERCHANT_CONFIG, {
    records,
    errors: [],
  });
}

describe('category volume ceilings — constants table', () => {
  it('bounds every canonical product category — the table is complete', () => {
    expect(Object.keys(UNIT_VOLUME_CATEGORY_CEILING_LITRES).sort()).toEqual(
      [...PRODUCT_CATEGORIES].sort(),
    );
    for (const ceiling of Object.values(UNIT_VOLUME_CATEGORY_CEILING_LITRES)) {
      expect(ceiling).toBeGreaterThan(0);
      // Every ceiling narrows the outer rail — never widens it.
      expect(ceiling).toBeLessThan(UNIT_VOLUME_LITRES_MAX);
    }
  });

  it('pins the given bounds: beer 2 l, wine family 6 l, spirits 3 l', () => {
    expect(UNIT_VOLUME_CATEGORY_CEILING_LITRES).toEqual({
      beer: 2,
      wine_still: 6,
      wine_sparkling: 6,
      intermediate_products: 6,
      other_fermented: 2,
      spirits: 3,
    });
  });

  it('an unlisted category falls back to the outer rail, not an unbounded pass', () => {
    expect(unitVolumeCategoryCeiling('non_alcoholic')).toBe(UNIT_VOLUME_LITRES_MAX);
    expect(unitVolumeCategoryCeiling('beer')).toBe(2);
  });
});

describe('category volume ceilings — volumeCeilingGateStep', () => {
  it('gates a true 33 l beer: stores unavailable and is held for review — defense-in-depth over a pack-total feed that carries no pack notation', async () => {
    const mapped = await mappedPairs([
      feedRecord({
        productId: 'alko-karhu',
        // A bare pack total on a name WITHOUT pack notation: the
        // pack-notation normalizer (honest-trust-surfaces task 1.1)
        // never guesses, so the 33-litre value reaches the gate and the
        // gate holds it.
        productName: 'Karhu Olut 5.3%',
        volumeMl: 33_000,
      }),
    ]);

    const outcome = await volumeCeilingGateStep(mapped);

    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]).toContain('Karhu Olut 5.3%');
    expect(outcome.findings[0]).toContain('"beer"');
    expect(outcome.findings[0]).toContain('33');
    expect(outcome.findings[0]).toContain('ceiling of 2 l');
    expect(outcome.findings[0]).toContain('held for review');
    // Stored unavailable — the parser's unresolved encoding — BEFORE upsert.
    expect(outcome.pairs[0]!.product.unitVolume).toBe(UNIT_VOLUME_UNAVAILABLE);
  });

  it('the live Karhu pack-notation name defuses at mapping: 0.33 per can passes the ceiling gate', async () => {
    const mapped = await mappedPairs([
      feedRecord({
        productId: 'alko-karhu',
        productName: 'Karhu Olut 5.3% 24×33 l',
        // The live incident input: the feed reports the PACK total.
        volumeMl: 33_000,
      }),
    ]);

    // The name's N×V notation is authoritative at mapping — the gate
    // never sees the 33 l pack total.
    const outcome = await volumeCeilingGateStep(mapped);

    expect(outcome.findings).toEqual([]);
    expect(outcome.pairs[0]!.product.unitVolume).toBe('0.33');
  });

  it('passes plausible volumes through unchanged with no review flag', async () => {
    const mapped = await mappedPairs([
      feedRecord({ category: 'beer', volumeMl: 330 }),
      feedRecord({
        productId: 'alko-2',
        ean: null,
        category: 'wine_still',
        volumeMl: 750,
      }),
      feedRecord({
        productId: 'alko-3',
        ean: null,
        category: 'spirits',
        volumeMl: 500,
      }),
    ]);

    const outcome = await volumeCeilingGateStep(mapped);

    expect(outcome.findings).toEqual([]);
    expect(outcome.pairs.map((p) => p.product.unitVolume)).toEqual([
      '0.33',
      '0.75',
      '0.5',
    ]);
  });

  it('the ceiling is inclusive: at-ceiling passes, just above is gated', async () => {
    const mapped = await mappedPairs([
      feedRecord({ volumeMl: 2_000 }), // 2 l beer — at the ceiling
      feedRecord({ productId: 'a2', ean: null, volumeMl: 2_500 }),
      feedRecord({
        productId: 'a3',
        ean: null,
        category: 'wine_sparkling',
        volumeMl: 6_000, // 6 l — at the ceiling
      }),
      feedRecord({
        productId: 'a4',
        ean: null,
        category: 'wine_sparkling',
        volumeMl: 6_500,
      }),
      feedRecord({
        productId: 'a5',
        ean: null,
        category: 'spirits',
        volumeMl: 3_000, // 3 l — at the ceiling
      }),
      feedRecord({ productId: 'a6', ean: null, category: 'spirits', volumeMl: 3_500 }),
    ]);

    const outcome = await volumeCeilingGateStep(mapped);

    expect(outcome.pairs.map((p) => p.product.unitVolume)).toEqual([
      '2',
      UNIT_VOLUME_UNAVAILABLE,
      '6',
      UNIT_VOLUME_UNAVAILABLE,
      '3',
      UNIT_VOLUME_UNAVAILABLE,
    ]);
    expect(outcome.findings).toHaveLength(3);
  });

  it('leaves rail-owned volumes (the unresolved 0) to the outer window check', async () => {
    const mapped = await mappedPairs([feedRecord({ volumeMl: 0 })]);

    const outcome = await volumeCeilingGateStep(mapped);

    expect(outcome.findings).toEqual([]);
    expect(outcome.pairs[0]!.product.unitVolume).toBe('0');
  });
});

describe('category volume ceilings — dataQualityStep', () => {
  it('counts gated rows on the report and flags them for review next to the window errors', async () => {
    const karhuFinding =
      'Data error: unit_volume 33 for product "Karhu Olut 5.3% 24×33 l" ' +
      '(category "beer") exceeds the beer ceiling of 2 l — volume stored ' +
      'unavailable, row held for review';
    const outcome = await dataQualityStep(
      stageServices(),
      qualityOffers(['0.5', '0']),
      [karhuFinding],
    );

    // The share-metric count rides the report.
    expect(outcome!.report.implausibleVolumeCount).toBe(1);
    // The review flag rides flaggedIssues, next to the window errors.
    expect(outcome!.report.flaggedIssues).toContain(karhuFinding);
    // The stored-unavailable row still fails the outer rail.
    expect(outcome!.unitVolumeViolations).toHaveLength(1);
  });

  it('defaults to zero gated rows when called without the gate', async () => {
    const outcome = await dataQualityStep(stageServices(), qualityOffers(['0.5']));

    expect(outcome!.report.implausibleVolumeCount).toBe(0);
  });
});

describe('category volume ceilings — staged pipeline flow', () => {
  it('a true 33 l beer upserts volume-unavailable, flagged for review, with the rail error at run level', async () => {
    const upserts = fakeUpserts();
    const services = stageServices({
      feedRecords: [
        feedRecord({
          // A pack total on a name WITHOUT pack notation: the normalizer
          // never guesses, so the true 33 l reaches the ceiling gate
          // (honest-trust-surfaces task 1.1).
          productName: 'Karhu Olut 5.3%',
          volumeMl: 33_000,
        }),
      ],
      upserts,
    });
    const { step, promise } = runWorkflow(services, {
      complete: noopClaim,
      release: noopClaim,
    });

    const result = (await promise) as { productsIngested: number; errors: string[] };

    // Gated BEFORE upsert — no plausible 33-litre beer is ever stored…
    expect(upserts.upsertedProducts[0]?.unitVolume).toBe(UNIT_VOLUME_UNAVAILABLE);
    // …but the row is not dropped: the offer still upserts.
    expect(result.productsIngested).toBe(1);

    // The gate runs as its own stage between map and upsert.
    const names = step.invocations.map((i) => i.name);
    expect(names.indexOf('volume-ceiling-gate')).toBeGreaterThan(
      names.indexOf('map-records'),
    );
    expect(names.indexOf('volume-ceiling-gate')).toBeLessThan(
      names.indexOf('upsert-offers-1'),
    );

    // Review flag + share count on the durable data-quality output.
    const quality = (
      step as unknown as { outputs: Map<string, unknown> }
    ).outputs.get('data-quality') as DataQualityOutcome;
    expect(quality.report.implausibleVolumeCount).toBe(1);
    expect(quality.report.flaggedIssues.join('\n')).toContain(
      'Karhu Olut 5.3%',
    );

    // The outer rail still rejects the stored 0 at run level.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/canonical litre window/);
  });
});

// ---------------------------------------------------------------------------
// D1 governance default (task 2.1) — composition over the durable store
// ---------------------------------------------------------------------------

/**
 * Env for the composed stage services: migrated D1 plus the
 * OBSERVATION_LOG stub the composition requires — the gated paths never
 * write an observation, so the stub only has to exist.
 */
function composedEnv(): Env {
  const { d1 } = openMigratedD1();
  return { DB: d1, OBSERVATION_LOG: {} } as unknown as Env;
}

async function seedAlkoRegistry(env: Env): Promise<void> {
  await composeMerchantRegistry(env).upsert({
    merchantId: 'alko',
    name: 'Alko',
    country: 'FI',
    feedUrl: 'https://alko.example/api',
    feedFormat: 'json',
    pollingIntervalMs: 3_600_000,
  });
}

/** Feed adapter that counts fetch attempts and returns one mappable record. */
function recordingAdapter(): IFeedAdapter & { fetchCalls: number } {
  const adapter = {
    merchantId: 'alko',
    fetchCalls: 0,
    fetch: async () => {
      adapter.fetchCalls++;
      return { records: [feedRecord()], errors: [] };
    },
  };
  return adapter;
}

describe('composeIngestionStageServices — D1 governance default (task 2.1)', () => {
  const claims = {
    complete: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };

  it('gates fail-closed over an empty migrated source_governance table — the fetch step never runs', async () => {
    const env = composedEnv();
    await seedAlkoRegistry(env);
    const adapter = recordingAdapter();

    const result = (await runIngestionWorkflow(workflowParams(), {
      env,
      step: new FakeWorkflowStep(),
      NonRetryableError: FakeNonRetryableError,
      // No services, no governanceRepository override — the D1 default.
      stageOptions: { feedAdaptersOverride: new Map([['alko', adapter]]) },
      claims,
      log: LOG,
    })) as { productsIngested: number; errors: string[] };

    expect(result).toEqual({ productsIngested: 0, errors: [] });
    expect(adapter.fetchCalls).toBe(0);

    // The composed gate's raw verdict over the empty table — the exact
    // PENDING / no-warnings shape the old in-memory default produced.
    const check = await composeIngestionStageServices(
      env,
    ).governance.checkPermission('alko');
    expect(check.permissionStatus).toBe('PENDING');
    expect(check.sources).toEqual([]);
    expect(check.hasWarnings).toBe(false);
  });

  it('admits the run once a GRANTED row lives in the durable table — the gate reads D1, not process memory', async () => {
    const env = composedEnv();
    await seedAlkoRegistry(env);
    await new D1SourceGovernanceRepository(env.DB).create({
      merchantId: 'alko',
      acquisitionMethod: 'RETAILER_API',
      permissionStatus: 'GRANTED',
      sourceUrl: 'https://alko.example/api',
    });
    const adapter = recordingAdapter();

    const result = (await runIngestionWorkflow(workflowParams(), {
      env,
      step: new FakeWorkflowStep(),
      NonRetryableError: FakeNonRetryableError,
      stageOptions: {
        feedAdaptersOverride: new Map([['alko', adapter]]),
        upsertRepositoryOverride: fakeUpserts(),
      },
      claims,
      log: LOG,
    })) as { productsIngested: number; errors: string[] };

    expect(adapter.fetchCalls).toBe(1);
    expect(result.productsIngested).toBe(1);
    const check = await composeIngestionStageServices(
      env,
    ).governance.checkPermission('alko');
    expect(check.permissionStatus).toBe('GRANTED');
    expect(check.hasWarnings).toBe(false);
  });

  it('still honors an explicit governanceRepository override over the D1 default', async () => {
    const env = composedEnv();
    await seedAlkoRegistry(env);
    const governanceRepository = new InMemorySourceGovernanceRepository();
    void governanceRepository.create({
      merchantId: 'alko',
      acquisitionMethod: 'RETAILER_API',
      permissionStatus: 'GRANTED',
      sourceUrl: 'https://alko.example/api',
    });
    const adapter = recordingAdapter();

    const result = (await runIngestionWorkflow(workflowParams(), {
      env,
      step: new FakeWorkflowStep(),
      NonRetryableError: FakeNonRetryableError,
      stageOptions: {
        governanceRepository,
        feedAdaptersOverride: new Map([['alko', adapter]]),
        upsertRepositoryOverride: fakeUpserts(),
      },
      claims,
      log: LOG,
    })) as { productsIngested: number; errors: string[] };

    // The D1 table is empty — only the in-memory override can admit
    // this run.
    expect(adapter.fetchCalls).toBe(1);
    expect(result.productsIngested).toBe(1);
  });
});

describe('composeIngestionStageServices — live feed adapters (task 2.2)', () => {
  it('registers thirteen live adapters — alko, alks, longero, kippis, mydrink, araxes, bottleofitaly, kuhns, viinarannasta, viinikauppa, licorea, drinkonline, and lmdw all resolve by merchantId', async () => {
    const { feeds, crawlFeedAdapters } = composeIngestionStageServices(
      composedEnv(),
    );

    // Negative control: an unregistered merchantId produces the lookup
    // sentinel, proving the assertions below exercise the real map.
    const missing = await feeds.fetchFromMerchant(
      'no-such-merchant',
      'http://127.0.0.1:9/api',
      'json',
    );
    expect(missing.errors).toEqual([
      'No feed adapter registered for merchant "no-such-merchant"',
    ]);

    // Closed local port: a RESOLVED adapter attempts the fetch and
    // fails fast into errors[] — any error but the sentinel proves the
    // default map resolves the merchantId. The crawl adapters fail the
    // same way: the feedUrl here IS the sitemap URL, so the closed port
    // kills the sitemap fetch before any crawl state is touched.
    for (const merchantId of [
      'alko',
      'alks',
      'longero',
      'kippis',
      'mydrink',
      'araxes',
      'bottleofitaly',
      'kuhns',
      'viinarannasta',
      'viinikauppa',
      'licorea',
      'drinkonline',
      'lmdw',
    ]) {
      const result = await feeds.fetchFromMerchant(
        merchantId,
        'http://127.0.0.1:9/api',
        'json',
      );
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors).not.toContain(
        `No feed adapter registered for merchant "${merchantId}"`,
      );
    }

    // The crawl path's identity gate (the chunked steps' branch key)
    // carries exactly the five crawl merchants — lmdw joins the four v1
    // merchants as the same instance the feeds map resolves above.
    expect([...(crawlFeedAdapters?.keys() ?? [])].sort()).toEqual([
      'drinkonline',
      'licorea',
      'lmdw',
      'viinarannasta',
      'viinikauppa',
    ]);
    expect(crawlFeedAdapters?.get('lmdw')).toBeInstanceOf(LmdwFeedAdapter);
  });
});

// ---------------------------------------------------------------------------
// Queue → Workflow handoff (idempotent instance id = dedupe key)
// ---------------------------------------------------------------------------

function fakeWorkflowBinding(): {
  binding: import('../handoff').WorkflowBindingLike;
  created: string[];
  gets: string[];
} {
  const created: string[] = [];
  const gets: string[] = [];
  const instances = new Set<string>();
  return {
    created,
    gets,
    binding: {
      get: async (id: string) => {
        gets.push(id);
        if (!instances.has(id)) throw new Error(`instance ${id} not found`);
        return { id, status: 'running' };
      },
      create: async (options: { id: string; params: unknown }) => {
        if (instances.has(options.id)) {
          throw new Error(`instance "${options.id}" already exists`);
        }
        instances.add(options.id);
        created.push(options.id);
        return { id: options.id };
      },
    },
  };
}

function idempotencyEnv(
  workflow?: import('../handoff').WorkflowBindingLike,
): Env {
  const storage = createMemoryDoStorage();
  const instance = new IdempotencyDO(createMemoryDoState(storage), {});
  const stub = { fetch: (request: Request) => instance.fetch(request) };
  const namespace = {
    idFromName: (name: string) => ({ name }),
    get: () => stub,
  } as unknown as DurableObjectNamespace;
  const { d1 } = openMigratedD1();
  return {
    IDEMPOTENCY: namespace,
    DB: d1,
    ...(workflow ? { INGESTION_WORKFLOW: workflow } : {}),
  } as unknown as Env;
}

describe('queue → workflow handoff idempotency', () => {
  it('creates ONE instance per dedupe key — a duplicate delivery resolves to the same instance id', async () => {
    const workflow = fakeWorkflowBinding();
    const env = idempotencyEnv(workflow.binding);

    const body = {
      dedupeKey: 'price-ingestion-alko-2026-08-30-14',
      merchantId: 'alko',
      sourceUrl: 'https://alko.example/api',
    };

    const first = await processIngestionMessage(body, env);
    expect(first.processed).toBe(true);
    // Instance id IS the dedupe key.
    expect(workflow.created).toEqual([body.dedupeKey]);

    const duplicate = await processIngestionMessage(body, env);
    // Duplicate skips as in-flight — the running instance owns the key.
    expect(duplicate).toEqual({ processed: false, skipped: true });
    expect(workflow.created).toEqual([body.dedupeKey]);
    expect(workflow.gets).toContain(body.dedupeKey);
  });

  it('releases the claim when the handoff itself fails, so the redelivery can retry', async () => {
    const env = idempotencyEnv(); // no INGESTION_WORKFLOW binding

    const failed = await processIngestionMessage(
      {
        dedupeKey: 'price-ingestion-alko-2026-08-30-15',
        merchantId: 'alko',
        sourceUrl: 'x',
      },
      env,
    );
    expect(failed.processed).toBe(false);
    expect(failed.error).toMatch(/INGESTION_WORKFLOW/);

    // The claim was released — a redelivery re-claims and hands off.
    const retried = await processIngestionMessage(
      {
        dedupeKey: 'price-ingestion-alko-2026-08-30-15',
        merchantId: 'alko',
        sourceUrl: 'x',
      },
      idempotencyEnv(fakeWorkflowBinding().binding),
    );
    expect(retried.processed).toBe(true);
  });
});

describe('ensureWorkflowInstance — get/create/confirm-on-race', () => {
  it('creates when absent, skips when present, and confirms existence on a create race', async () => {
    const binding = fakeWorkflowBinding();
    const first = await ensureWorkflowInstance(binding.binding, 'k1', {});
    expect(first).toEqual({ created: true, instanceId: 'k1' });

    const existing = await ensureWorkflowInstance(binding.binding, 'k1', {});
    expect(existing).toEqual({ created: false, instanceId: 'k1' });

    // Race: create throws although the instance was created by a
    // concurrent delivery — the confirming get resolves the outcome.
    const racer = fakeWorkflowBinding();
    await ensureWorkflowInstance(racer.binding, 'k2', {});
    racer.binding.create = async () => {
      throw new Error('instance "k2" already exists');
    };
    const raced = await ensureWorkflowInstance(racer.binding, 'k2', {});
    expect(raced).toEqual({ created: false, instanceId: 'k2' });
  });

  it('rethrows the create error when the instance is truly absent (real failure)', async () => {
    const api = fakeWorkflowBinding();
    api.binding.create = async () => {
      throw new Error('workflows api down');
    };
    await expect(
      ensureWorkflowInstance(api.binding, 'k3', {}),
    ).rejects.toThrow('workflows api down');
  });
});

// ---------------------------------------------------------------------------
// Adapter fetch-compat smoke — real fetch over recorded fixtures
// ---------------------------------------------------------------------------

describe('adapter fetch-compat smoke (feed paths: standard fetch + JSON only)', () => {
  let server: Server;

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function serve(payloadByPath: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const body = payloadByPath[req.url ?? '/'];
        if (body === undefined) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
      });
    });
  }

  it('runs the feed path against the recorded fixture over real HTTP', async () => {
    const baseUrl = await serve({
      '/alko': ALKO_GOLDEN_PAYLOAD,
    });

    // Alko — golden fixture payload through the real fetch path.
    // (Posti no longer rides this path: its rates are a curated in-repo
    // dataset pinned by posti-rate.source.test.ts.)
    const alko = await new AlkoFeedAdapter().fetch({
      feedUrl: `${baseUrl}/alko`,
      feedFormat: 'json',
    });
    expect(alko.records.length).toBeGreaterThan(0);
    expect(alko.records[0].currency).toBe('EUR');
  });
});
