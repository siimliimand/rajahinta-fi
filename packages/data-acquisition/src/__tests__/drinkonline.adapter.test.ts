/**
 * drinkonline.eu crawl adapter tests (task 2.1, change
 * sitemap-crawl-merchants) — the golden fixture through the full
 * adapter surface, pinning the offers-as-array extraction, the
 * full-refresh mode (no sitemap `lastmod` — every cycle is a full
 * set), CMS-route filtering, the polite walk, and collected-not-thrown
 * failures.
 *
 * @module DrinkonlineAdapterTest
 */
import { describe, it, expect } from 'vitest';
import { InMemoryLastmodWatermarkStore } from '../adapters/sitemap-crawl.adapter';
import { DrinkonlineFeedAdapter } from '../adapters/drinkonline.adapter';
import {
  MIN_REQUEST_SPACING_MS,
  type PageFetcher,
} from '../crawl/crawl-walker';
import { DRINKONLINE_PRODUCT_HTML } from '../crawl/extract/__fixtures__/drinkonline-product.fixture';

const SITEMAP_URL = 'https://www.drinkonline.eu/sitemap-products.xml';
const A = 'https://www.drinkonline.eu/vodka/koskenkorva-vodka-60-500-ml/';
const B = 'https://www.drinkonline.eu/whisky/gordeiro-whisky-40-700ml/';
const CMS = 'https://www.drinkonline.eu/checkout/';

// The real sitemap carries no `lastmod` (design D4) — locs only.
const SITEMAP_XML = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${A}</loc></url>
  <url><loc>${B}</loc></url>
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
    const spec: PageSpec = pageSpecs[url] ?? { body: DRINKONLINE_PRODUCT_HTML };
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

describe('DrinkonlineFeedAdapter', () => {
  it('spec: selects the valid offer from the array instead of failing', async () => {
    const fetched: string[] = [];
    const fetcher = stubFetch({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetched);
    const adapter = new DrinkonlineFeedAdapter({
      fetcher,
      sleep: async () => {},
    });

    const { records, errors } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(errors).toEqual([]);
    expect(adapter.merchantId).toBe('drinkonline');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      productId: 'DN-78901',
      productName: 'Koskenkorva Vodka 60% 500 ml',
      brand: 'Koskenkorva',
      category: 'spirits',
      alcoholByVolume: 0.6,
      volumeMl: 500,
      ean: null,
      priceCents: 368,
      currency: 'EUR',
      availability: 'in_stock',
      sourceUrl: A,
    });
  });

  it('spec: full refresh — every cycle crawls the full set even when nothing changed', async () => {
    const fetched: string[] = [];
    const fetcher = stubFetch({ [SITEMAP_URL]: { body: SITEMAP_XML } }, fetched);
    // A completed previous cycle stored the very same (lastmod-less)
    // state — an incremental source would skip everything now.
    const adapter = new DrinkonlineFeedAdapter({
      fetcher,
      watermarkStore: new InMemoryLastmodWatermarkStore(
        new Map([
          [
            'drinkonline',
            new Map([
              [A, null],
              [B, null],
            ]),
          ],
        ]),
      ),
      sleep: async () => {},
    });

    const { records } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(fetched.slice(1)).toEqual([A, B]);
    expect(records).toHaveLength(2);
  });

  it('politeness and failure collection: sequential, paced, errors collected, never thrown', async () => {
    const fetched: string[] = [];
    const sleeps: number[] = [];
    const fetcher = stubFetch(
      {
        [SITEMAP_URL]: { body: SITEMAP_XML },
        [A]: { status: 500, statusText: 'Internal Server Error' },
      },
      fetched,
    );
    const adapter = new DrinkonlineFeedAdapter({
      fetcher,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const { records, errors } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(fetched.slice(1)).toEqual([A, B]);
    expect(sleeps).toEqual([MIN_REQUEST_SPACING_MS]);
    expect(records).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`${A} returned HTTP 500`);
  });
});
