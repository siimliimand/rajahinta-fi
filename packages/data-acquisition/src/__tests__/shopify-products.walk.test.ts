/**
 * Shared Shopify products.json walk tests (task 2.1, change
 * onboard-shopify-lmdw-merchants).
 *
 * Pins the golden walk of design D1 through a test-local subclass (the
 * per-merchant parsers arrive in tasks 3.1/3.2): sequential pages at
 * `limit=250` in order, short-page termination standing in for the
 * absent `X-WP-TotalPages` header (an empty first page is an empty
 * catalog, an empty later page the normal end — neither an error), and
 * page-level failures collected instead of thrown per design D7 — a
 * 429 page costs its page, not the run, and later pages still count.
 * Also pins the never-unbounded guarantee: consecutive failed pages
 * stop the walk, the short-page bound's analogue of the Woo walk's
 * header cap.
 *
 * @module ShopifyProductsWalkTest
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ShopifyProductsFeedAdapter,
  type ShopifyWalkOptions,
} from '../adapters/shopify-products.walk';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';

const CONFIG = {
  feedUrl: 'https://bottleofitaly.example',
  feedFormat: 'json' as const,
};

const PRODUCTS_URL = 'https://bottleofitaly.example/products.json';

const LABEL = 'shopify-walk-test';

// ---------------------------------------------------------------------------
// products.json stub — one spec per page, defaults for the rest of the walk
// ---------------------------------------------------------------------------

interface PageSpec {
  status?: number;
  statusText?: string;
  payload?: unknown;
  jsonError?: Error;
  networkError?: Error;
}

function stubShopifyApi(
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
      // Shopify products.json has no total-pages header — the absence
      // the walk's short-page bound replaces (design D1 divergence).
      headers: { get: (): string | null => null },
      json: async () => {
        if (spec.jsonError) throw spec.jsonError;
        return spec.payload ?? { products: [] };
      },
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

/** A minimal products.json row; the hook maps its id/title through. */
function shopifyRow(globalIndex: number): Record<string, unknown> {
  return {
    id: 9_000_000 + globalIndex,
    title: `Test Whisky ${globalIndex}`,
    product_type: 'Spirits',
    vendor: 'Test Vendor',
    variants: [{ grams: 1000, available: true }],
  };
}

function productPage(start: number, count: number): PageSpec {
  return {
    payload: {
      products: Array.from({ length: count }, (_, i) => shopifyRow(start + i)),
    },
  };
}

