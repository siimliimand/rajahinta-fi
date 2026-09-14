/**
 * longero.fi feed adapter tests (task 2.1, change
 * onboard-longero-merchant).
 *
 * Mirrors the alks adapter tests against a stubbed Store API: the walk
 * is sequential at `per_page=100`, bounded by the first usable
 * `X-WP-TotalPages` header, a missing/malformed header stops after the
 * current page, page-level failures are collected instead of thrown
 * (one bad page costs one page, not the run), and the reused parser's
 * per-row discipline passes through untouched — including the
 * longero sweep reality of non-EAN SKU shapes kept EAN-less and the
 * ESTIMATED encoding (null ABV / 0 ml).
 *
 * @module LongeroFeedAdapterTest
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { LongeroFeedAdapter } from '../adapters/longero.adapter';
import {
  LONGERO_GOLDEN_PAYLOAD,
  LONGERO_GOLDEN_PRODUCTS,
} from '../adapters/__fixtures__/longero-store-products.fixture';

const CONFIG = {
  feedUrl: 'https://longero.fi',
  feedFormat: 'json' as const,
};

const COLLECTION_URL = 'https://longero.fi/wp-json/wc/store/v1/products';

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
    id: 120000 + globalIndex,
    name: 'Bulk Long Drink 5,5% 0,33 l',
    sku: `ee-${String(4740000000000 + globalIndex)}`,
    permalink: `https://longero.fi/product/bulk-${globalIndex}/`,
    prices: { price: '199', currency_code: 'EUR' },
    categories: [{ name: 'Juomasekoitus' }],
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

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Sequential pagination (alks design D2, mirrored)
// ---------------------------------------------------------------------------

describe('LongeroFeedAdapter — sequential pagination (design D2)', () => {
  it('merchantId is longero and the collection URL derives from feedUrl', () => {
    const adapter = new LongeroFeedAdapter();

    expect(adapter.merchantId).toBe('longero');
  });

  it('spec: 994 products → 10 pages requested in order, union returned', async () => {
    const { fetchMock, calls } = stubStoreApi(fullCatalogPages(994), {
      totalPages: '10',
    });
    const adapter = new LongeroFeedAdapter();

    const { records, errors } = await adapter.fetch(CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(10);
    for (let page = 1; page <= 10; page++) {
      expect(calls[page - 1]).toBe(
        `${COLLECTION_URL}?per_page=100&page=${page}`,
      );
    }
    expect(records).toHaveLength(994);
    expect(errors).toEqual([]);
    expect(records[0]).toMatchObject({ ean: '4740000000000', priceCents: 199 });
    expect(records[993]).toMatchObject({ ean: '4740000000993' });
  });

  it('a trailing slash on feedUrl does not double the path separator', async () => {
    const { calls } = stubStoreApi({ 1: { payload: [] } });

    await new LongeroFeedAdapter().fetch({
      feedUrl: 'https://longero.fi/',
      feedFormat: 'json',
    });

    expect(calls).toEqual([`${COLLECTION_URL}?per_page=100&page=1`]);
  });

  it('spec: page 3 HTTP 500 — error appended, pages 4+ still fetched, successful pages returned', async () => {
    const specs = fullCatalogPages(500);
    specs[3] = { status: 500, statusText: 'Internal Server Error' };
    const { calls } = stubStoreApi(specs, { totalPages: '5' });

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

    expect(calls).toHaveLength(5);
    expect(calls[3]).toBe(`${COLLECTION_URL}?per_page=100&page=4`);
    // 400 rows from the successful pages — the failed page's 100 are
    // the only ones lost.
    expect(records).toHaveLength(400);
    expect(errors).toEqual([
      expect.stringContaining('longero page 3'),
    ]);
    expect(errors[0]).toContain('HTTP 500');
  });

  it('missing X-WP-TotalPages stops after the current page with an error', async () => {
    const { calls } = stubStoreApi({
      1: { totalPages: null, payload: [storeRow(1), storeRow(2)] },
    });

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

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

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

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

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(2); // pages 1 and 3
    expect(errors).toEqual([
      expect.stringContaining('longero page 2 fetch failed: connection reset'),
    ]);
  });

  it('invalid JSON on a page is a collected error; earlier pages still count', async () => {
    stubStoreApi(
      { 2: { jsonError: new Error('Unexpected token < in JSON') } },
      { totalPages: '2', payload: [storeRow(0)] },
    );

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(errors).toEqual([
      expect.stringContaining('longero page 2 returned invalid JSON'),
    ]);
  });

  it('a non-array page payload is the parser payload-level error, still not a throw', async () => {
    stubStoreApi(
      { 2: { payload: { error: 'rest_no_route' } } },
      { totalPages: '2', payload: [storeRow(0)] },
    );

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(errors).toEqual([
      expect.stringContaining('not a JSON array'),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Per-row correction errors and the ESTIMATED path (designs D1/D3/D7,
// through the reused alks parser)
// ---------------------------------------------------------------------------

describe('LongeroFeedAdapter — per-row errors, ESTIMATED encoding, feed weight', () => {
  it('passes the golden payload through the reused parser unchanged', async () => {
    stubStoreApi({ 1: { payload: LONGERO_GOLDEN_PAYLOAD } });

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

    // 5 records (contradiction row dropped by the parser) + 3 per-row
    // correction errors (V2- SKU, contradiction, 12-digit SKU).
    expect(records).toHaveLength(5);
    expect(errors).toHaveLength(3);
    expect(records[0]).toMatchObject({
      ean: '4740160012345',
      weightGrams: 1400,
      priceCents: 1599,
    });
  });

  it('spec: V2- prefixed SKU keeps the record without an EAN and names the SKU', async () => {
    stubStoreApi({ 1: { payload: [LONGERO_GOLDEN_PRODUCTS[2]] } });

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('V2-474016001234');
  });

  it('spec: 12-digit ee- SKU keeps the record without an EAN and names the SKU', async () => {
    stubStoreApi({ 1: { payload: [LONGERO_GOLDEN_PRODUCTS[5]] } });

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ee-474016001234');
  });

  it('spec: parse failure keeps the product — null ABV / 0 ml flow through for the ESTIMATED offer', async () => {
    stubStoreApi({ 1: { payload: [LONGERO_GOLDEN_PRODUCTS[3]] } });

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

    // No record dropped for the parse failure, no error either — the
    // ESTIMATED encoding (null ABV / 0 ml) IS the resolved outcome.
    expect(records).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(records[0].alcoholByVolume).toBeNull();
    expect(records[0].volumeMl).toBe(0);
  });

  it('is_in_stock availability passes through: true → in_stock, false → out_of_stock', async () => {
    stubStoreApi({
      1: {
        payload: [LONGERO_GOLDEN_PRODUCTS[0], LONGERO_GOLDEN_PRODUCTS[3]],
      },
    });

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

    expect(errors).toEqual([]);
    expect(records[0].availability).toBe('in_stock');
    expect(records[1].availability).toBe('out_of_stock');
  });

  it('feed weight passes through: 1.4 kg → 1400 g, absent → null', async () => {
    stubStoreApi({
      1: {
        payload: [LONGERO_GOLDEN_PRODUCTS[0], LONGERO_GOLDEN_PRODUCTS[1]],
      },
    });

    const { records, errors } = await new LongeroFeedAdapter().fetch(CONFIG);

    expect(errors).toEqual([]);
    expect(records[0].weightGrams).toBe(1400);
    expect(records[1].weightGrams).toBeNull();
  });
});
