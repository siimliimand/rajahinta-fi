/**
 * Crawl-fetch workflow-step tests (task 3.1, change
 * sitemap-crawl-merchants; design D5) — the crawl branch of the
 * ingestion Workflow over a fake `step.do` (emulated replay/retry),
 * the REAL LicoreaFeedAdapter wiring (in-memory stores, stub HTTP,
 * no real waits), and the golden licorea extraction fixture.
 *
 * Pins: the crawl fetch becomes discover → chunk/advance pairs (≤ 300
 * detail fetches per chunk step, a durable sleep before each chunk
 * after the first), an in-flight cursor resumes without a second
 * sitemap fetch, the downstream map/gate/upsert/quality steps run
 * UNCHANGED over the accumulated records, and a GRANTED crawl merchant
 * whose adapter is missing from the composed registry completes
 * in-band (the recorded "No feed adapter registered" error) — never a
 * thrown, retry-burning failure.
 *
 * @module CrawlFetchStepsTest
 */

import { describe, it, expect, vi } from 'vitest';
import {
  INGESTION_STEP_RETRY,
  runIngestionWorkflow,
  type IngestionStageServices,
  type IngestionWorkflowParams,
  type StepRetryConfig,
  type WorkflowStepLike,
} from '../ingestion-steps';
import { runCrawlFetchSteps } from '../crawl-fetch-steps';
import { InMemoryCrawlCursorStore } from '../../../../../packages/data-acquisition/src/crawl/crawl-chunk-cycle';
import { InMemoryLastmodWatermarkStore } from '../../../../../packages/data-acquisition/src/adapters/sitemap-crawl.adapter';
import { LicoreaFeedAdapter } from '../../../../../packages/data-acquisition/src/adapters/licorea.adapter';
import {
  LICOREA_PRODUCT_HTML,
  LICOREA_PRODUCT_URL,
} from '../../../../../packages/data-acquisition/src/crawl/extract/__fixtures__/licorea-product.fixture';
import type { PageFetcher } from '../../../../../packages/data-acquisition/src/crawl/crawl-walker';
import type { IUpsertRepository } from '../../../../../packages/data-acquisition/src/interfaces/upsert-port.interface';
import type { MerchantConfig } from '../../../../../packages/data-acquisition/src/interfaces/merchant-config.interface';
import {
  ReliabilityService,
  SourceGovernanceService,
} from '@rajahinta/core-domain';
import { InMemorySourceGovernanceRepository } from '../../../../../packages/application-api/src/ops/governance/in-memory-source-governance.repository';
import {
  DataMappingService,
} from '../../../../../packages/data-acquisition/src/services/data-mapping.service';
import {
  DataQualityService,
} from '../../../../../packages/data-acquisition/src/services/data-quality.service';
import {
  FeedIngestionService,
} from '../../../../../packages/data-acquisition/src/services/feed-ingestion.service';
import {
  ContentLintService,
} from '../../../../../packages/data-acquisition/src/content/content-lint.service';
import { createLogger, type Logger } from '../../logger';

const LOG: Logger = createLogger('error');
const MERCHANT = 'licorea';
const SITEMAP_URL = 'https://www.licorea.com/sitemapproducts_en.xml';

// ---------------------------------------------------------------------------
// Fake step API — the ingestion.workflow.test.ts semantics, local copy
// ---------------------------------------------------------------------------

class FakeWorkflowStep implements WorkflowStepLike {
  private readonly outputs = new Map<string, unknown>();
  readonly invocations: { name: string; attempt: number }[] = [];
  readonly sleeps: { name: string; sleepFor: number }[] = [];

  sleep(name: string, sleepFor: number): Promise<void> {
    this.sleeps.push({ name, sleepFor });
    return Promise.resolve();
  }

