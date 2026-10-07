/**
 * viinikauppa.com crawl adapter tests (task 2.1, change
 * sitemap-crawl-merchants) — the golden fixture through the full
 * adapter surface, pinning the store-brand override, the
 * description-prose ABV, the title multipack volume, CMS-route
 * filtering, the polite walk, and collected-not-thrown failures.
 *
 * @module ViinikauppaAdapterTest
 */
import { describe, it, expect } from 'vitest';
import { ViinikauppaFeedAdapter } from '../adapters/viinikauppa.adapter';
import {
  MIN_REQUEST_SPACING_MS,
  type PageFetcher,
} from '../crawl/crawl-walker';
import { VIINIKAUPPA_PRODUCT_HTML } from '../crawl/extract/__fixtures__/viinikauppa-product.fixture';

const SITEMAP_URL = 'https://www.viinikauppa.com/catalog/xmlsitemap/products';
const A = 'https://www.viinikauppa.com/catalog/sandels-olut-tolkki-24x33cl';
const B = 'https://www.viinikauppa.com/catalog/karjala-olut-tolkki-24x33cl';
const CMS = 'https://www.viinikauppa.com/catalog/kampanjat/etusivu';

const SITEMAP_XML = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${A}</loc><lastmod>2026-09-30</lastmod></url>
  <url><loc>${B}</loc><lastmod>2026-09-29</lastmod></url>
  <url><loc>${CMS}</loc><lastmod>2026-09-28</lastmod></url>
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
    const spec: PageSpec = pageSpecs[url] ?? { body: VIINIKAUPPA_PRODUCT_HTML };
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

describe('ViinikauppaFeedAdapter', () => {
  it('spec: the store-brand trap is overridden and ABV parsed from the description prose', async () => {
    const fetched: string[] = [];
    const fetcher = stubFetch({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetched);
    const adapter = new ViinikauppaFeedAdapter({
      fetcher,
      sleep: async () => {},
    });

    const { records, errors } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(errors).toEqual([]);
    expect(adapter.merchantId).toBe('viinikauppa');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      productId: 'sandels-olut-tolkki-24x33cl',
      productName: 'Sandels olut tölkki 24x33cl',
      // "Viinikauppa" is the STORE, never the product brand
      brand: '',
      manufacturer: '',
      category: 'beer',
      alcoholByVolume: 0.047,
      packCount: 24,
      volumeMl: 330,
      containerType: 'can',
      ean: null,
      priceCents: 1880,
      currency: 'EUR',
      availability: 'out_of_stock',
      sourceUrl: A,
    });
  });

  it('politeness: sequential walk, CMS routes never fetched, injectable pacing', async () => {
    const fetched: string[] = [];
    const sleeps: number[] = [];
    const fetcher = stubFetch({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetched);
    const adapter = new ViinikauppaFeedAdapter({
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
    const adapter = new ViinikauppaFeedAdapter({
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
