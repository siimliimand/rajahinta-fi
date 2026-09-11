/**
 * alks.fi Store API parser tests (task 1.1, change
 * alks-feed-and-import-vat).
 *
 * The golden fixture IS the payload contract (same pattern as the Alko
 * adapter): row 1 is pinned from the live Store API sample, rows 2–5
 * pin every parser branch. The spec scenarios from the data-acquisition
 * specification are asserted explicitly: matching and non-matching
 * SKUs, parse-failure-keeps-the-record, the name/category
 * contradiction, and the weight mapping — plus EUR-only and minor-unit
 * price guards.
 *
 * @module AlksStoreParserTest
 */
import { describe, it, expect } from 'vitest';
import {
  parseAlksStoreProduct,
  parseAlksStoreProducts,
} from '../adapters/alks.parser';
import {
  ALKS_GOLDEN_PAYLOAD,
  ALKS_GOLDEN_PRODUCTS,
} from '../adapters/__fixtures__/alks-store-products.fixture';

describe('parseAlksStoreProducts — golden dataset', () => {
  const { records, errors } = parseAlksStoreProducts(ALKS_GOLDEN_PAYLOAD);

  it('maps four golden rows and reports two per-row corrections', () => {
    expect(records).toHaveLength(4);
    expect(errors).toHaveLength(2);
  });

  it('produces exactly these canonical records (design D1/D3/D7)', () => {
    expect(records).toEqual([
      // Live sample row: SKU prefix stripped to EAN, name-parsed
      // ABV/volume/container, Likööri → spirits tax key, 530 g.
      expect.objectContaining({
        productId: 'de-4740077005916',
        productName: 'Herb Liqueur 35% 0.5 l PET',
        ean: '4740077005916',
        category: 'spirits',
        regulatoryClassification: 'spirits',
        alcoholByVolume: 35 / 100,
        volumeMl: 500,
        containerType: 'plastic',
        priceCents: 699,
        weightGrams: 530,
        availability: 'in_stock',
        sourceUrl: 'https://alks.fi/product/herb-liqueur-35-0-5-l-pet/',
      }),
        // Comma-decimal volume form, no container token, no weight.
        expect.objectContaining({
          productId: 'de-4260123456789',
          ean: '4260123456789',
          category: 'beer',
          alcoholByVolume: 4.8 / 100,
          volumeMl: 500,
          containerType: 'other',
          weightGrams: null,
          brand: 'Kulbrau',
        }),
      // Non-matching SKU: record kept, ean null, correction error.
      expect.objectContaining({
        productId: 'promo-123',
        ean: null,
        category: 'wine_still',
        alcoholByVolume: 8 / 100,
        volumeMl: 750,
        weightGrams: 1250,
      }),
      // Unparseable name: record kept with the unparsed fields null/0.
      expect.objectContaining({
        productId: 'ee-6410000000009',
        ean: '6410000000009',
        category: 'beer',
        alcoholByVolume: null,
        volumeMl: 0,
        containerType: 'other',
        availability: 'out_of_stock',
        weightGrams: null,
      }),
    ]);
  });

  it('keeps EUR-native provenance and the cross-border deposit stance', () => {
    for (const record of records) {
      expect(record.currency).toBe('EUR');
      expect(record.originalCurrency).toBe('EUR');
      expect(record.originalPriceCents).toBe(record.priceCents);
      expect(record.fxDatasetVersion).toBeUndefined();
      expect(record.depositSystem).toBe(false);
    }
  });

  it('reports the non-matching SKU with an error naming it', () => {
    expect(errors[0]).toContain('promo-123');
    expect(errors[0]).toContain('correction queue');
  });

  it('reports the name/category contradiction naming both sides', () => {
    expect(errors[1]).toContain('756334');
    expect(errors[1]).toContain('de-4006421333909');
    expect(errors[1]).toContain('beer');
    expect(errors[1]).toContain('wine_still');
    expect(errors[1]).toContain('correction queue');
  });

  it('golden fixture stays exhaustive — every fixture row is mapped or reported', () => {
    const mapped = new Set(records.map((r) => r.productId));
    const reported = new Set(
      errors.map((e) => e.match(/alks product (\d+)/)?.[1]).filter(Boolean),
    );
    for (const product of ALKS_GOLDEN_PRODUCTS) {
      expect(
        mapped.has(product.sku) || reported.has(String(product.id)),
      ).toBe(true);
    }
  });

  it('containerType stays inside the product_master CHECK vocabulary (migration 0002)', () => {
    // 'plastic-bottle' / 'metal-can' / 'unknown' (core-domain kebab-case
    // canonicals) violate product_master_container_type_check and bounce
    // every INSERT of the run — the vocabulary here is the schema's.
    const ALLOWED = new Set([
      'glass',
      'plastic',
      'metal',
      'carton',
      'other',
      'can',
      'bottle',
    ]);
    for (const record of records) {
      expect(ALLOWED.has(record.containerType)).toBe(true);
    }
  });
});

