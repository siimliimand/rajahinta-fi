/**
 * kippis.net feed adapter tests (task 2.2, change
 * onboard-kippis-merchant).
 *
 * Pins the shared walk through the kippis subclass against a stubbed
 * Store API — the same sequential `per_page=100`, `X-WP-TotalPages`-
 * bounded discipline the alks/longero suites pin (7 pages for the
 * sweep's 677 products, page-level failures collected instead of
 * thrown) — plus the kippis sweep reality: numeric unprefixed SKUs in
 * all three accepted/rejected shapes, sale prices flowing through from
 * `prices.price`, the 13 Finnish department terms mapped by task 1.2,
 * the multipack case-price row, and the correction rows (suffixed,
 * internal code, 12-digit) kept EAN-less with an error each.
 *
 * @module KippisFeedAdapterTest
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { KippisFeedAdapter } from '../adapters/kippis.adapter';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';
import {
  KIPPIS_GOLDEN_PAYLOAD,
  KIPPIS_GOLDEN_PRODUCTS,
} from '../adapters/__fixtures__/kippis-store-products.fixture';

const CONFIG = {
  feedUrl: 'https://www.kippis.net',
  feedFormat: 'json' as const,
};

const COLLECTION_URL = 'https://www.kippis.net/wp-json/wc/store/v1/products';

// ---------------------------------------------------------------------------
// Store API stub — one spec per page, defaults for the rest of the walk
// ---------------------------------------------------------------------------

interface PageSpec {
  status?: number;
  statusText?: string;
  /** Raw header value; null → header absent. Default '1'. */
  totalPages?: string | null;
  payload?: unknown;
  jsonError?: Error;
  networkError?: Error;
}

function stubStoreApi(
  pageSpecs: Record<number, PageSpec>,
  defaultSpec: PageSpec = {},
): { fetchMock: ReturnType<typeof vi.fn>; calls: string[] } {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    const page = Number.parseInt(
      new URL(url).searchParams.get('page') ?? '1',
      10,
    );
    const spec: PageSpec = { ...defaultSpec, ...pageSpecs[page] };
    if (spec.networkError) throw spec.networkError;
    const status = spec.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: spec.statusText ?? 'OK',
      headers: {
        get: (name: string): string | null => {
          if (name.toLowerCase() !== 'x-wp-totalpages') return null;
          return spec.totalPages !== undefined ? spec.totalPages : '1';
        },
      },
      json: async () => {
        if (spec.jsonError) throw spec.jsonError;
        return spec.payload ?? [];
      },
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

/** A minimal valid Store API row; every generated row parses cleanly. */
function storeRow(globalIndex: number): Record<string, unknown> {
  return {
    id: 300000 + globalIndex,
    name: 'Bulk Long Drink 5,5% 0,33 l',
    sku: String(6410000000000 + globalIndex),
    permalink: `https://www.kippis.net/product/bulk-${globalIndex}/`,
    prices: { price: '199', currency_code: 'EUR' },
    categories: [{ name: 'Siiderit lonkerot ja seltzerit' }],
    is_in_stock: true,
  };
}

function fullCatalogPages(totalProducts: number): Record<number, PageSpec> {
  const pages: Record<number, PageSpec> = {};
  const totalPages = Math.ceil(totalProducts / 100);
  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * 100;
    pages[page] = {
      payload: Array.from(
        { length: Math.min(100, totalProducts - start) },
        (_, i) => storeRow(start + i),
      ),
    };
  }
  return pages;
}

