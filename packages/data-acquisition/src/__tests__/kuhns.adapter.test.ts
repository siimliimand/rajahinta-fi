/**
 * kuhns.shop feed adapter tests (task 3.2, change
 * onboard-shopify-lmdw-merchants).
 *
 * Pins the shared walk through the kuhns subclass against a stubbed
 * products.json endpoint. The walk itself is pinned exhaustively by the
 * shopify-products.walk suite, so only the passthrough identity is
 * asserted here (merchantId, the products.json collection URL, the
 * `kuhns` error-label prefix) — no pagination duplication. The golden
 * kuhns fixture then pins the sweep reality end to end through the
 * subclass (designs D2/D3): the 93.7 % untyped majority classified by
 * title, the multipack and range-ABV paths, and the 100 % EAN-less
 * ML-SKU correction surface.
 *
 * @module KuhnsFeedAdapterTest
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { KuhnsFeedAdapter } from '../adapters/kuhns.adapter';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';
import {
  KUHNS_GOLDEN_PAYLOAD,
  KUHNS_GOLDEN_PRODUCTS,
} from '../adapters/__fixtures__/kuhns-products.fixture';

const CONFIG = {
  feedUrl: 'https://kuhns.shop',
  feedFormat: 'json' as const,
};

const PRODUCTS_URL = 'https://kuhns.shop/products.json';

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
        return { products: spec.payload ?? [] };
      },
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

/** A minimal products.json row; every generated row parses cleanly. */
function shopifyRow(globalIndex: number): Record<string, unknown> {
  return {
    id: 6_600_000 + globalIndex,
    title: `Test Whisky No. ${globalIndex} alc. 40 Vol.-% 0,7l`,
    handle: `test-whisky-${globalIndex}`,
    product_type: '',
    vendor: 'Kuhns Trinkgenuss',
    variants: [
      {
        id: 39_300_000 + globalIndex,
        sku: `ML${9000 + globalIndex}`,
        price: '19.90',
        grams: 1400,
        available: true,
      },
    ],
  };
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
// Subclass identity — the shared walk, kuhns knobs (design D1)
// ---------------------------------------------------------------------------

describe('KuhnsFeedAdapter — subclass identity (design D1)', () => {
  it('resolves as merchant "kuhns" over the products.json collection path', async () => {
    const { fetchMock, calls } = stubShopifyApi({ 1: { payload: [] } });
    const adapter = new KuhnsFeedAdapter();

    expect(adapter.merchantId).toBe('kuhns');

    const { records, errors } = await adapter.fetch(CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(`${PRODUCTS_URL}?limit=250&page=1`);
    expect(records).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('page-level walk errors carry the kuhns label; failed pages never abort the walk', async () => {
    // Page 1 must be FULL (250 rows) for the walk to reach page 2 — the
    // short-page bound ends the walk after any short page (design D1).
    stubShopifyApi({
      1: { payload: Array.from({ length: 250 }, (_, i) => shopifyRow(i)) },
      2: { status: 429, statusText: 'Too Many Requests' },
      3: { payload: [shopifyRow(250)] },
    });

    const { records, errors } = await new KuhnsFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(251); // pages 1 and 3
    // The 429 line precedes the hook's row errors (the walk's
    // error-precedence), and every ML-SKU row adds its EAN-less
    // correction — 251 rows, 252 lines total.
    expect(errors).toHaveLength(252);
    expect(errors[0]).toBe('kuhns page 2 returned HTTP 429: Too Many Requests');
    for (const error of errors.slice(1)) {
      expect(error).toContain('does not match any accepted');
    }
  });
});

// ---------------------------------------------------------------------------
// Sweep reality totals — the golden payload end to end
// ---------------------------------------------------------------------------

describe('KuhnsFeedAdapter — golden payload (sweep §1.2)', () => {
  it('spec: 8-row reality, distilled — 6 records kept, EAN-less + hold + drop corrections', async () => {
    stubShopifyApi({ 1: { payload: KUHNS_GOLDEN_PAYLOAD } });

    const { records, errors } = await new KuhnsFeedAdapter().fetch(CONFIG);

    // 6 records; 12 errors: the EAN-less SKU correction on all 8 rows,
    // the two hygiene holds (keyed-zero Sekt, range-ABV Bier), the
    // product_type-vs-title contradiction, and the unmapped merch drop.
    expect(records).toHaveLength(6);
    expect(errors).toHaveLength(12);
    for (const record of records) {
      expect(record.ean).toBeNull();
    }
  });

  it('spec: the untyped majority classifies through the title, the typed minority through product_type', async () => {
    stubShopifyApi({ 1: { payload: KUHNS_GOLDEN_PAYLOAD } });

    const { records } = await new KuhnsFeedAdapter().fetch(CONFIG);

    expect(
      recordByName(
        records,
        'Talisker 10 Years Single Malt Scotch Whisky alc. 45,8 Vol.-% 0,7l',
      ).category,
    ).toBe('spirits'); // empty product_type → title token
    expect(
      recordByName(
        records,
        'Kuhns Riesling trocken alc. 12 Vol.-% 0,75l',
      ).category,
    ).toBe('wine_still'); // mapped `Wein`
  });

  it('spec: every fixture row is mapped or reported — nothing silently lost', async () => {
    stubShopifyApi({ 1: { payload: KUHNS_GOLDEN_PAYLOAD } });

    const { records, errors } = await new KuhnsFeedAdapter().fetch(CONFIG);

    const mapped = new Set(records.map((record) => record.productId));
    const reported = new Set(
      errors
        .map((error) => error.match(/kuhns product \d+ \(SKU ([^)]+)\)/)?.[1])
        .filter(Boolean),
    );
    for (const product of KUHNS_GOLDEN_PRODUCTS) {
      const sku = product.variants[0]?.sku ?? '';
      expect(
        mapped.has(sku) || reported.has(sku),
        `fixture row ${product.id} (SKU ${sku})`,
      ).toBe(true);
    }
  });
});
