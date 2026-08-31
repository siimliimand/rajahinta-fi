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
  runIngestionWorkflow,
  type IngestionStageServices,
  type IngestionWorkflowParams,
  type StepRetryConfig,
  type WorkflowStepLike,
} from '../ingestion-steps';
import { ensureWorkflowInstance } from '../handoff';
import { processIngestionMessage } from '../../queues/ingestion.queue';
import {
  ReliabilityService,
  SourceGovernanceService,
} from '@rajahinta/core-domain';
import { InMemorySourceGovernanceRepository } from '../../../../../packages/application-api/src/ops/governance/in-memory-source-governance.repository';
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
import { SystembolagetFeedAdapter } from '../../../../../packages/data-acquisition/src/adapters/systembolaget.adapter';
import { PostiCarrierRateSource } from '../../../../../packages/data-acquisition/src/adapters/posti-rate.source';
import { EcbReferenceRateSource } from '../../../../../packages/data-acquisition/src/adapters/ecb-rate.source';
import { ALKO_GOLDEN_PAYLOAD } from '../../../../../packages/data-acquisition/src/adapters/__fixtures__/alko-assortment.fixture';
import { POSTI_GOLDEN_PAYLOAD } from '../../../../../packages/data-acquisition/src/adapters/__fixtures__/posti-rates.fixture';

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
      'upsert-offers',
      'data-quality',
      'complete-job-claim',
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
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
});

/** Worker env over the migrated in-memory D1. */
function workerEnv(): { env: Env; db: import('node:sqlite').DatabaseSync } {
  const { db, d1 } = openMigratedD1();
  return { env: { DB: d1 } as unknown as Env, db };
}

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

  it('runs the four feed paths against recorded fixtures over real HTTP', async () => {
    const baseUrl = await serve({
      '/alko': ALKO_GOLDEN_PAYLOAD,
      '/posti': POSTI_GOLDEN_PAYLOAD,
      '/systembolaget': [
        {
          productId: '1',
          productNameBold: 'Norrlands Guld Export',
          category: 'Öl',
          alcoholPercentage: 5.3,
          bottleVolume: 500,
          price: 12.5,
          apk: 'Burk',
        },
      ],
      '/ecb': {
        base: 'EUR',
        date: '2026-08-28',
        rates: { SEK: 11.02, USD: 1.08 },
      },
    });

    // Alko — golden fixture payload through the real fetch path.
    const alko = await new AlkoFeedAdapter().fetch({
      feedUrl: `${baseUrl}/alko`,
      feedFormat: 'json',
    });
    expect(alko.records.length).toBeGreaterThan(0);
    expect(alko.records[0].currency).toBe('EUR');

    // Systembolaget — SEK offers convert through the (stubbed) FX service.
    const fx = {
      resolveRate: async () => ({
        rate: 0.087,
        dataset: { versionLabel: 'fx-test-2026' },
      }),
    };
    const systembolaget = await new SystembolagetFeedAdapter(fx as never).fetch(
      { feedUrl: `${baseUrl}/systembolaget`, feedFormat: 'json' },
    );
    expect(systembolaget.errors).toEqual([]);
    expect(systembolaget.records[0].priceCents).toBe(
      Math.round(12.5 * 0.087 * 100),
    );
    expect(systembolaget.records[0].fxDatasetVersion).toBe('fx-test-2026');

    // Posti + ECB — default fetchers, constructor-injected fixture URLs.
    const posti = await new PostiCarrierRateSource(
      undefined,
      `${baseUrl}/posti`,
    ).fetchRates();
    // The golden fixture deliberately includes invalid rows (BAD-LANE,
    // BAD-PRICE) — the parser reports them per-row and keeps the rest.
    expect(posti.rates.length).toBeGreaterThan(0);
    expect(posti.errors.join(' ')).toMatch(/BAD-LANE/);
    expect(posti.errors.join(' ')).toMatch(/BAD-PRICE/);

    const ecb = await new EcbReferenceRateSource(
      undefined,
      `${baseUrl}/ecb`,
    ).fetchLatestRates();
    expect(ecb.errors).toEqual([]);
    expect(ecb.snapshot!.referenceDate).toBe('2026-08-28');
    expect(ecb.snapshot!.rates.map((r) => r.quoteCurrency).sort()).toEqual([
      'SEK',
      'USD',
    ]);
  });
});
