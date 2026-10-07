/**
 * araxes.ee feed adapter tests (task 2.1, change
 * onboard-araxes-merchant).
 *
 * Pins the shared walk through the araxes subclass against a stubbed
 * Store API. The walk itself is pinned exhaustively by the
 * alks/longero/kippis/mydrink suites, so only the passthrough
 * identity is re-asserted here (merchantId, the standard Store API
 * collection path, the `araxes` error-label prefix) — no pagination
 * duplication. The golden araxes fixtures then pin the sweep reality
 * (designs D2/D3/D4/D5): 5-digit internal-code SKUs kept EAN-less
 * with the per-row correction error on every row, the effective sale
 * price flowing through from `prices.price` (regular_price and
 * sale_price present but ignored), the bare Estonian category
 * vocabulary mapped in task 1.2 with leaf-first wine resolution past
 * the unmapped `Vein` parent, kg-string weights, empty brands, and
 * the `Pant` attribute never becoming pantti membership.
 *
 * @module AraxesFeedAdapterTest
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AraxesFeedAdapter } from '../adapters/araxes.adapter';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';
import {
  ARAXES_GOLDEN_PAYLOAD,
  ARAXES_GOLDEN_PRODUCTS,
} from '../adapters/__fixtures__/araxes-store-products.fixture';

const CONFIG = {
  feedUrl: 'https://araxes.ee',
  feedFormat: 'json' as const,
};

const COLLECTION_URL = 'https://araxes.ee/wp-json/wc/store/v1/products';

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
    id: 710000 + globalIndex,
    name: 'Bulk Long Drink 5,5% 0,33 l',
    sku: String(6410000000000 + globalIndex),
    permalink: `https://araxes.ee/product/bulk-${globalIndex}/`,
    prices: { price: '199', currency_code: 'EUR' },
    categories: [{ name: 'Long drink' }],
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
// Subclass identity — the shared walk, araxes knobs (design D1)
// ---------------------------------------------------------------------------

describe('AraxesFeedAdapter — subclass identity (design D1)', () => {
  it('resolves as merchant "araxes" over the standard Store API collection path', async () => {
    const { fetchMock, calls } = stubStoreApi({ 1: { payload: [] } });
    const adapter = new AraxesFeedAdapter();

    expect(adapter.merchantId).toBe('araxes');

    const { records, errors } = await adapter.fetch(CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(`${COLLECTION_URL}?per_page=100&page=1`);
    expect(records).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('page-level walk errors carry the araxes label; failed pages never abort the walk', async () => {
    stubStoreApi(
      { 2: { networkError: new Error('connection reset') } },
      { totalPages: '3', payload: [storeRow(0)] },
    );

    const { records, errors } = await new AraxesFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(2); // pages 1 and 3
    expect(errors).toEqual([
      'araxes page 2 fetch failed: connection reset',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sweep reality totals — the golden payload end to end
// ---------------------------------------------------------------------------

describe('AraxesFeedAdapter — golden payload (sweep §1)', () => {
  it('spec: 1630-row reality, distilled — 5 records kept, the SKU-correction surface the only noise', async () => {
    stubStoreApi({ 1: { payload: ARAXES_GOLDEN_PAYLOAD } });

    const { records, errors } = await new AraxesFeedAdapter().fetch(CONFIG);

    // All 5 fixture rows resolve canonically (the sweep's category
    // drops — merch, Kokteilid, bare Vein — live outside the golden
    // set); 5 errors: the per-row SKU correction on every
    // internal-code row, and nothing else.
    expect(records).toHaveLength(5);
    expect(errors).toHaveLength(5);
    for (const error of errors) {
      expect(error).toContain('does not match any accepted');
    }
    expect(
      errors.filter((error) =>
        error.includes('no canonical beverage category'),
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Internal-code SKUs — every row EAN-less (design D2)
// ---------------------------------------------------------------------------

describe('AraxesFeedAdapter — internal-code SKUs (design D2)', () => {
  it('spec: the 5-digit internal code keeps the record EAN-less and names the SKU', async () => {
    stubStoreApi({ 1: { payload: [ARAXES_GOLDEN_PRODUCTS[0]] } });

    const { records, errors } = await new AraxesFeedAdapter().fetch(CONFIG);

    expect(records).toHaveLength(1);
    expect(records[0].productId).toBe('42631');
    expect(records[0].ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('42631');
    expect(errors[0]).toContain('record kept without an EAN');
  });

  it('spec: every golden row ingests EAN-less — 1630/1630 internal-code rows on the live sweep', async () => {
    stubStoreApi({ 1: { payload: ARAXES_GOLDEN_PAYLOAD } });

    const { records } = await new AraxesFeedAdapter().fetch(CONFIG);

    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.ean).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Sale price — the effective `prices.price` (regular/sale ignored)
// ---------------------------------------------------------------------------

describe('AraxesFeedAdapter — sale prices', () => {
  it('spec: the effective sale price becomes the canonical cents; regular_price and sale_price are ignored', async () => {
    stubStoreApi({ 1: { payload: [ARAXES_GOLDEN_PRODUCTS[3]] } });

    const { records, errors } = await new AraxesFeedAdapter().fetch(CONFIG);

    // Only the SKU correction — no price complaint.
    expect(errors).toEqual([expect.stringContaining('43555')]);
    // 13.49 € effective sale against a crossed-out 16.99 € regular —
    // the parser reads `prices.price` only, EUR-native, no conversion.
    expect(records[0].priceCents).toBe(1349);
    expect(records[0].currency).toBe('EUR');
    expect(records[0].originalPriceCents).toBe(1349);
    expect(records[0].originalCurrency).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// Bare Estonian categories — task 1.2 vocabulary, leaf-first wine (design D3)
// ---------------------------------------------------------------------------

describe('AraxesFeedAdapter — bare Estonian category mapping (task 1.2 keys)', () => {
  /**
   * The sweep's bare terms → the tax-rule category each must land
   * in. The parser carries only the tax key (`category` and
   * `regulatoryClassification` are the same value).
   */
  const CATEGORY_EXPECTATIONS = [
    { term: 'Kange alkohol', tax: 'spirits' },
    { term: 'Viski', tax: 'spirits' },
    { term: 'Punane vein', tax: 'wine_still' },
    { term: 'Vahuvein', tax: 'wine_sparkling' },
    { term: 'Alkoholivaba', tax: 'other_fermented' },
    { term: 'Karastusjook', tax: 'other_fermented' },
    { term: 'Õlu', tax: 'beer' },
  ] as const;

  it('spec: every golden row lands in the tax-rule category its bare term maps to', async () => {
    stubStoreApi({ 1: { payload: ARAXES_GOLDEN_PAYLOAD } });

    const { records } = await new AraxesFeedAdapter().fetch(CONFIG);

    for (const { term, tax } of CATEGORY_EXPECTATIONS) {
      const rows = ARAXES_GOLDEN_PRODUCTS.filter((row) =>
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

  it('spec: the bare Vein parent sorts before the leaf — the leaf still wins (design D3)', async () => {
    stubStoreApi({ 1: { payload: [ARAXES_GOLDEN_PRODUCTS[1]] } });

    const { records } = await new AraxesFeedAdapter().fetch(CONFIG);

    // The row lists the unmapped bare `Vein` parent FIRST (parent and
    // its identically named leaf share one lowercase key — mapping it
    // would misfile sparkling rows); mapping takes the first mappable
    // term in payload order, so `Punane vein` decides.
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe('wine_still');
  });
});

// ---------------------------------------------------------------------------
// Availability, ABV/volume, weight, empty brands, unread attributes
// ---------------------------------------------------------------------------

describe('AraxesFeedAdapter — availability, null-ABV rows, kg weights, empty brands, unread attributes', () => {
  it('is_in_stock availability passes through: true → in_stock, false → out_of_stock', async () => {
    stubStoreApi({
      1: { payload: [ARAXES_GOLDEN_PRODUCTS[0], ARAXES_GOLDEN_PRODUCTS[2]] },
    });

    const { records } = await new AraxesFeedAdapter().fetch(CONFIG);

    expect(records[0].availability).toBe('in_stock');
    expect(records[1].availability).toBe('out_of_stock');
  });

  it('spec: names carry ABV/volume; the non-alcoholic name without an ABV token stays null and kept (design D3)', async () => {
    stubStoreApi({
      1: { payload: [ARAXES_GOLDEN_PRODUCTS[0], ARAXES_GOLDEN_PRODUCTS[2]] },
    });

    const { records } = await new AraxesFeedAdapter().fetch(CONFIG);

    // "1L 40%" → 0.40 / 1000 ml; no container token in the name →
    // the CHECK-safe 'other'.
    expect(records[0].alcoholByVolume).toBeCloseTo(0.4, 10);
    expect(records[0].volumeMl).toBe(1000);
    expect(records[0].containerType).toBe('other');
    // No ABV token → null, record kept (design D3).
    expect(records[1].alcoholByVolume).toBeNull();
    expect(records[1].volumeMl).toBe(330);
  });

  it('spec: weight is a kg string — 1 → 1000 g; absent → null without an error (design D7)', async () => {
    stubStoreApi({
      1: {
        payload: [
          ARAXES_GOLDEN_PRODUCTS[0],
          ARAXES_GOLDEN_PRODUCTS[1],
          ARAXES_GOLDEN_PRODUCTS[2],
        ],
      },
    });

    const { records, errors } = await new AraxesFeedAdapter().fetch(CONFIG);

    expect(records[0].weightGrams).toBe(1000);
    expect(records[1].weightGrams).toBe(1400);
    expect(records[2].weightGrams).toBeNull();
    // Weight never errors — the SKU corrections are the only noise.
    for (const error of errors) {
      expect(error).toContain('does not match any accepted');
    }
  });

  it('spec: brands is empty on every live row — records keep the empty-brand compound key (design D4)', async () => {
    stubStoreApi({ 1: { payload: ARAXES_GOLDEN_PAYLOAD } });

    const { records } = await new AraxesFeedAdapter().fetch(CONFIG);

    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      // RawFeedRecord.brand is a plain string; the shared parser's
      // empty-brands value is '' — the compound-matching key of
      // design D4 — not null and never guessed.
      expect(record.brand).toBe('');
      expect(record.manufacturer).toBe('');
    }
  });

  it('spec: the Pant attribute never becomes pantti membership — depositSystem stays false (design D5)', async () => {
    stubStoreApi({ 1: { payload: [ARAXES_GOLDEN_PRODUCTS[0]] } });

    const { records } = await new AraxesFeedAdapter().fetch(CONFIG);

    // The row carries the full structured-attribute set (Pant, Maht,
    // Alkoholisisaldus, Päritolumaa, …) and the parse ignores all of
    // it: deposit membership is unknown at the feed level, never
    // assumed true for a foreign merchant.
    expect(ARAXES_GOLDEN_PRODUCTS[0].attributes?.some(
      (attribute) => attribute.name === 'Pant',
    )).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].depositSystem).toBe(false);
  });
});