function fullCatalogPages(totalProducts: number): Record<number, PageSpec> {
  const pages: Record<number, PageSpec> = {};
  const totalPages = Math.ceil(totalProducts / 250);
  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * 250;
    pages[page] = productPage(
      start,
      Math.min(250, totalProducts - start),
    );
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Test-local subclass — stands in for the task 3.1/3.2 merchant adapters
// ---------------------------------------------------------------------------

function toRecord(row: Record<string, unknown>): RawFeedRecord {
  return {
    productId: String(row.id),
    productName: String(row.title),
    manufacturer: 'Test Manufacturer',
    brand: String(row.vendor),
    category: 'spirits',
    alcoholByVolume: null,
    volumeMl: 700,
    containerType: 'bottle',
    regulatoryClassification: 'spirits',
    depositSystem: false,
    ean: null,
    priceCents: 1990,
    currency: 'EUR',
    originalPriceCents: 1990,
    originalCurrency: 'EUR',
    availability: 'in_stock',
    sourceUrl: null,
  };
}

class TestShopifyWalkAdapter extends ShopifyProductsFeedAdapter {
  readonly merchantId = LABEL;

  constructor(options: ShopifyWalkOptions = { errorLabelPrefix: LABEL }) {
    super(options);
  }

  protected parseProducts(
    rows: readonly unknown[],
  ): { records: RawFeedRecord[]; errors: string[] } {
    return {
      records: rows.map((row) => toRecord(row as Record<string, unknown>)),
      errors: [],
    };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Sequential pagination, short-page termination (design D1)
// ---------------------------------------------------------------------------

describe('ShopifyProductsFeedAdapter — sequential short-page walk (design D1)', () => {
  it('spec: 620 products → 3 pages requested in order at limit=250, raw rows mapped in page order', async () => {
    const { fetchMock, calls } = stubShopifyApi(fullCatalogPages(620));
    const adapter = new TestShopifyWalkAdapter();

    expect(adapter.merchantId).toBe(LABEL);

    const { records, errors } = await adapter.fetch(CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (let page = 1; page <= 3; page++) {
      expect(calls[page - 1]).toBe(`${PRODUCTS_URL}?limit=250&page=${page}`);
    }
    expect(records).toHaveLength(620);
    expect(errors).toEqual([]);
    // Raw rows passed through the hook in page order, untransformed.
    expect(records[0]).toMatchObject({ productId: '9000000', productName: 'Test Whisky 0' });
    expect(records[249]).toMatchObject({ productId: '9000249' });
    expect(records[250]).toMatchObject({ productId: '9000250', productName: 'Test Whisky 250' });
    expect(records[619]).toMatchObject({ productId: '9000619' });
  });

  it('a trailing slash on feedUrl does not double the path separator', async () => {
    const { calls } = stubShopifyApi({ 1: productPage(0, 0) });

    await new TestShopifyWalkAdapter().fetch({
      feedUrl: 'https://bottleofitaly.example/',
      feedFormat: 'json',
    });

    expect(calls).toEqual([`${PRODUCTS_URL}?limit=250&page=1`]);
  });

  it('spec: an empty first page is a normal empty catalog — 0 records, no errors, one request', async () => {
    const { fetchMock, calls } = stubShopifyApi({ 1: productPage(0, 0) });

    const { records, errors } = await new TestShopifyWalkAdapter().fetch(CONFIG);

    expect(calls).toEqual([`${PRODUCTS_URL}?limit=250&page=1`]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(records).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('a short page after full pages is the last page — nothing is fetched past it', async () => {
    const pages = fullCatalogPages(780); // 250 + 250 + 250 + 30
    const { fetchMock, calls } = stubShopifyApi(pages);

    const { records, errors } = await new TestShopifyWalkAdapter().fetch(CONFIG);

    expect(calls).toHaveLength(4);
    expect(calls[3]).toBe(`${PRODUCTS_URL}?limit=250&page=4`);
    expect(fetchMock).toHaveBeenCalledTimes(4); // no page 5 request
    expect(records).toHaveLength(780);
    expect(errors).toEqual([]);
  });

  it('spec: an empty page after non-empty pages is a normal end, not an error', async () => {
    stubShopifyApi({
      1: productPage(0, 250),
      2: productPage(250, 0),
    });

    const { records, errors } = await new TestShopifyWalkAdapter().fetch(CONFIG);

    expect(records).toHaveLength(250);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Page failures collected, never thrown (design D7)
// ---------------------------------------------------------------------------

describe('ShopifyProductsFeedAdapter — page failures collected, never thrown (design D7)', () => {
  it('spec: a 429 page is a collected failure; later pages are still fetched and count', async () => {
    stubShopifyApi({
      1: productPage(0, 250),
      2: { status: 429, statusText: 'Too Many Requests' },
      3: productPage(250, 250),
      4: productPage(500, 40),
    });

    const { records, errors } = await new TestShopifyWalkAdapter().fetch(CONFIG);

    // Pages 1, 3, 4 collected — the throttled page is the only loss.
    expect(records).toHaveLength(540);
    expect(errors).toEqual([
      `${LABEL} page 2 returned HTTP 429: Too Many Requests`,
    ]);
  });

  it('a network failure on a page does not abort the walk', async () => {
    stubShopifyApi({
      1: productPage(0, 250),
      2: { networkError: new Error('connection reset') },
      3: productPage(250, 100),
    });

    const { records, errors } = await new TestShopifyWalkAdapter().fetch(CONFIG);

    expect(records).toHaveLength(350); // pages 1 and 3
    expect(errors).toEqual([
      `${LABEL} page 2 fetch failed: connection reset`,
    ]);
  });

  it('invalid JSON on a page is a collected error; earlier and later pages still count', async () => {
    stubShopifyApi({
      1: productPage(0, 250),
      2: { jsonError: new Error('Unexpected token < in JSON') },
      3: productPage(250, 10),
    });

    const { records, errors } = await new TestShopifyWalkAdapter().fetch(CONFIG);

    expect(records).toHaveLength(260);
    expect(errors).toEqual([
      `${LABEL} page 2 returned invalid JSON: Unexpected token < in JSON`,
    ]);
  });

  it('a payload without a products array is a collected envelope error; the walk continues', async () => {
    stubShopifyApi({
      1: productPage(0, 250),
      2: { payload: { error: 'throttled' } },
      3: productPage(250, 10),
    });

    const { records, errors } = await new TestShopifyWalkAdapter().fetch(CONFIG);

    expect(records).toHaveLength(260);
    expect(errors).toEqual([
      `${LABEL} page 2 returned an invalid products.json envelope (no products array)`,
    ]);
  });

  it('consecutive failed pages stop the walk — never an unbounded loop', async () => {
    const { fetchMock, calls } = stubShopifyApi({
      1: productPage(0, 250),
      2: { status: 429, statusText: 'Too Many Requests' },
      3: { status: 500, statusText: 'Internal Server Error' },
      4: { networkError: new Error('connection reset') },
    });

    const { records, errors } = await new TestShopifyWalkAdapter().fetch(CONFIG);

    // Three consecutive failures exhaust the bound: page 5 is never
    // requested, and the successful first page is still returned.
    expect(calls).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(records).toHaveLength(250);
    expect(errors).toEqual([
      `${LABEL} page 2 returned HTTP 429: Too Many Requests`,
      `${LABEL} page 3 returned HTTP 500: Internal Server Error`,
      `${LABEL} page 4 fetch failed: connection reset`,
    ]);
  });

  it('a success between failures resets the consecutive-failure bound', async () => {
    const { fetchMock, calls } = stubShopifyApi({
      1: productPage(0, 250),
      2: { status: 429, statusText: 'Too Many Requests' },
      3: productPage(250, 250),
      4: { status: 429, statusText: 'Too Many Requests' },
      5: productPage(500, 250),
      6: productPage(750, 250),
      7: productPage(1000, 25),
    });

    const { records, errors } = await new TestShopifyWalkAdapter().fetch(CONFIG);

    // 429 → success → 429 → success keeps the walk alive across 7 pages.
    expect(calls).toHaveLength(7);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(records).toHaveLength(1025);
    expect(errors).toEqual([
      `${LABEL} page 2 returned HTTP 429: Too Many Requests`,
      `${LABEL} page 4 returned HTTP 429: Too Many Requests`,
    ]);
  });
});