function recordByName(
  records: readonly RawFeedRecord[],
  name: string,
): RawFeedRecord {
  const found = records.find((record) => record.productName === name);
  expect(found, `expected a record named "${name}"`).toBeDefined();
  return found as RawFeedRecord;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Sequential pagination (shared walk, kippis subclass)
// ---------------------------------------------------------------------------

describe('KippisFeedAdapter — sequential pagination (design D2)', () => {
  it('spec: sweep shape, 677 products → 7 pages requested in order, union returned', async () => {
    const { fetchMock, calls } = stubStoreApi(fullCatalogPages(677), {
      totalPages: '7',
    });
    const adapter = new KippisFeedAdapter();

    expect(adapter.merchantId).toBe('kippis');

    const { records, errors } = await adapter.fetch(CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(7);
    for (let page = 1; page <= 7; page++) {
      expect(calls[page - 1]).toBe(
        `${COLLECTION_URL}?per_page=100&page=${page}`,
      );
    }
    expect(records).toHaveLength(677);
    expect(errors).toEqual([]);
    expect(records[0]).toMatchObject({ ean: '6410000000000', priceCents: 199 });
    expect(records[676]).toMatchObject({ ean: '6410000000676' });
  });

  it('a trailing slash on feedUrl does not double the path separator', async () => {
    const { calls } = stubStoreApi({ 1: { payload: [] } });

    await new KippisFeedAdapter().fetch({
      feedUrl: 'https://www.kippis.net/',
      feedFormat: 'json',
    });

    expect(calls).toEqual([`${COLLECTION_URL}?per_page=100&page=1`]);
  });

  it('spec: page 3 HTTP 500 — error appended, pages 4+ still fetched, successful pages returned', async () => {
    const specs = fullCatalogPages(500);
    specs[3] = { status: 500, statusText: 'Internal Server Error' };
    const { calls } = stubStoreApi(specs, { totalPages: '5' });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(calls).toHaveLength(5);
    expect(calls[3]).toBe(`${COLLECTION_URL}?per_page=100&page=4`);
    // 400 rows from the successful pages — the failed page's 100 are
    // the only ones lost.
    expect(records).toHaveLength(400);
    expect(errors).toEqual([
      expect.stringContaining('kippis page 3'),
    ]);
    expect(errors[0]).toContain('HTTP 500');
  });

  it('missing X-WP-TotalPages stops after the current page with an error', async () => {
    const { calls } = stubStoreApi({
      1: { totalPages: null, payload: [storeRow(1), storeRow(2)] },
    });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(calls).toHaveLength(1);
    expect(records).toHaveLength(2);
    expect(errors).toEqual([
      expect.stringContaining('no usable X-WP-TotalPages header (missing)'),
    ]);
  });

  it('malformed X-WP-TotalPages stops after the current page with an error', async () => {
    const { calls } = stubStoreApi(
      { 1: { payload: [storeRow(1)] } },
      { totalPages: 'not-a-number' },
    );

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(calls).toHaveLength(1);
    expect(records).toHaveLength(1);
    expect(errors).toEqual([
      expect.stringContaining('no usable X-WP-TotalPages header ("not-a-number")'),
    ]);
  });

  it('a network failure on a bound page does not abort the walk', async () => {
    stubStoreApi(
      { 2: { networkError: new Error('connection reset') } },
      { totalPages: '3', payload: [storeRow(0)] },
    );

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(2); // pages 1 and 3
    expect(errors).toEqual([
      expect.stringContaining('kippis page 2 fetch failed: connection reset'),
    ]);
  });

  it('invalid JSON on a page is a collected error; earlier pages still count', async () => {
    stubStoreApi(
      { 2: { jsonError: new Error('Unexpected token < in JSON') } },
      { totalPages: '2', payload: [storeRow(0)] },
    );

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(errors).toEqual([
      expect.stringContaining('kippis page 2 returned invalid JSON'),
    ]);
  });

  it('a non-array page payload is the parser payload-level error, still not a throw', async () => {
    stubStoreApi(
      { 2: { payload: { error: 'rest_no_route' } } },
      { totalPages: '2', payload: [storeRow(0)] },
    );

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(errors).toEqual([
      expect.stringContaining('not a JSON array'),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Kippis sweep reality — SKU shapes, sale prices, Finnish categories,
// correction rows (through the reused alks parser)
// ---------------------------------------------------------------------------

describe('KippisFeedAdapter — SKU/EAN shapes (design D2)', () => {
  it('bare 13-digit SKU yields its EAN; GTIN-14 yields the leading-zero-stripped EAN', async () => {
    stubStoreApi({
      1: {
        payload: [KIPPIS_GOLDEN_PRODUCTS[0], KIPPIS_GOLDEN_PRODUCTS[1]],
      },
    });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(errors).toEqual([]);
    expect(records).toHaveLength(2);
    // `6410405217457` (bare EAN-13) → itself.
    expect(records[0].productId).toBe('6410405217457');
    expect(records[0].ean).toBe('6410405217457');
    // `06412700071701` (GTIN-14) → `6412700071701`.
    expect(records[1].productId).toBe('06412700071701');
    expect(records[1].ean).toBe('6412700071701');
  });

  it('spec: suffixed EAN variant keeps the record without an EAN and names the SKU', async () => {
    stubStoreApi({ 1: { payload: [KIPPIS_GOLDEN_PRODUCTS[7]] } });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('4740019769500/3');
  });

  it('spec: internal code SKU keeps the record without an EAN and names the SKU', async () => {
    stubStoreApi({ 1: { payload: [KIPPIS_GOLDEN_PRODUCTS[10]] } });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('1038480');
  });

  it('spec: 12-digit numeric SKU keeps the record without an EAN and names the SKU', async () => {
    stubStoreApi({ 1: { payload: [KIPPIS_GOLDEN_PRODUCTS[13]] } });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('641977500123');
  });

  it('spec: an empty SKU keeps the record EAN-less silently — no correction error', async () => {
    stubStoreApi({ 1: { payload: [KIPPIS_GOLDEN_PRODUCTS[15]] } });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].ean).toBeNull();
    expect(errors).toEqual([]);
  });
});

describe('KippisFeedAdapter — sale prices and the multipack case row', () => {
  it('spec: the sale price in prices.price flows through as the canonical cents', async () => {
    stubStoreApi({
      1: {
        payload: [KIPPIS_GOLDEN_PRODUCTS[0], KIPPIS_GOLDEN_PRODUCTS[2]],
      },
    });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(errors).toEqual([]);
    // Sale rows carry the effective price in `prices.price` — 10.99 €
    // and 14.99 € sale prices land as-is, EUR-native, no conversion.
    expect(records[0].priceCents).toBe(1099);
    expect(records[0].currency).toBe('EUR');
    expect(records[0].originalPriceCents).toBe(1099);
    expect(records[0].originalCurrency).toBe('EUR');
    expect(records[1].priceCents).toBe(1499);
  });

  it('spec: multipack case row — case price kept, per-container volume, tölkki → can', async () => {
    stubStoreApi({ 1: { payload: [KIPPIS_GOLDEN_PRODUCTS[10]] } });

    const { records } = await new KippisFeedAdapter().fetch(CONFIG);

    // The sweep's accepted skew: 30.99 € is the 24-can CASE price while
    // the name's `33cl` stays the per-container volume (documented, no
    // scope change — data-quality-pass input).
    expect(records[0].priceCents).toBe(3099);
    expect(records[0].volumeMl).toBe(330);
    expect(records[0].alcoholByVolume).toBeCloseTo(0.045, 10);
    expect(records[0].containerType).toBe('can');
  });
});

describe('KippisFeedAdapter — Finnish department mapping (task 1.2 keys)', () => {
  /**
   * The 13 sweep terms → the tax-rule category each must land in. The
   * parser carries only the tax key (`category` and
   * `regulatoryClassification` are the same value); the mapper's
   * intermediate canonical step (wine, sparkling-wine, spirits,
   * liqueur, fortified-wine, cider, non-alcoholic) is already pinned by
   * the core-domain mapper tests.
   */
  const DEPARTMENT_EXPECTATIONS = [
    { term: 'Valkoviinit', tax: 'wine_still' },
    { term: 'punaviinit', tax: 'wine_still' },
    { term: 'kuohuviinit', tax: 'wine_sparkling' },
    { term: 'Vodkat ja Viinat', tax: 'spirits' },
    { term: 'Viskit', tax: 'spirits' },
    { term: 'Konjakit', tax: 'spirits' },
    { term: 'Ginit', tax: 'spirits' },
    { term: 'rommit', tax: 'spirits' },
    { term: 'Liköörit', tax: 'spirits' },
    { term: 'Aperitiivit', tax: 'intermediate_products' },
    { term: 'Siiderit lonkerot ja seltzerit', tax: 'other_fermented' },
    { term: 'Virvoitusjuomat ja mikserit', tax: 'other_fermented' },
    { term: 'Energiajuomat', tax: 'other_fermented' },
  ] as const;

  it('spec: every golden row lands in the tax-rule category its department term maps to', async () => {
    stubStoreApi({ 1: { payload: KIPPIS_GOLDEN_PAYLOAD } });

    const { records } = await new KippisFeedAdapter().fetch(CONFIG);

    for (const { term, tax } of DEPARTMENT_EXPECTATIONS) {
      const rows = KIPPIS_GOLDEN_PRODUCTS.filter(
        (row) => row.categories[0]?.name === term,
      );
      expect(rows.length, `fixture rows for term "${term}"`).toBeGreaterThan(0);
      for (const row of rows) {
        const record = recordByName(records, row.name);
        expect(record.category, `${row.name} (${term})`).toBe(tax);
        expect(
          record.regulatoryClassification,
          `${row.name} (${term})`,
        ).toBe(tax);
      }
    }
  });

  it('spec: the Lahjakortti merchandising row drops with the correction error — no record', async () => {
    stubStoreApi({ 1: { payload: KIPPIS_GOLDEN_PAYLOAD } });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    // 15 records (16 fixture rows minus the dropped gift card) + 4
    // errors (3 SKU corrections + the drop).
    expect(records).toHaveLength(15);
    expect(errors).toHaveLength(4);
    expect(
      records.some((record) => record.productName === 'Lahjakortti 25 euroa'),
    ).toBe(false);
    expect(
      errors.some((error) => error.includes('no canonical beverage category')),
    ).toBe(true);
  });
});

describe('KippisFeedAdapter — availability, null-ABV rows, feed weight', () => {
  it('is_in_stock availability passes through: true → in_stock, false → out_of_stock', async () => {
    stubStoreApi({
      1: {
        payload: [KIPPIS_GOLDEN_PRODUCTS[0], KIPPIS_GOLDEN_PRODUCTS[11]],
      },
    });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(errors).toEqual([]);
    expect(records[0].availability).toBe('in_stock');
    expect(records[1].availability).toBe('out_of_stock');
  });

  it('spec: mixer row without an ABV token keeps the record with null ABV (design D3)', async () => {
    stubStoreApi({
      1: {
        payload: [KIPPIS_GOLDEN_PRODUCTS[11], KIPPIS_GOLDEN_PRODUCTS[12]],
      },
    });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(errors).toEqual([]);
    expect(records).toHaveLength(2);
    expect(records[0].alcoholByVolume).toBeNull();
    expect(records[0].volumeMl).toBe(330);
    expect(records[1].alcoholByVolume).toBeNull();
    expect(records[1].volumeMl).toBe(500);
  });

  it('feed weight passes through: 1.3 kg → 1300 g, absent → null', async () => {
    stubStoreApi({
      1: {
        payload: [KIPPIS_GOLDEN_PRODUCTS[0], KIPPIS_GOLDEN_PRODUCTS[1]],
      },
    });

    const { records, errors } = await new KippisFeedAdapter().fetch(CONFIG);

    expect(errors).toEqual([]);
    expect(records[0].weightGrams).toBe(1300);
    expect(records[1].weightGrams).toBe(1400);
  });
});