  do<T>(
    name: string,
    _config: StepRetryConfig,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (this.outputs.has(name)) {
      return Promise.resolve(this.outputs.get(name) as T);
    }
    this.invocations.push({ name, attempt: this.invocations.filter((i) => i.name === name).length });
    return callback().then((out) => {
      this.outputs.set(name, out);
      return out;
    });
  }
}

const noopClaim = async (): Promise<void> => undefined;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BULK_URLS = Array.from(
  { length: 350 },
  (_, i) => `https://www.licorea.com/test-item-${i}-en-p-${10_000 + i}.html`,
);

/** Sitemap = 350 bulk product locs + the golden fixture product. */
const SITEMAP_XML = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${BULK_URLS.map((loc) => `<url><loc>${loc}</loc><lastmod>2026-10-01</lastmod></url>`).join('\n  ')}
  <url><loc>${LICOREA_PRODUCT_URL}</loc><lastmod>2026-10-01</lastmod></url>
</urlset>`;

function stubLicoreaHttp(fetchedUrls: string[], sitemapBody: string | null): PageFetcher {
  const fetcher = async (url: string) => {
    fetchedUrls.push(url);
    if (url === SITEMAP_URL) {
      return sitemapBody === null
        ? { ok: false, status: 503, statusText: 'Service Unavailable', text: async () => '' }
        : { ok: true, status: 200, statusText: 'OK', text: async () => sitemapBody };
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => (url === LICOREA_PRODUCT_URL ? LICOREA_PRODUCT_HTML : '<html></html>'),
    };
  };
  return fetcher as unknown as PageFetcher;
}

interface AdapterSeam {
  adapter: LicoreaFeedAdapter;
  fetchedUrls: string[];
  watermarks: InMemoryLastmodWatermarkStore;
  cursors: InMemoryCrawlCursorStore;
}

function licoreaAdapter(sitemapBody: string | null = SITEMAP_XML): AdapterSeam {
  const fetchedUrls: string[] = [];
  const watermarks = new InMemoryLastmodWatermarkStore();
  const cursors = new InMemoryCrawlCursorStore();
  const adapter = new LicoreaFeedAdapter({
    watermarkStore: watermarks,
    cursorStore: cursors,
    fetcher: stubLicoreaHttp(fetchedUrls, sitemapBody),
    sleep: async () => {},
  });
  return { adapter, fetchedUrls, watermarks, cursors };
}

function crawlConfig(): MerchantConfig {
  return {
    merchantId: MERCHANT,
    name: 'Licorea',
    country: 'ES',
    feedUrl: SITEMAP_URL,
    feedFormat: 'xml',
    pollingIntervalMs: 86_400_000,
  };
}

function fakeUpserts(): IUpsertRepository & { upsertedProducts: { name: string }[] } {
  const upsertedProducts: { name: string }[] = [];
  return {
    upsertedProducts,
    upsertProduct: async (product) => {
      upsertedProducts.push({ name: product.name });
      return { productId: upsertedProducts.length, created: true };
    },
    upsertOffer: async () => ({ offerId: 1, changed: true }),
  } as IUpsertRepository & { upsertedProducts: { name: string }[] };
}

function workflowParams(): IngestionWorkflowParams {
  return {
    dedupeKey: `price-ingestion-${MERCHANT}-2026-10-07-10`,
    merchantId: MERCHANT,
    sourceUrl: SITEMAP_URL,
  };
}

function stageServices(options: {
  adapterSeam?: AdapterSeam;
  upserts?: IUpsertRepository & { upsertedProducts: { name: string }[] };
  withCrawlAdapters?: boolean;
}): IngestionStageServices {
  const governanceRepository = new InMemorySourceGovernanceRepository();
  void governanceRepository.create({
    merchantId: MERCHANT,
    acquisitionMethod: 'COMPLIANT_CRAWLING',
    permissionStatus: 'GRANTED',
    sourceUrl: SITEMAP_URL,
  });
  return {
    registry: {
      findByMerchantId: async () =>
        ({
          id: 1,
          merchantId: MERCHANT,
          name: 'Licorea',
          country: 'ES',
          feedUrl: SITEMAP_URL,
          feedFormat: 'xml',
          pollingIntervalMs: 86_400_000,
          createdAt: '2026-10-07T00:00:00.000Z',
          updatedAt: '2026-10-07T00:00:00.000Z',
        }) as unknown as Awaited<
          ReturnType<
            IngestionStageServices['registry']['findByMerchantId']
          >
        >,
    },
    governance: new SourceGovernanceService(governanceRepository),
    feeds: new FeedIngestionService(new Map()), // crawl path bypasses the generic lookup
    ...(options.withCrawlAdapters === false
      ? {}
      : {
          crawlFeedAdapters: new Map([
            [MERCHANT, (options.adapterSeam ?? licoreaAdapter()).adapter],
          ]),
        }),
    mapping: new DataMappingService(),
    contentLint: new ContentLintService(),
    upserts: options.upserts ?? fakeUpserts(),
    dataQuality: new DataQualityService(new ReliabilityService()),
  };
}

function runWorkflow(services: IngestionStageServices, step: FakeWorkflowStep = new FakeWorkflowStep()) {
  return {
    step,
    promise: runIngestionWorkflow(workflowParams(), {
      env: {} as never,
      step,
      NonRetryableError: class NonRetryable extends Error {},
      services,
      claims: { complete: vi.fn(noopClaim), release: vi.fn(noopClaim) },
      log: LOG,
    }),
  };
}

// ---------------------------------------------------------------------------
// Chunk loop mechanics
// ---------------------------------------------------------------------------

describe('runCrawlFetchSteps — chunked resumable fetch', () => {
  it('351 URLs walk as two ≤300-fetch chunks with the budget sleep between them', async () => {
    const { adapter, fetchedUrls } = licoreaAdapter();
    const step = new FakeWorkflowStep();

    const outcome = await runCrawlFetchSteps({
      step,
      adapter,
      config: crawlConfig(),
      retry: INGESTION_STEP_RETRY,
    });

    // The golden fixture product is the only extractable record; the
    // bulk pages yield collected per-page extraction errors instead.
    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0].sourceUrl).toBe(LICOREA_PRODUCT_URL);
    // Detail fetches: 300 + 51 = 351 (+1 sitemap fetch).
    expect(fetchedUrls).toHaveLength(352);
    expect(fetchedUrls[0]).toBe(SITEMAP_URL); // sitemap exactly once

    const names = step.invocations.map((i) => i.name);
    expect(names).toEqual([
      'crawl-discover',
      'crawl-chunk-1',
      'crawl-advance-1',
      'crawl-chunk-2',
      'crawl-advance-2',
    ]);
    expect(step.sleeps).toEqual([
      { name: 'crawl-chunk-budget-reset-2', sleepFor: 1_000 },
    ]);
  });

  it('an in-flight cursor resumes without a second sitemap fetch', async () => {
    const seam = licoreaAdapter();
    // Instance one died after the first chunk: discover + chunk + advance.
    const discovered = await seam.adapter.beginCrawlCycle(SITEMAP_URL);
    expect(discovered.queueLength).toBe(351);
    const chunk1 = await seam.adapter.crawlChunk();
    expect(chunk1.done).toBe(false);
    await seam.adapter.advanceCrawl(chunk1.fetched, chunk1.done);

    // Instance two (next message / fresh step cache) resumes the queue.
    const step = new FakeWorkflowStep();
    const outcome = await runCrawlFetchSteps({
      step,
      adapter: seam.adapter,
      config: crawlConfig(),
      retry: INGESTION_STEP_RETRY,
    });

    expect(outcome.records.map((r) => r.sourceUrl)).toContain(LICOREA_PRODUCT_URL);
    const sitemapFetches = seam.fetchedUrls.filter((url) => url === SITEMAP_URL);
    expect(sitemapFetches).toHaveLength(1); // at most once per cycle (spec)
    // 51 remaining URLs in one chunk — no budget sleep for a single chunk.
    expect(step.invocations.map((i) => i.name)).toEqual([
      'crawl-discover',
      'crawl-chunk-1',
      'crawl-advance-1',
    ]);
    expect(step.sleeps).toEqual([]);
    // The cycle drained: the cursor is gone, the watermark persisted.
    expect(await seam.cursors.loadCursor(MERCHANT)).toBeNull();
    expect((await seam.watermarks.load(MERCHANT))?.size).toBe(351);
  });

  it('a discover abort (sitemap failure) ends the run with collected errors and no chunk steps', async () => {
    const { adapter, fetchedUrls } = licoreaAdapter(null);
    const step = new FakeWorkflowStep();

    const outcome = await runCrawlFetchSteps({
      step,
      adapter,
      config: crawlConfig(),
      retry: INGESTION_STEP_RETRY,
    });

    expect(outcome.records).toEqual([]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toContain('503');
    expect(fetchedUrls).toEqual([SITEMAP_URL]); // sitemap only, no detail pages
    expect(step.invocations.map((i) => i.name)).toEqual(['crawl-discover']);
  });
});

// ---------------------------------------------------------------------------
// Workflow integration — the existing gates run unchanged
// ---------------------------------------------------------------------------

describe('runIngestionWorkflow — crawl merchant', () => {
  it('hands the accumulated records to the unchanged map/gate/upsert/quality steps', async () => {
    const upserts = fakeUpserts();
    const services = stageServices({ upserts });

    const result = (await runWorkflow(services).promise) as {
      productsIngested: number;
      errors: string[];
    };

    // The 350 bulk pages carry no extractable product: one collected
    // per-page extraction error each, surfaced in the run report (the
    // must-not-throw contract) — the fixture product still ingests.
    expect(result.errors).toHaveLength(BULK_URLS.length);
    expect(result.productsIngested).toBe(1);
    expect(upserts.upsertedProducts[0].name).toContain('Brugal');
  });

  it('pins the step sequence: crawl steps then the ordinary pipeline steps', async () => {
    const step = new FakeWorkflowStep();
    await runWorkflow(stageServices({}), step).promise;

    expect(step.invocations.map((i) => i.name)).toEqual([
      'resolve-merchant',
      'governance-gate',
      'crawl-discover',
      'crawl-chunk-1',
      'crawl-advance-1',
      'crawl-chunk-2',
      'crawl-advance-2',
      'map-records',
      'volume-ceiling-gate',
      'upsert-offers-1',
      'data-quality',
      'data-quality-metrics',
      'complete-job-claim',
    ]);
  });

  it('a GRANTED crawl merchant without a composed adapter completes in-band, never throws', async () => {
    // The deploy-lag hazard: the 2.2 seed landed the registry rows
    // before the adapters deploy. The generic fetch-feed lookup returns
    // its descriptive error and the run COMPLETES with zero records —
    // claim completed, not released; no crawl code runs.
    const step = new FakeWorkflowStep();
    const complete = vi.fn(noopClaim);
    const services = stageServices({ withCrawlAdapters: false });

    const result = (await runIngestionWorkflow(workflowParams(), {
      env: {} as never,
      step,
      NonRetryableError: class NonRetryable extends Error {},
      services,
      claims: { complete, release: vi.fn(noopClaim) },
      log: LOG,
    })) as { productsIngested: number; errors: string[] };

    expect(result.productsIngested).toBe(0);
    expect(result.errors).toEqual([
      'No feed adapter registered for merchant "licorea"',
    ]);
    expect(step.invocations.map((i) => i.name)).toEqual([
      'resolve-merchant',
      'governance-gate',
      'fetch-feed',
      'complete-job-claim',
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
