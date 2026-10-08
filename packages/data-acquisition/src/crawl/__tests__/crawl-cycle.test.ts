/**
 * Sitemap crawl cycle tests (task 1.1, change sitemap-crawl-merchants;
 * designs D2/D4/D5).
 *
 * Pins the whole cycle against injected HTTP and an in-memory watermark
 * store: sitemap fetched once, non-product locs filtered before the
 * diff, first crawl full, steady state incremental, full-refresh
 * sources always full, and every failure path (sitemap, watermark
 * load, watermark save) collected instead of thrown — with the
 * watermark left untouched when nothing was crawled.
 *
 * @module CrawlCycleTest
 */
import { describe, it, expect, vi } from 'vitest';
import { runCrawlCycle, type CrawlCycleOptions } from '../crawl-cycle';
import {
  MIN_REQUEST_SPACING_MS,
  type PageFetcher,
  type PageProcessor,
} from '../crawl-walker';
import type { ILastmodWatermarkStore } from '../lastmod-watermark.port';
import type { SitemapWatermark } from '../lastmod-diff';
import type { RawFeedRecord } from '../../interfaces/feed-adapter.interface';

const SITEMAP_URL = 'https://example.com/sitemap-products.xml';
const A = 'https://example.com/catalog/a.html';
const B = 'https://example.com/catalog/b.html';
const C = 'https://example.com/catalog/c.html';
const IMAGE = 'https://example.com/img/a.jpg';

const SITEMAP_XML = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${A}</loc><lastmod>2026-09-30</lastmod></url>
  <url><loc>${B}</loc><lastmod>2026-09-29</lastmod></url>
  <url><loc>${C}</loc><lastmod>2026-09-28</lastmod></url>
  <url><loc>${IMAGE}</loc></url>
