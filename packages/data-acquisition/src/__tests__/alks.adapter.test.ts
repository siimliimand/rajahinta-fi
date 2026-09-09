/**
 * alks.fi feed adapter tests (task 1.2, change alks-feed-and-import-vat;
 * designs D1/D2/D3/D7).
 *
 * Pins the pagination contract against a stubbed Store API: sequential
 * `per_page=100` walk bounded by `X-WP-TotalPages`, page-level failures
 * collected instead of thrown (one bad page costs one page, not the
 * run), and the parser's per-row discipline passing through untouched —
 * including the ESTIMATED encoding (null ABV / 0 ml) and the feed
 * weight, which must reach the mapping layer unharmed.
 *
 * @module AlksFeedAdapterTest
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AlksFeedAdapter } from '../adapters/alks.adapter';
import {
  ALKS_GOLDEN_PAYLOAD,
  ALKS_GOLDEN_PRODUCTS,
} from '../adapters/__fixtures__/alks-store-products.fixture';

const CONFIG = {
  feedUrl: 'https://alks.fi',
  feedFormat: 'json' as const,
};

const COLLECTION_URL = 'https://alks.fi/wp-json/wc/store/v1/products';

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
    id: 700000 + globalIndex,
    name: 'Bulk Beer 5% 0,33 l',
    sku: `de-${String(4000000000000 + globalIndex)}`,
    permalink: `https://alks.fi/product/bulk-${globalIndex}/`,
    prices: { price: '449', currency_code: 'EUR' },
    categories: [{ name: 'Olut' }],
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
// Sequential pagination (design D2)
// ---------------------------------------------------------------------------

describe('AlksFeedAdapter — sequential pagination (design D2)', () => {
  it('spec: 2,856 products → 29 pages requested in order, union returned', async () => {
    const { fetchMock, calls } = stubStoreApi(fullCatalogPages(2856), {
      totalPages: '29',
    });
    const adapter = new AlksFeedAdapter();

    expect(adapter.merchantId).toBe('alks');

    const { records, errors } = await adapter.fetch(CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(29);
    for (let page = 1; page <= 29; page++) {
      expect(calls[page - 1]).toBe(
        `${COLLECTION_URL}?per_page=100&page=${page}`,
      );
    }
    expect(records).toHaveLength(2856);
    expect(errors).toEqual([]);
    expect(records[0]).toMatchObject({ ean: '4000000000000', priceCents: 449 });
    expect(records[2855]).toMatchObject({ ean: '4000000002855' });
  });

  it('spec: page 12 HTTP 500 — error appended, pages 13+ still fetched, successful pages returned', async () => {
    const specs = fullCatalogPages(1300);
    specs[12] = { status: 500, statusText: 'Internal Server Error' };
    const { calls } = stubStoreApi(specs, { totalPages: '13' });

    const { records, errors } = await new AlksFeedAdapter().fetch(CONFIG);

    expect(calls).toHaveLength(13);
    expect(calls[12]).toBe(`${COLLECTION_URL}?per_page=100&page=13`);
    // 1,200 rows from the successful pages — the failed page's 100 are
    // the only ones lost.
    expect(records).toHaveLength(1200);
    expect(errors).toEqual([
      expect.stringContaining('page 12'),
    ]);
    expect(errors[0]).toContain('HTTP 500');
  });

  it('missing X-WP-TotalPages stops after the current page with an error', async () => {
    const { calls } = stubStoreApi({
      1: { totalPages: null, payload: [storeRow(1), storeRow(2)] },
    });

    const { records, errors } = await new AlksFeedAdapter().fetch(CONFIG);

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

    const { records, errors } = await new AlksFeedAdapter().fetch(CONFIG);

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

    const { records, errors } = await new AlksFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(2); // pages 1 and 3
    expect(errors).toEqual([
      expect.stringContaining('page 2 fetch failed: connection reset'),
    ]);
  });

  it('invalid JSON on a page is a collected error; earlier pages still count', async () => {
    stubStoreApi(
      { 2: { jsonError: new Error('Unexpected token < in JSON') } },
      { totalPages: '2', payload: [storeRow(0)] },
    );

    const { records, errors } = await new AlksFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(errors).toEqual([
      expect.stringContaining('page 2 returned invalid JSON'),
    ]);
  });

  it('a non-array page payload is the parser payload-level error, still not a throw', async () => {
    stubStoreApi(
      { 2: { payload: { error: 'rest_no_route' } } },
      { totalPages: '2', payload: [storeRow(0)] },
    );

    const { records, errors } = await new AlksFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(errors).toEqual([
      expect.stringContaining('not a JSON array'),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Per-row correction errors and the ESTIMATED path (designs D1/D3/D7)
// ---------------------------------------------------------------------------

describe('AlksFeedAdapter — per-row errors, ESTIMATED encoding, feed weight', () => {
  it('passes the golden payload through the parser unchanged', async () => {
    stubStoreApi({ 1: { payload: ALKS_GOLDEN_PAYLOAD } });

    const { records, errors } = await new AlksFeedAdapter().fetch(CONFIG);

    // 4 records (contradiction row dropped by the parser) + 2 per-row
    // correction errors (non-matching SKU, contradiction).
    expect(records).toHaveLength(4);
    expect(errors).toHaveLength(2);
    expect(records[0]).toMatchObject({
      ean: '4740077005916',
      weightGrams: 530,
      priceCents: 699,
    });
  });

  it('spec: non-matching SKU keeps the record without an EAN and names the SKU', async () => {
    stubStoreApi({ 1: { payload: [ALKS_GOLDEN_PRODUCTS[2]] } });

    const { records, errors } = await new AlksFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('promo-123');
  });

  it('spec: parse failure keeps the product — null ABV / 0 ml flow through for the ESTIMATED offer', async () => {
    stubStoreApi({ 1: { payload: [ALKS_GOLDEN_PRODUCTS[3]] } });

    const { records, errors } = await new AlksFeedAdapter().fetch(CONFIG);

    // No record dropped for the parse failure, no error either — the
    // ESTIMATED encoding (null ABV / 0 ml) IS the resolved outcome.
    expect(records).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(records[0].alcoholByVolume).toBeNull();
    expect(records[0].volumeMl).toBe(0);
  });

  it('feed weight passes through: 0.53 kg → 530 g, absent → null', async () => {
    stubStoreApi({
      1: {
        payload: [ALKS_GOLDEN_PRODUCTS[0], ALKS_GOLDEN_PRODUCTS[1]],
      },
    });

    const { records, errors } = await new AlksFeedAdapter().fetch(CONFIG);

    expect(errors).toEqual([]);
    expect(records[0].weightGrams).toBe(530);
    expect(records[1].weightGrams).toBeNull();
  });
});
