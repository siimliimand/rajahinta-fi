/**
 * www.whisky.fr (LMDW) crawl adapter tests (task 3.1, change
 * onboard-lmdw-crawl-merchant) — the golden fixture through the full
 * adapter surface: the pure-sitemap decision (design D1), the
 * single-segment product predicate, the state-JSON normalizer record
 * (volume/strength/m3/EAN, design D2/D4), the measured predicate
 * imprecision riding the guarded path, the polite walk, and collected-
 * never-thrown failures.
 *
 * @module LmdwAdapterTest
 */
import { describe, it, expect } from 'vitest';
import { LmdwFeedAdapter, LMDW_PRODUCT_URL_PATTERN } from '../adapters/lmdw.adapter';
import {
  MIN_REQUEST_SPACING_MS,
  type PageFetcher,
} from '../crawl/crawl-walker';
import {
  LMDW_PRODUCT_HTML,
  LMDW_PRODUCT_URL,
} from '../crawl/extract/__fixtures__/lmdw-product.fixture';

const SITEMAP_URL = 'https://www.whisky.fr/media/sitemap/sitemap_whimag.xml';
const B = 'https://www.whisky.fr/lagavulin-16-ans.html';
// The measured predicate imprecision (~1.6 %): CMS routes share the
// single-segment `<url_key>.html` shape and ride the guarded path.
const CMS = 'https://www.whisky.fr/nature-de-produit.html';
const EN = 'https://www.whisky.fr/en/ardbeg-uigeadail.html';
const IMAGE = 'https://www.whisky.fr/media/catalog/product/a/r/ardbeg.jpg';

const SITEMAP_XML = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${LMDW_PRODUCT_URL}</loc><lastmod>2026-10-06</lastmod></url>
  <url><loc>${B}</loc><lastmod>2026-10-05</lastmod></url>
  <url><loc>${EN}</loc><lastmod>2026-10-03</lastmod></url>
  <url><loc>${IMAGE}</loc></url>
</urlset>`;

// The measured ~1.6 % predicate imprecision in the urlset: a CMS route
// sharing the single-segment `<url_key>.html` product shape.
const SITEMAP_XML_WITH_CMS = SITEMAP_XML.replace(
  '</urlset>',
  `  <url><loc>${CMS}</loc><lastmod>2026-10-04</lastmod></url>
</urlset>`,
);

// The EAN-less world (measured ~26.7 % of pages): identical page minus
// the JSON-LD gtin13 — the record stays EAN-less with no error line.
const EAN_LESS_HTML = LMDW_PRODUCT_HTML.replace(
  '    "gtin13": "5000277000982",\n',
  '',
);
// The CMS shape: structured name+price, no state JSON, untypable name.
const CMS_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Nature de produit",
    "offers": { "@type": "Offer", "price": "0.00", "priceCurrency": "EUR" }
  }
  </script>
</head>
<body></body>
</html>`;

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
    const spec: PageSpec = pageSpecs[url] ?? { body: LMDW_PRODUCT_HTML };
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

describe('LmdwFeedAdapter', () => {
  it('spec: state-JSON ABV/volume, m3 category, attested EAN, EUR minor units, no deposit', async () => {
    const fetched: string[] = [];
    const fetcher = stubFetch(
      {
        [SITEMAP_URL]: { body: SITEMAP_XML },
        [B]: { body: EAN_LESS_HTML },
      },
      fetched,
    );
    const adapter = new LmdwFeedAdapter({ fetcher, sleep: async () => {} });

    const { records, errors } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(errors).toEqual([]);
    expect(adapter.merchantId).toBe('lmdw');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      productId: '1000425',
      productName: 'Ardbeg Uigeadail',
      brand: 'Ardbeg',
      category: 'spirits',
      alcoholByVolume: 0.4,
      volumeMl: 700,
      depositSystem: false,
      ean: '5000277000982',
      priceCents: 5890,
      currency: 'EUR',
      availability: 'in_stock',
      sourceUrl: LMDW_PRODUCT_URL,
    });
    expect(records[1]).toMatchObject({
      ean: null,
      reviewHoldReason: null,
      sourceUrl: B,
    });
  });

  it('pure-sitemap predicate: single-segment .html only; EN store, deep CMS, and image locs never fetched', () => {
    expect(LMDW_PRODUCT_URL_PATTERN.test(LMDW_PRODUCT_URL)).toBe(true);
    expect(LMDW_PRODUCT_URL_PATTERN.test(EN)).toBe(false);
    expect(LMDW_PRODUCT_URL_PATTERN.test(IMAGE)).toBe(false);
    expect(
      LMDW_PRODUCT_URL_PATTERN.test('https://www.whisky.fr/medias/guide.html'),
    ).toBe(false);
  });

  it('predicate-imprecise CMS locs ride the guarded path: ESTIMATED + correction, no record', async () => {
    const fetched: string[] = [];
    const sleeps: number[] = [];
    const fetcher = stubFetch(
      {
        [SITEMAP_URL]: { body: SITEMAP_XML_WITH_CMS },
        [CMS]: { body: CMS_HTML },
        [B]: { body: EAN_LESS_HTML },
      },
      fetched,
    );
    const adapter = new LmdwFeedAdapter({
      fetcher,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const { records, errors } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(fetched.slice(1)).toEqual([LMDW_PRODUCT_URL, B, CMS]);
    // spacing sits between consecutive requests: pages-1 waits
    expect(sleeps).toEqual([MIN_REQUEST_SPACING_MS, MIN_REQUEST_SPACING_MS]);
    expect(records).toHaveLength(2);
    // The CMS page's three correction lines: strength ESTIMATED,
    // volume ESTIMATED, no canonical category (named per row).
    expect(errors).toHaveLength(3);
    expect(errors[2]).toContain('nature-de-produit');
    expect(errors[2]).toContain('no canonical beverage category');
  });

  it('spec: page failures are collected, never thrown', async () => {
    const fetched: string[] = [];
    const fetcher = stubFetch(
      {
        [SITEMAP_URL]: { body: SITEMAP_XML },
        [LMDW_PRODUCT_URL]: { fail: true },
        [B]: { status: 500, statusText: 'Internal Server Error' },
      },
      fetched,
    );
    const adapter = new LmdwFeedAdapter({ fetcher, sleep: async () => {} });

    const { records, errors } = await adapter.fetch({
      feedUrl: SITEMAP_URL,
      feedFormat: 'xml',
    });

    expect(records).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain(`${LMDW_PRODUCT_URL} fetch failed`);
    expect(errors[1]).toContain(`${B} returned HTTP 500`);
  });
});