describe('parseAlksStoreProduct — spec scenarios', () => {
  it('scenario: matching SKU — de-4740077005916 yields EAN 4740077005916', () => {
    const { record, errors } = parseAlksStoreProduct(ALKS_GOLDEN_PRODUCTS[0]);
    expect(errors).toEqual([]);
    expect(record?.ean).toBe('4740077005916');
  });

  it('scenario: non-matching SKU — promo-123 keeps the record without an EAN and names the SKU', () => {
    const { record, errors } = parseAlksStoreProduct(ALKS_GOLDEN_PRODUCTS[2]);
    expect(record).not.toBeNull();
    expect(record?.ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('promo-123');
  });

  it('scenario: parse failure keeps the product with the unparsed field null', () => {
    const { record, errors } = parseAlksStoreProduct(ALKS_GOLDEN_PRODUCTS[3]);
    expect(errors).toEqual([]);
    expect(record).not.toBeNull();
    expect(record?.alcoholByVolume).toBeNull();
    expect(record?.volumeMl).toBe(0);
  });

  it('scenario: contradicting sources produce a correction error and no record', () => {
    const { record, errors } = parseAlksStoreProduct(ALKS_GOLDEN_PRODUCTS[4]);
    expect(record).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('correction queue');
  });

  it('scenario: weight stored — 0.53 kg maps to 530 grams', () => {
    const { record } = parseAlksStoreProduct(ALKS_GOLDEN_PRODUCTS[0]);
    expect(record?.weightGrams).toBe(530);
  });

  it('scenario: weight absent — weightGrams stays null and no error is reported', () => {
    const { record, errors } = parseAlksStoreProduct(ALKS_GOLDEN_PRODUCTS[1]);
    expect(errors).toEqual([]);
    expect(record?.weightGrams).toBeNull();
  });
});

describe('parseAlksStoreProducts — contract guards', () => {
  it('rejects a payload that is not a JSON array', () => {
    const { records, errors } = parseAlksStoreProducts({ products: [] });
    expect(records).toEqual([]);
    expect(errors[0]).toContain('not a JSON array');
  });

  it('rejects a non-EUR row per-item (Posti precedent — conversion is not this parser’s job)', () => {
    const row = {
      ...ALKS_GOLDEN_PRODUCTS[0],
      prices: { price: '699', currency_code: 'SEK' },
    };
    const { records, errors } = parseAlksStoreProducts([row]);
    expect(records).toEqual([]);
    expect(errors[0]).toContain('is not EUR');
  });

  it('rejects a major-unit price string — minor-unit integers are the contract', () => {
    const row = {
      ...ALKS_GOLDEN_PRODUCTS[0],
      prices: { price: '6.99', currency_code: 'EUR' },
    };
    const { records, errors } = parseAlksStoreProducts([row]);
    expect(records).toEqual([]);
    expect(errors[0]).toContain('invalid minor-unit price');
  });

  it('rejects a nameless row — the name is the ABV/volume/container source', () => {
    const row = { ...ALKS_GOLDEN_PRODUCTS[0], name: '   ' };
    const { records, errors } = parseAlksStoreProducts([row]);
    expect(records).toEqual([]);
    expect(errors[0]).toContain('missing or empty product name');
  });

  it('resolves the category from the name alone when no category maps', () => {
    const { record, errors } = parseAlksStoreProduct({
      id: 756335,
      name: 'Sisu Vodka 40% 500 ml',
      sku: 'fi-6410400123456',
      permalink: 'https://alks.fi/product/sisu-vodka/',
      prices: { price: '1899', currency_code: 'EUR' },
      categories: [{ name: 'Väkevä' }],
      is_in_stock: true,
    });
    expect(errors).toEqual([]);
    expect(record?.category).toBe('spirits');
    expect(record?.alcoholByVolume).toBe(40 / 100);
    expect(record?.volumeMl).toBe(500);
  });

  it('maps container tokens through standardizeContainerType (tölkki → metal-can)', () => {
    const { record, errors } = parseAlksStoreProduct({
      id: 756336,
      name: 'Lonkero 5,5% 0,5 l tölkki',
      sku: 'fi-6417901234567',
      permalink: 'https://alks.fi/product/lonkero/',
      prices: { price: '349', currency_code: 'EUR' },
      categories: [{ name: 'Lonkero' }],
      is_in_stock: true,
    });
    expect(errors).toEqual([]);
    expect(record?.containerType).toBe('can');
    expect(record?.category).toBe('other_fermented');
    expect(record?.volumeMl).toBe(500);
  });
});
