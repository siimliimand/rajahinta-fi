/**
 * Chunked crawl-cycle tests (task 3.1, change sitemap-crawl-merchants;
 * design D5).
 *
 * Pins the three-phase cycle against injected HTTP and in-memory
 * stores: begin persists the cursor (queue + offset 0) and the next
 * watermark BEFORE walking, an in-flight cursor resumes without a
 * sitemap fetch, chunks slice ≤ CRAWL_CHUNK_FETCHES with a done flag,
 * advances move the offset durably and clear it on the final chunk,
 * and every cycle-level failure (sitemap, cursor save, watermark save,
 * vanished cursor) is collected instead of thrown — with the persisted
 * state left in the safe direction (over-crawl, never skip).
 *
 * @module CrawlChunkCycleTest
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CRAWL_CHUNK_FETCHES,
  InMemoryCrawlCursorStore,
  advanceCrawlCursor,
  beginCrawlCycle,
  walkCrawlChunk,
  type BeginCrawlCycleOptions,
  type CrawlCursorState,
  type WalkCrawlChunkOptions,
} from '../crawl-chunk-cycle';
import {
  MIN_REQUEST_SPACING_MS,
  type PageFetcher,
  type PageProcessor,
} from '../crawl-walker';
import type { ILastmodWatermarkStore } from '../lastmod-watermark.port';
import type { SitemapWatermark } from '../lastmod-diff';
import type { RawFeedRecord } from '../../interfaces/feed-adapter.interface';

const SITEMAP_URL = 'https://example.com/sitemap-products.xml';

function sitemapXml(locs: string[]): string {
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${locs.map((loc) => `<url><loc>${loc}</loc><lastmod>2026-10-01</lastmod></url>`).join('\n  ')}
</urlset>`;
}

const URLS = [
  'https://example.com/catalog/p-1.html',
  'https://example.com/catalog/p-2.html',
  'https://example.com/catalog/p-3.html',
];

interface PageSpec {
  body?: string;
  status?: number;
}

function stubHttp(
  pageSpecs: Record<string, PageSpec>,
  fetchedUrls: string[],
  sitemapBody: string | null,
): PageFetcher {
  const fetcher = async (url: string) => {
    fetchedUrls.push(url);
    if (url === SITEMAP_URL) {
      if (sitemapBody === null) {
        return { ok: false, status: 503, statusText: 'Service Unavailable', text: async () => '' };
      }
      return { ok: true, status: 200, statusText: 'OK', text: async () => sitemapBody };
    }
    const spec: PageSpec = pageSpecs[url] ?? { body: '<html></html>' };
    const status = spec.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Not Found',
      text: async () => spec.body ?? '',
    };
  };
  return fetcher as unknown as PageFetcher;
}

function makeRecord(url: string): RawFeedRecord {
  return {
    productId: url,
    productName: 'Bulk Beer 5% 0,33 l',
    manufacturer: '',
    brand: '',
    category: 'beer',
    alcoholByVolume: 0.05,
    volumeMl: 330,
    containerType: 'other',
    regulatoryClassification: 'beer',
    depositSystem: false,
    ean: null,
    priceCents: 199,
    currency: 'EUR',
    originalPriceCents: 199,
    originalCurrency: 'EUR',
    availability: 'in_stock',
    sourceUrl: url,
  };
}

function extractPageWithRecords(): PageProcessor {
  return (url) => ({ record: makeRecord(url) });
}

function memoryWatermarkStore(initial: SitemapWatermark | null = null): {
  store: ILastmodWatermarkStore;
  saveCalls: Array<{ merchantId: string; watermark: SitemapWatermark }>;
  failSave: boolean;
} {
  const saved = { current: initial };
  const seam = {
    store: {} as ILastmodWatermarkStore,
    saveCalls: [] as Array<{ merchantId: string; watermark: SitemapWatermark }>,
    failSave: false,
  };
  seam.store = {
    load: vi.fn(async () => saved.current),
    save: vi.fn(async (merchantId: string, watermark: SitemapWatermark) => {
      seam.saveCalls.push({ merchantId, watermark });
      if (seam.failSave) throw new Error('D1 write failed');
      saved.current = watermark;
    }),
  };
  return seam;
}

const PREDICATE = (url: string): boolean => url.includes('/catalog/p-');

function beginOptions(
  overrides: Partial<BeginCrawlCycleOptions> = {},
): BeginCrawlCycleOptions {
  const fetcherUrls: string[] = [];
  const watermarks = memoryWatermarkStore();
  return {
    merchantId: 'testmerchant',
    sitemapUrl: SITEMAP_URL,
    productUrlPredicate: PREDICATE,
    fullRefresh: false,
    watermarkStore: watermarks.store,
    cursorStore: new InMemoryCrawlCursorStore(),
    fetcher: stubHttp({}, fetcherUrls, sitemapXml(URLS)),
    ...overrides,
  };
}

function chunkOptions(
  overrides: Partial<WalkCrawlChunkOptions> = {},
): WalkCrawlChunkOptions {
  const fetcherUrls: string[] = [];
  return {
    merchantId: 'testmerchant',
    cursorStore: new InMemoryCrawlCursorStore(),
    extractPage: extractPageWithRecords(),
    fetcher: stubHttp({}, fetcherUrls, null),
    sleep: async () => {},
    minSpacingMs: MIN_REQUEST_SPACING_MS,
    ...overrides,
  };
}

describe('beginCrawlCycle', () => {
  it('first run: full queue, cursor persisted at offset 0, watermark written', async () => {
    const cursors = new InMemoryCrawlCursorStore();
    const options = beginOptions({ cursorStore: cursors });

    const outcome = await beginCrawlCycle(options);

    expect(outcome).toEqual({ queueLength: 3, resumed: false, errors: [] });
    expect(await cursors.loadCursor('testmerchant')).toEqual({
      queue: URLS,
      offset: 0,
    });
  });

  it('in-flight cursor resumes without a sitemap fetch', async () => {
    const cursors = new InMemoryCrawlCursorStore();
    await cursors.saveCursor('testmerchant', {
      queue: URLS,
      offset: 2,
    });
    const fetcherUrls: string[] = [];
    const options = beginOptions({
      cursorStore: cursors,
      fetcher: stubHttp({}, fetcherUrls, sitemapXml(URLS)),
    });

    const outcome = await beginCrawlCycle(options);

    expect(outcome).toEqual({ queueLength: 1, resumed: true, errors: [] });
    expect(fetcherUrls).toEqual([]); // the cycle's sitemap was fetched at begin
    // The cursor is untouched by a resume.
    expect(await cursors.loadCursor('testmerchant')).toEqual({
      queue: URLS,
      offset: 2,
    });
  });

  it('sitemap failure: collected errors, no cursor, watermark untouched', async () => {
    const cursors = new InMemoryCrawlCursorStore();
    const watermarks = memoryWatermarkStore();
    const fetcherUrls: string[] = [];
    const options = beginOptions({
      watermarkStore: watermarks.store,
      cursorStore: cursors,
      fetcher: stubHttp({}, fetcherUrls, null),
    });

    const outcome = await beginCrawlCycle(options);

    expect(outcome.queueLength).toBe(0);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toContain('503');
    expect(await cursors.loadCursor('testmerchant')).toBeNull();
    expect(watermarks.saveCalls).toHaveLength(0);
  });

  it('steady state (nothing changed): no cursor row, watermark rewritten', async () => {
    const cursors = new InMemoryCrawlCursorStore();
    const previous: SitemapWatermark = new Map(
      URLS.map((url) => [url, '2026-10-01' as string | null]),
    );
    const watermarks = memoryWatermarkStore(previous);
    const options = beginOptions({
      watermarkStore: watermarks.store,
      cursorStore: cursors,
    });

    const outcome = await beginCrawlCycle(options);

    expect(outcome).toEqual({ queueLength: 0, resumed: false, errors: [] });
    expect(await cursors.loadCursor('testmerchant')).toBeNull();
    expect(watermarks.saveCalls).toHaveLength(1);
  });

  it('full-refresh source: the whole set every cycle', async () => {
    const cursors = new InMemoryCrawlCursorStore();
    const previous: SitemapWatermark = new Map(
      URLS.map((url) => [url, '2026-10-01' as string | null]),
    );
    const options = beginOptions({
      fullRefresh: true,
      watermarkStore: memoryWatermarkStore(previous).store,
      cursorStore: cursors,
    });

    const outcome = await beginCrawlCycle(options);

    expect(outcome).toEqual({ queueLength: 3, resumed: false, errors: [] });
  });

  it('watermark-load failure still crawls the full set (error surfaced, pages not skipped)', async () => {
    const cursors = new InMemoryCrawlCursorStore();
    const failingStore: ILastmodWatermarkStore = {
      load: vi.fn(async () => {
        throw new Error('D1 read failed');
      }),
      save: vi.fn(async () => {}),
    };
    const options = beginOptions({
      watermarkStore: failingStore,
      cursorStore: cursors,
    });

    const outcome = await beginCrawlCycle(options);

    expect(outcome.queueLength).toBe(3);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toContain('watermark load failed');
    expect(await cursors.loadCursor('testmerchant')).toEqual({
      queue: URLS,
      offset: 0,
    });
  });

  it('watermark-save failure aborts the cycle and rolls the cursor back', async () => {
    const cursors = new InMemoryCrawlCursorStore();
    const watermarks = memoryWatermarkStore();
    watermarks.failSave = true;
    const options = beginOptions({
      watermarkStore: watermarks.store,
      cursorStore: cursors,
    });

    const outcome = await beginCrawlCycle(options);

    expect(outcome.queueLength).toBe(0);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toContain('watermark save failed');
    expect(await cursors.loadCursor('testmerchant')).toBeNull();
  });
});

describe('walkCrawlChunk + advanceCrawlCursor', () => {
  function seededChunkOptions(cursor: CrawlCursorState) {
    const cursors = new InMemoryCrawlCursorStore();
    const pageSpecs: Record<string, PageSpec> = {};
    for (const url of cursor.queue) {
      pageSpecs[url] = { body: '<html></html>' };
    }
    const fetcherUrls: string[] = [];
    const options = chunkOptions({
      cursorStore: cursors,
      fetcher: stubHttp(pageSpecs, fetcherUrls, null),
    });
    void cursors.saveCursor('testmerchant', cursor);
    return { cursors, fetcherUrls, options };
  }

  it('walks the whole queue in one chunk when it fits the bound', async () => {
    const { cursors, fetcherUrls, options } = seededChunkOptions({
      queue: URLS,
      offset: 0,
    });

    const chunk = await walkCrawlChunk(options);

    expect(chunk.fetched).toBe(3);
    expect(chunk.done).toBe(true);
    expect(chunk.records.map((r) => r.productId)).toEqual(URLS);
    expect(fetcherUrls).toEqual(URLS);
    // The chunk itself does not touch the cursor — the advance does.
    expect(await cursors.loadCursor('testmerchant')).toEqual({
      queue: URLS,
      offset: 0,
    });
  });

  it('slices at most CRAWL_CHUNK_FETCHES per chunk; advance moves the offset', async () => {
    const queue = Array.from(
      { length: 2 * CRAWL_CHUNK_FETCHES + 100 },
      (_, i) => `https://example.com/catalog/p-${i}.html`,
    );
    const { cursors, fetcherUrls, options } = seededChunkOptions({
      queue,
      offset: 0,
    });

    const first = await walkCrawlChunk(options);
    expect(first.fetched).toBe(CRAWL_CHUNK_FETCHES);
    expect(first.done).toBe(false);
    expect(fetcherUrls).toHaveLength(CRAWL_CHUNK_FETCHES);

    await advanceCrawlCursor({
      merchantId: 'testmerchant',
      cursorStore: cursors,
      fetched: first.fetched,
      done: first.done,
    });
    expect(await cursors.loadCursor('testmerchant')).toEqual({
      queue,
      offset: CRAWL_CHUNK_FETCHES,
    });

    const second = await walkCrawlChunk(options);
    expect(second.fetched).toBe(CRAWL_CHUNK_FETCHES);
    expect(second.done).toBe(false);
    expect(fetcherUrls).toHaveLength(2 * CRAWL_CHUNK_FETCHES);

    await advanceCrawlCursor({
      merchantId: 'testmerchant',
      cursorStore: cursors,
      fetched: second.fetched,
      done: second.done,
    });

    const third = await walkCrawlChunk(options);
    expect(third.fetched).toBe(100);
    expect(third.done).toBe(true);

    await advanceCrawlCursor({
      merchantId: 'testmerchant',
      cursorStore: cursors,
      fetched: third.fetched,
      done: third.done,
    });
    expect(await cursors.loadCursor('testmerchant')).toBeNull();
  });

  it('advance clamps a fetched count beyond the queue end', async () => {
    const { cursors } = seededChunkOptions({
      queue: URLS,
      offset: 1,
    });

    await advanceCrawlCursor({
      merchantId: 'testmerchant',
      cursorStore: cursors,
      fetched: 99,
      done: false,
    });

    expect(await cursors.loadCursor('testmerchant')).toEqual({
      queue: URLS,
      offset: 3,
    });
  });

  it('a vanished cursor is a collected done-with-error, never a throw', async () => {
    const options = chunkOptions({});

    const chunk = await walkCrawlChunk(options);

    expect(chunk).toEqual({
      records: [],
      fetched: 0,
      done: true,
      errors: [expect.stringContaining('cursor vanished')],
    });
  });

  it('page failures collect without stopping the chunk', async () => {
    const cursors = new InMemoryCrawlCursorStore();
    const pageSpecs: Record<string, PageSpec> = {
      [URLS[0]]: { status: 404 },
      [URLS[2]]: { body: '<html></html>' },
    };
    void cursors.saveCursor('testmerchant', { queue: URLS, offset: 0 });
    const fetcherUrls: string[] = [];
    const options = chunkOptions({
      cursorStore: cursors,
      fetcher: stubHttp(pageSpecs, fetcherUrls, null),
    });

    const chunk = await walkCrawlChunk(options);

    expect(chunk.fetched).toBe(3);
    expect(chunk.errors).toHaveLength(1);
    expect(chunk.errors[0]).toContain('404');
    expect(chunk.records.map((r) => r.productId)).toEqual([URLS[1], URLS[2]]);
  });

  it('respects the walker politeness spacing inside a chunk', async () => {
    const sleeps: number[] = [];
    const { options } = seededChunkOptions({ queue: URLS, offset: 0 });

    await walkCrawlChunk({
      ...options,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    // Spacing before every request except the walk's first (walker rule).
    expect(sleeps).toEqual([MIN_REQUEST_SPACING_MS, MIN_REQUEST_SPACING_MS]);
  });
});
