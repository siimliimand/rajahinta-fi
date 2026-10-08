/**
 * viinarannasta.eu crawl adapter tests (task 2.1, change
 * sitemap-crawl-merchants) — the golden fixture through the full
 * adapter surface: sitemap fetched once, product URLs only, the
 * polite sequential walk (≥ 1 s, injectable pacing), the incremental
 * lastmod diff, and collected-not-thrown failures.
 *
 * @module ViinarannastaAdapterTest
 */
import { describe, it, expect } from 'vitest';
import { InMemoryLastmodWatermarkStore } from '../adapters/sitemap-crawl.adapter';
import { ViinarannastaFeedAdapter } from '../adapters/viinarannasta.adapter';
import {
  MIN_REQUEST_SPACING_MS,
  type PageFetcher,
} from '../crawl/crawl-walker';
import type { SitemapWatermark } from '../crawl/lastmod-diff';
import { VIINARANNASTA_PRODUCT_HTML } from '../crawl/extract/__fixtures__/viinarannasta-product.fixture';

const SITEMAP_URL = 'https://viinarannasta.eu/1_fi_0_sitemap.xml';
const A = 'https://viinarannasta.eu/fi/viskit/1718-jameson-irish-whiskey-07l.html';
const B = 'https://viinarannasta.eu/fi/likoorit/1719-koskenkorva-05l.html';
const IMAGE = 'https://viinarannasta.eu/1718-large_default/jameson.jpg';
const CMS = 'https://viinarannasta.eu/fi/content/4-toimitusehdot';

const SITEMAP_XML = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${A}</loc><lastmod>2026-09-30</lastmod></url>
  <url><loc>${B}</loc><lastmod>2026-09-29</lastmod></url>
  <url><loc>${IMAGE}</loc></url>
  <url><loc>${CMS}</loc></url>
</urlset>`;

interface PageSpec {
  body?: string;
  status?: number;
  statusText?: string;
  fail?: boolean;
}

function stubFetch(
  pageSpecs: Record<string, PageSpec>,
  fetched: string[],
): PageFetcher {
  return (async (url: string) => {
    fetched.push(url);
    const spec: PageSpec = pageSpecs[url] ?? { body: VIINARANNASTA_PRODUCT_HTML };
    if (spec.fail === true) throw new Error('connection reset');
    const status = spec.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: spec.statusText ?? 'OK',
      text: async () => spec.body ?? '',
    } as Response;
  }) as unknown as PageFetcher;
}

describe('ViinarannastaFeedAdapter', () => {
  it('spec: first crawl — sitemap once, product URLs only, golden fixture record', async () => {
    const fetched: string[] = [];
    const fetcher = stubFetch({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetched);
    const adapter = new ViinarannastaFeedAdapter({
      fetcher,
      sleep: async () => {},
    });

    const { records, errors } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(errors).toEqual([]);
    expect(adapter.merchantId).toBe('viinarannasta');
    expect(fetched[0]).toBe(SITEMAP_URL);
    // image and CMS locs are never fetched
    expect(fetched).toHaveLength(3);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      productId: '1718',
      productName: 'Jameson Irish Whiskey 40% 0,7 l',
      category: 'spirits',
      alcoholByVolume: 0.4,
      volumeMl: 700,
      ean: '5011013100156',
      priceCents: 2799,
      currency: 'EUR',
      availability: 'in_stock',
      sourceUrl: A,
    });
  });

  it('politeness: sequential walk under the injectable pacing', async () => {
    const fetched: string[] = [];
    const sleeps: number[] = [];
    const fetcher = stubFetch({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetched);
    const adapter = new ViinarannastaFeedAdapter({
      fetcher,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await adapter.fetch({ feedUrl: SITEMAP_URL, feedFormat: 'xml' });

    expect(fetched.slice(1)).toEqual([A, B]);
    // spacing sits between consecutive requests: pages-1 waits
    expect(sleeps).toEqual([MIN_REQUEST_SPACING_MS]);
  });

  it('incremental: unchanged URLs are skipped, changed ones re-crawled', async () => {
    const fetched: string[] = [];
    const fetcher = stubFetch({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetched);
    const previous: SitemapWatermark = new Map([
      [A, '2026-09-30'],
      [B, '2026-09-01'],
    ]);
    const adapter = new ViinarannastaFeedAdapter({
      fetcher,
      watermarkStore: new InMemoryLastmodWatermarkStore(
        new Map([['viinarannasta', previous]]),
      ),
      sleep: async () => {},
    });

    const { records } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(fetched.slice(1)).toEqual([B]);
    expect(records).toHaveLength(1);
  });

  it('spec: page failures are collected, never thrown', async () => {
    const fetched: string[] = [];
    const fetcher = stubFetch(
      {
        [SITEMAP_URL]: { body: SITEMAP_XML },
        [A]: { fail: true },
        [B]: { status: 500, statusText: 'Internal Server Error' },
      },
      fetched,
    );
    const adapter = new ViinarannastaFeedAdapter({
      fetcher,
      sleep: async () => {},
    });

    const { records, errors } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(records).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain(`${A} fetch failed`);
    expect(errors[1]).toContain(`${B} returned HTTP 500`);
  });
});
