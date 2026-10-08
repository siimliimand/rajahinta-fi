/**
 * bottleofitaly.com feed adapter tests (task 3.1, change
 * onboard-shopify-lmdw-merchants).
 *
 * Pins the shared walk through the BOI subclass against a stubbed
 * products.json API. The walk itself is pinned exhaustively by the
 * shopify-products.walk suite, so only the passthrough identity is
 * re-asserted here (merchantId, the products.json collection URL at
 * `limit=250`, the `bottleofitaly` error-label prefix) — no
 * pagination duplication. The golden BOI fixtures then pin the sweep
 * reality end to end through this subclass (designs D2/D3): tag-ABV,
 * the volume fallback chain, the merch drops, and the EAN-less
 * internal-code SKUs as the correction surface.
 *
 * @module BottleofItalyFeedAdapterTest
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { BottleofItalyFeedAdapter } from '../adapters/bottleofitaly.adapter';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';
import {
  BOTTLEOFITALY_GOLDEN_PAYLOAD,
  BOTTLEOFITALY_GOLDEN_PRODUCTS,
} from '../adapters/__fixtures__/bottleofitaly-products.fixture';

const CONFIG = {
  feedUrl: 'https://bottleofitaly.com',
  feedFormat: 'json' as const,
};

const PRODUCTS_URL = 'https://bottleofitaly.com/products.json';

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
      // Shopify products.json has no total-pages header — the walk
      // terminates on short pages only.
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

/**
 * A minimal valid products.json row; every generated row parses
 * cleanly (tag ABV, no SKU → no correction line).
 */
function shopifyRow(globalIndex: number): Record<string, unknown> {
  return {
    id: 9_000_000 + globalIndex,
    title: `Test Grappa ${globalIndex} 0,5 l`,
    handle: `test-grappa-${globalIndex}`,
    product_type: 'Spirits',
    vendor: 'Test Vendor',
    tags: ['custom-gradazione-40-0'],
    variants: [
      {
        title: 'Default Title',
        sku: null,
        barcode: null,
        grams: 750,
        price: '19.90',
        available: true,
      },
    ],
  };
}

function productPage(start: number, count: number): PageSpec {
  return {
    payload: {
      products: Array.from({ length: count }, (_, i) => shopifyRow(start + i)),
    },
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
// Subclass identity — the shared walk, BOI knobs (design D1)
// ---------------------------------------------------------------------------

describe('BottleofItalyFeedAdapter — subclass identity (design D1)', () => {
  it('resolves as merchant "bottleofitaly" over the products.json collection URL', async () => {
    const { fetchMock, calls } = stubShopifyApi({ 1: { payload: { products: [] } } });
    const adapter = new BottleofItalyFeedAdapter();

    expect(adapter.merchantId).toBe('bottleofitaly');

    const { records, errors } = await adapter.fetch(CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(`${PRODUCTS_URL}?limit=250&page=1`);
    expect(records).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('page-level walk errors carry the bottleofitaly label; failed pages never abort the walk', async () => {
    stubShopifyApi(
      {
        2: { networkError: new Error('connection reset') },
        3: productPage(250, 1), // short page → the walk ends here
      },
      { payload: productPage(0, 250).payload }, // full pages keep the walk going
    );

    const { records, errors } = await new BottleofItalyFeedAdapter().fetch(CONFIG);

    // Page 1 full (250), page 2 failed, page 3 short (1) → stop.
    expect(records).toHaveLength(251);
    expect(errors).toEqual([
      'bottleofitaly page 2 fetch failed: connection reset',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sweep reality totals — the golden payload end to end
// ---------------------------------------------------------------------------

describe('BottleofItalyFeedAdapter — golden payload (sweep §1.1)', () => {
  it('spec: 9-row reality, distilled — 7 records kept, SKU corrections + merch drops + one hold', async () => {
    stubShopifyApi({ 1: { payload: BOTTLEOFITALY_GOLDEN_PAYLOAD } });

    const { records, errors } = await new BottleofItalyFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(7);
    // 9 SKU corrections (every internal-code SKU, the dropped merch
    // pair's riding along) + 1 non-alcoholic hold + 2 category drops.
    expect(
      errors.filter((error) => error.includes('does not match any accepted')),
    ).toHaveLength(9);
    expect(
      errors.filter((error) => error.includes('Held for review')),
    ).toHaveLength(1);
    expect(
      errors.filter((error) => error.includes('maps to no canonical beverage category')),
    ).toHaveLength(2);
    expect(errors).toHaveLength(12);
  });

  it('spec: every census category bucket lands in its tax-rule category (design D3)', async () => {
    stubShopifyApi({ 1: { payload: BOTTLEOFITALY_GOLDEN_PAYLOAD } });

    const { records } = await new BottleofItalyFeedAdapter().fetch(CONFIG);

    const expectations = [
      { name: 'Grappa di Barolo 0,5 l', tax: 'spirits' }, // Spirits
      { name: 'Single Malt Whisky 70cl', tax: 'spirits' }, // Spirits
      { name: 'Chianti Classico 0,75 l', tax: 'wine_still' }, // Vino Rosso
      { name: 'Barolo DOCG', tax: 'wine_still' }, // Vino Rosso
      { name: 'Barbaresco DOCG', tax: 'wine_still' }, // Vino Rosso
      { name: 'Birra Artigianale 24 x 33 cl', tax: 'beer' }, // Birra
      // Vino Bianco re-keyed by the non-alcoholic guard (no tag →
      // null ABV is barred from alcohol categories).
      { name: 'Vernaccia di San Gimignano 0,75 l', tax: 'other_fermented' },
    ] as const;
    for (const { name, tax } of expectations) {
      const record = recordByName(records, name);
      expect(record.category, name).toBe(tax);
      expect(record.regulatoryClassification, name).toBe(tax);
    }
    // The merch pair is nowhere in the records.
    expect(
      BOTTLEOFITALY_GOLDEN_PRODUCTS.filter(
        (row) => row.product_type === 'Olio' || row.product_type === 'Aceto',
      ),
    ).toHaveLength(2);
    expect(
      records.filter(
        (record) => record.productName.includes('Olio') || record.productName.includes('Aceto'),
      ),
    ).toHaveLength(0);
  });
});
