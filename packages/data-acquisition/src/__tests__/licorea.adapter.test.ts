/**
 * licorea.com crawl adapter tests (task 2.1, change
 * sitemap-crawl-merchants) — the golden fixture through the full
 * adapter surface, pinning the complete-JSON-LD extraction (EAN
 * straight from `gtin13`, no fallback parsing), the EN-storefront-only
 * predicate, the polite walk, and collected-not-thrown failures.
 *
 * @module LicoreaAdapterTest
 */
import { describe, it, expect } from 'vitest';
import { LicoreaFeedAdapter } from '../adapters/licorea.adapter';
import {
  MIN_REQUEST_SPACING_MS,
  type PageFetcher,
} from '../crawl/crawl-walker';
import { LICOREA_PRODUCT_HTML } from '../crawl/extract/__fixtures__/licorea-product.fixture';

const SITEMAP_URL = 'https://www.licorea.com/sitemapproducts_en.xml';
const A = 'https://www.licorea.com/brugal-aniejo-rum-07l-en-p-31415.html';
const B = 'https://www.licorea.com/gordeiro-gin-07l-en-p-31416.html';
const ES = 'https://www.licorea.com/brugal-aniejo-rum-07l-es-p-31415.html';
const CMS = 'https://www.licorea.com/en/about-us';

const SITEMAP_XML = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${A}</loc><lastmod>2026-09-30</lastmod></url>
  <url><loc>${B}</loc><lastmod>2026-09-29</lastmod></url>
  <url><loc>${ES}</loc><lastmod>2026-09-28</lastmod></url>
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
    const spec: PageSpec = pageSpecs[url] ?? { body: LICOREA_PRODUCT_HTML };
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

describe('LicoreaFeedAdapter', () => {
  it('spec: EAN, EUR price, and availability straight from JSON-LD', async () => {
    const fetched: string[] = [];
    const fetcher = stubFetch({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetched);
    const adapter = new LicoreaFeedAdapter({
      fetcher,
      sleep: async () => {},
    });

    const { records, errors } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(errors).toEqual([]);
    expect(adapter.merchantId).toBe('licorea');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      productId: 'LIC-31415',
      productName: 'Brugal Añejo Rum 40% 0.7 l',
      brand: 'Brugal',
      manufacturer: 'Brugal',
      category: 'spirits',
      alcoholByVolume: 0.4,
      volumeMl: 700,
      ean: '8410184100115',
      priceCents: 1895,
      currency: 'EUR',
      availability: 'in_stock',
      sourceUrl: A,
    });
  });

  it('en storefront only: storefront twins and CMS routes are never fetched, polite walk', async () => {
    const fetched: string[] = [];
    const sleeps: number[] = [];
    const fetcher = stubFetch({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetched);
    const adapter = new LicoreaFeedAdapter({
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
    const adapter = new LicoreaFeedAdapter({
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