</urlset>`;

interface PageSpec {
  body?: string;
  status?: number;
  statusText?: string;
}

function stubHttp(pageSpecs: Record<string, PageSpec>, fetchedUrls: string[]) {
  const fetcher = async (url: string) => {
    fetchedUrls.push(url);
    const spec: PageSpec = pageSpecs[url] ?? { body: '<html></html>' };
    const status = spec.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: spec.statusText ?? 'OK',
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

function memoryStore(initial: SitemapWatermark | null = null): {
  store: ILastmodWatermarkStore;
  saveCalls: Array<{ merchantId: string; watermark: SitemapWatermark }>;
} {
  const saveCalls: Array<{ merchantId: string; watermark: SitemapWatermark }> = [];
  const store: ILastmodWatermarkStore = {
    load: vi.fn(async () => initial),
    save: vi.fn(async (merchantId, watermark) => {
      saveCalls.push({ merchantId, watermark });
    }),
  };
  return { store, saveCalls };
}

function cycleOptions(
  overrides: Partial<CrawlCycleOptions> = {},
): CrawlCycleOptions {
  return {
    merchantId: 'example',
    sitemapUrl: SITEMAP_URL,
    productUrlPredicate: (url: string) => url.endsWith('.html'),
    fullRefresh: false,
    extractPage: extractPageWithRecords(),
    sleep: async () => {},
    ...overrides,
    // The spread leaves the required-for-this-suite fields optional in
    // the inferred type; every test passes them via overrides.
  } as CrawlCycleOptions;
}

describe('runCrawlCycle — discovery and diff (design D4)', () => {
  it('spec: first crawl — sitemap once, every product URL crawled at the polite spacing, full watermark saved', async () => {
    const fetchedUrls: string[] = [];
    const fetcher = stubHttp({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetchedUrls);
    const { store, saveCalls } = memoryStore(null);
    const sleeps: number[] = [];

    const { records, errors } = await runCrawlCycle({
      ...cycleOptions({ fetcher }),
      watermarkStore: store,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(errors).toEqual([]);
    expect(fetchedUrls[0]).toBe(SITEMAP_URL);
    // image loc filtered out; product pages sequential with spacing
    expect(fetchedUrls.slice(1)).toEqual([A, B, C]);
    expect(sleeps).toEqual([MIN_REQUEST_SPACING_MS, MIN_REQUEST_SPACING_MS]);
    expect(records).toHaveLength(3);
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].merchantId).toBe('example');
    expect(Object.fromEntries(saveCalls[0].watermark)).toEqual({
      [A]: '2026-09-30',
      [B]: '2026-09-29',
      [C]: '2026-09-28',
    });
  });

  it('spec: steady state — only changed and new URLs crawled, watermark updated', async () => {
    const fetchedUrls: string[] = [];
    const fetcher = stubHttp({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetchedUrls);
    const previous: SitemapWatermark = new Map([
      [A, '2026-09-30'],
      [B, '2026-09-01'],
      [C, '2026-09-28'],
    ]);
    const { store, saveCalls } = memoryStore(previous);

    const { records } = await runCrawlCycle(
      cycleOptions({ fetcher, watermarkStore: store }),
    );

    expect(fetchedUrls.slice(1)).toEqual([B]);
    expect(records).toEqual([makeRecord(B)]);
    expect(Object.fromEntries(saveCalls[0].watermark)).toEqual({
      [A]: '2026-09-30',
      [B]: '2026-09-29',
      [C]: '2026-09-28',
    });
  });

  it('spec: a full-refresh source (no lastmod) crawls the full set every cycle', async () => {
    const fetchedUrls: string[] = [];
    const fetcher = stubHttp(
      {
        [SITEMAP_URL]: {
          body: `<urlset><url><loc>${A}</loc></url><url><loc>${B}</loc></url></urlset>`,
        },
      },
      fetchedUrls,
    );
    const previous: SitemapWatermark = new Map([
      [A, null],
      [B, null],
    ]);
    const { store } = memoryStore(previous);

    const { records } = await runCrawlCycle(
      cycleOptions({ fetcher, watermarkStore: store, fullRefresh: true }),
    );

    expect(fetchedUrls.slice(1)).toEqual([A, B]);
    expect(records).toHaveLength(2);
  });
});

describe('runCrawlCycle — failure collection, never throws', () => {
  it('spec: sitemap failure ends the cycle with nothing crawled and the watermark untouched', async () => {
    const fetchedUrls: string[] = [];
    const fetcher = stubHttp(
      { [SITEMAP_URL]: { status: 503, statusText: 'Service Unavailable' } },
      fetchedUrls,
    );
    const { store, saveCalls } = memoryStore(new Map([[A, '2026-09-30']]));

    const { records, errors } = await runCrawlCycle(
      cycleOptions({ fetcher, watermarkStore: store }),
    );

    expect(fetchedUrls).toEqual([SITEMAP_URL]);
    expect(records).toEqual([]);
    expect(errors).toEqual([
      expect.stringContaining('sitemap https://example.com/sitemap-products.xml returned HTTP 503'),
    ]);
    expect(saveCalls).toHaveLength(0);
  });

  it('a watermark load failure forces a full crawl and is collected', async () => {
    const fetchedUrls: string[] = [];
    const fetcher = stubHttp({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetchedUrls);
    const store: ILastmodWatermarkStore = {
      load: vi.fn(async () => {
        throw new Error('D1 unavailable');
      }),
      save: vi.fn(async () => {}),
    };

    const { records, errors } = await runCrawlCycle(
      cycleOptions({ fetcher, watermarkStore: store }),
    );

    expect(fetchedUrls.slice(1)).toEqual([A, B, C]);
    expect(records).toHaveLength(3);
    expect(errors).toEqual([
      expect.stringContaining('watermark load failed (D1 unavailable)'),
    ]);
  });

  it('a watermark save failure keeps the crawled records and is collected', async () => {
    const fetcher = stubHttp({ [SITEMAP_URL]: { body: SITEMAP_XML } }, []);
    const store: ILastmodWatermarkStore = {
      load: vi.fn(async () => null),
      save: vi.fn(async () => {
        throw new Error('quota exceeded');
      }),
    };

    const { records, errors } = await runCrawlCycle(
      cycleOptions({ fetcher, watermarkStore: store }),
    );

    expect(records).toHaveLength(3);
    expect(errors).toEqual([
      expect.stringContaining('watermark save failed: quota exceeded'),
    ]);
  });

  it('an unusable sitemap body (WAF page) is an error, not a silent zero', async () => {
    const fetcher = stubHttp(
      { [SITEMAP_URL]: { body: '<html>Just a moment...</html>' } },
      [],
    );
    const { store, saveCalls } = memoryStore(null);

    const { errors } = await runCrawlCycle(
      cycleOptions({ fetcher, watermarkStore: store }),
    );

    expect(errors).toEqual([expect.stringContaining('not a sitemap urlset')]);
    expect(saveCalls).toHaveLength(0);
  });
});
