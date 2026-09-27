/**
 * mydrink.ee feed adapter tests (task 2.1, change
 * onboard-mydrink-merchant).
 *
 * Pins the shared walk through the mydrink subclass against a stubbed
 * Store API. The walk itself is pinned exhaustively by the
 * alks/longero/kippis suites, so only the passthrough identity is
 * re-asserted here (merchantId, the standard Store API collection
 * path, the `mydrink` error-label prefix) — no pagination duplication.
 * The golden mydrink fixtures then pin the sweep reality (designs
 * D2/D3/D4/D5): internal-code SKUs kept EAN-less with the per-row
 * correction error on every row, the effective sale price flowing
 * through from `prices.price` (regular_price present but ignored), the
 * Estonian category vocabulary mapped in task 1.2 with leaf-first
 * wine resolution, kg-string weights, empty brands, and the unmapped
 * parent/promo rows dropping to the correction queue.
 *
 * @module MydrinkFeedAdapterTest
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MydrinkFeedAdapter } from '../adapters/mydrink.adapter';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';
import {
  MYDRINK_GOLDEN_PAYLOAD,
  MYDRINK_GOLDEN_PRODUCTS,
} from '../adapters/__fixtures__/mydrink-store-products.fixture';

const CONFIG = {
  feedUrl: 'https://mydrink.ee',
  feedFormat: 'json' as const,
};

const COLLECTION_URL = 'https://mydrink.ee/wp-json/wc/store/v1/products';

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
    name: 'Bulk Long Drink 5,5% 0,33 l',
    sku: String(6410000000000 + globalIndex),
    permalink: `https://mydrink.ee/product/bulk-${globalIndex}/`,
    prices: { price: '199', currency_code: 'EUR' },
    categories: [{ name: 'Siider' }],
    brands: [],
    is_in_stock: true,
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
// Subclass identity — the shared walk, mydrink knobs (design D1)
// ---------------------------------------------------------------------------

describe('MydrinkFeedAdapter — subclass identity (design D1)', () => {
  it('resolves as merchant "mydrink" over the standard Store API collection path', async () => {
    const { fetchMock, calls } = stubStoreApi({ 1: { payload: [] } });
    const adapter = new MydrinkFeedAdapter();

    expect(adapter.merchantId).toBe('mydrink');

    const { records, errors } = await adapter.fetch(CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(`${COLLECTION_URL}?per_page=100&page=1`);
    expect(records).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('page-level walk errors carry the mydrink label; failed pages never abort the walk', async () => {
    stubStoreApi(
      { 2: { networkError: new Error('connection reset') } },
      { totalPages: '3', payload: [storeRow(0)] },
    );

    const { records, errors } = await new MydrinkFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(2); // pages 1 and 3
    expect(errors).toEqual([
      'mydrink page 2 fetch failed: connection reset',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sweep reality totals — the golden payload end to end
// ---------------------------------------------------------------------------

describe('MydrinkFeedAdapter — golden payload (sweep §1.1)', () => {
  it('spec: 707-row reality, distilled — 7 records kept, the full correction surface collected', async () => {
    stubStoreApi({ 1: { payload: MYDRINK_GOLDEN_PAYLOAD } });

    const { records, errors } = await new MydrinkFeedAdapter().fetch(CONFIG);

    // 7 records (9 fixture rows minus the two unmapped drops) + 11
    // errors: the per-row SKU correction on every internal-code row
    // (7 kept + 2 dropped) plus the drop error on each unmapped row
    // (2 × 2 total).
    expect(records).toHaveLength(7);
    expect(errors).toHaveLength(11);
    expect(
      errors.filter((error) =>
        error.includes('no canonical beverage category'),
      ),
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Internal-code SKUs — every row EAN-less (design D2)
// ---------------------------------------------------------------------------

describe('MydrinkFeedAdapter — internal-code SKUs (design D2)', () => {
  it('spec: the internal-code SKU keeps the record EAN-less and names the SKU', async () => {
    stubStoreApi({ 1: { payload: [MYDRINK_GOLDEN_PRODUCTS[0]] } });

    const { records, errors } = await new MydrinkFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].productId).toBe('MTBE026-1-2-1');
    expect(records[0].ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('MTBE026-1-2-1');
    expect(errors[0]).toContain('record kept without an EAN');
  });

  it('spec: every golden row ingests EAN-less — 707/707 internal-code rows on the live sweep', async () => {
    stubStoreApi({ 1: { payload: MYDRINK_GOLDEN_PAYLOAD } });

    const { records } = await new MydrinkFeedAdapter().fetch(CONFIG);

    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.ean).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Sale price — the effective `prices.price` (regular_price ignored)
// ---------------------------------------------------------------------------

describe('MydrinkFeedAdapter — sale prices', () => {
  it('spec: the effective sale price becomes the canonical cents; the crossed-out regular_price is ignored', async () => {
    stubStoreApi({ 1: { payload: [MYDRINK_GOLDEN_PRODUCTS[0]] } });

    const { records, errors } = await new MydrinkFeedAdapter().fetch(CONFIG);

    // Only the SKU correction — no price complaint.
    expect(errors).toEqual([expect.stringContaining('MTBE026-1-2-1')]);
    // 18.99 € effective sale against a 21.99 € regular — the parser
    // reads `prices.price` only, EUR-native, no conversion.
    expect(records[0].priceCents).toBe(1899);
    expect(records[0].currency).toBe('EUR');
    expect(records[0].originalPriceCents).toBe(1899);
    expect(records[0].originalCurrency).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// Estonian categories — task 1.2 vocabulary, leaf-first wine (design D3)
// ---------------------------------------------------------------------------

describe('MydrinkFeedAdapter — Estonian category mapping (task 1.2 keys)', () => {
  /**
   * The sweep's terms → the tax-rule category each must land in. The
   * parser carries only the tax key (`category` and
   * `regulatoryClassification` are the same value); liqueur shares the
   * spirits tax key, like its singular mapping upstream.
   */
  const CATEGORY_EXPECTATIONS = [
    { term: 'Kange alkohol ▾', tax: 'spirits' },
    { term: 'Punased', tax: 'wine_still' },
    { term: 'Vahuveinid', tax: 'wine_sparkling' },
    { term: 'Õlu ▾', tax: 'beer' },
    { term: 'Siider', tax: 'other_fermented' },
    { term: 'Liköör', tax: 'spirits' },
    { term: 'Karastusjoogid', tax: 'other_fermented' },
  ] as const;

  it('spec: every golden row lands in the tax-rule category its term maps to', async () => {
    stubStoreApi({ 1: { payload: MYDRINK_GOLDEN_PAYLOAD } });

    const { records } = await new MydrinkFeedAdapter().fetch(CONFIG);

    for (const { term, tax } of CATEGORY_EXPECTATIONS) {
      const rows = MYDRINK_GOLDEN_PRODUCTS.filter((row) =>
        row.categories.some((category) => category.name === term),
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

  it('spec: the veinid ▾ parent sorts before the leaf — the leaf still wins (design D3)', async () => {
    stubStoreApi({
      1: { payload: [MYDRINK_GOLDEN_PRODUCTS[1], MYDRINK_GOLDEN_PRODUCTS[2]] },
    });

    const { records } = await new MydrinkFeedAdapter().fetch(CONFIG);

    // Both rows list the unmapped `veinid ▾` parent FIRST; mapping
    // takes the first mappable term in payload order, so still and
    // sparkling resolve from their own leaves — the excise split the
    // parent mapping would have destroyed stays intact.
    expect(records[0].category).toBe('wine_still');
    expect(records[1].category).toBe('wine_sparkling');
  });

  it('spec: a wine row with only the veinid ▾ parent drops — never misfiled as still wine', async () => {
    stubStoreApi({ 1: { payload: [MYDRINK_GOLDEN_PRODUCTS[7]] } });

    const { records, errors } = await new MydrinkFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(0);
    expect(errors).toHaveLength(2); // SKU correction + the drop
    expect(
      errors.some((error) =>
        error.includes('no canonical beverage category'),
      ),
    ).toBe(true);
  });

  it('spec: the Kingiideed ▾ promo section drops like on the live feed', async () => {
    stubStoreApi({ 1: { payload: [MYDRINK_GOLDEN_PRODUCTS[8]] } });

    const { records, errors } = await new MydrinkFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(0);
    expect(
      errors.some((error) =>
        error.includes('no canonical beverage category'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Availability, ABV/volume, weight, empty brands
// ---------------------------------------------------------------------------

describe('MydrinkFeedAdapter — availability, null-ABV rows, kg weights, empty brands', () => {
  it('is_in_stock availability passes through: true → in_stock, false → out_of_stock', async () => {
    stubStoreApi({
      1: { payload: [MYDRINK_GOLDEN_PRODUCTS[0], MYDRINK_GOLDEN_PRODUCTS[6]] },
    });

    const { records } = await new MydrinkFeedAdapter().fetch(CONFIG);

    expect(records[0].availability).toBe('in_stock');
    expect(records[1].availability).toBe('out_of_stock');
  });

  it('spec: names carry ABV/volume in Estonian comma decimals; containerless names stay "other"', async () => {
    stubStoreApi({
      1: { payload: [MYDRINK_GOLDEN_PRODUCTS[0], MYDRINK_GOLDEN_PRODUCTS[6]] },
    });

    const { records } = await new MydrinkFeedAdapter().fetch(CONFIG);

    // 40% 0,5L → 0.40 / 500 ml; the vodka row carries no container
    // token (Estonian names carry none of the Finnish container
    // words) → the CHECK-safe 'other'.
    expect(records[0].alcoholByVolume).toBeCloseTo(0.4, 10);
    expect(records[0].volumeMl).toBe(500);
    expect(records[0].containerType).toBe('other');
    // No ABV token → null, record kept (design D3).
    expect(records[1].alcoholByVolume).toBeNull();
    expect(records[1].volumeMl).toBe(330);
  });

  it('spec: weight is a kg string — 1.5 → 1500 g; absent → null without an error (design D7)', async () => {
    stubStoreApi({
      1: {
        payload: [
          MYDRINK_GOLDEN_PRODUCTS[0],
          MYDRINK_GOLDEN_PRODUCTS[1],
          MYDRINK_GOLDEN_PRODUCTS[2],
        ],
      },
    });

    const { records, errors } = await new MydrinkFeedAdapter().fetch(CONFIG);

    expect(records[0].weightGrams).toBe(1500);
    expect(records[1].weightGrams).toBe(1400);
    expect(records[2].weightGrams).toBeNull();
    // Weight never errors — the SKU corrections are the only noise.
    for (const error of errors) {
      expect(error).toContain('does not match any accepted');
    }
  });

  it('spec: brands is empty on every live row — records keep the empty-brand compound key', async () => {
    stubStoreApi({ 1: { payload: MYDRINK_GOLDEN_PAYLOAD } });

    const { records } = await new MydrinkFeedAdapter().fetch(CONFIG);

    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      // RawFeedRecord.brand is a plain string; the shared parser's
      // empty-brands value is '' — the compound-matching key of
      // design D4 — not null and never guessed.
      expect(record.brand).toBe('');
      expect(record.manufacturer).toBe('');
    }
  });
});
