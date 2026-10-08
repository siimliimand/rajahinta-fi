/**
 * bottleofitaly.com Shopify products.json parser tests (task 3.1,
 * change onboard-shopify-lmdw-merchants).
 *
 * The golden fixture IS the payload contract (alks/araxes pattern):
 * nine rows distilling the 1.1 sweep reality, seven kept and two
 * dropped. The spec scenarios are asserted explicitly: tag-ABV forms
 * (`40-0`, `41-5`), the volume fallback chain (title → whole-tag →
 * honest 0 ml + ESTIMATED), the merch pair dropping to the correction
 * queue, the EAN-less internal-code SKUs kept with corrections, the
 * EUR-native provenance with `compare_at_price` unread, and the
 * grams/availability/vendor mappings.
 *
 * @module BottleofItalyParserTest
 */
import { describe, it, expect } from 'vitest';
import {
  parseBottleofItalyProduct,
  parseBottleofItalyProducts,
  tagAbvPercent,
  tagVolumeMl,
} from '../adapters/bottleofitaly.parser';
import {
  BOTTLEOFITALY_GOLDEN_PAYLOAD,
  BOTTLEOFITALY_GOLDEN_PRODUCTS,
  type BottleofItalyFixtureProduct,
} from '../adapters/__fixtures__/bottleofitaly-products.fixture';

// ---------------------------------------------------------------------------
// Golden dataset — the sweep reality end to end
// ---------------------------------------------------------------------------

describe('parseBottleofItalyProducts — golden dataset', () => {
  // The walk strips the envelope and hands the hook the rows array —
  // the parser's input is the rows, never the `{ products }` envelope.
  const { records, errors } = parseBottleofItalyProducts(
    BOTTLEOFITALY_GOLDEN_PAYLOAD.products,
  );

  it('maps seven golden rows and reports twelve per-row corrections', () => {
    // 9 rows: 2 merch drops (Olio, Aceto) → 7 records. Errors: one
    // SKU correction per non-matching SKU (9 — every golden SKU is an
    // internal code, the dropped merch rows' corrections ride along
    // per the alks error order), one non-alcoholic hold (the no-tag
    // row), and the two category drops.
    expect(records).toHaveLength(7);
    expect(errors).toHaveLength(12);
  });

  it('produces exactly these canonical records (design D2/D3)', () => {
    expect(records).toEqual([
      // Tag-ABV `40-0` → 0.40, title volume `0,5 l` → 500, vendor →
      // manufacturer + brand, grams → weightGrams, Spirits → spirits.
      expect.objectContaining({
        productId: 'GRAPPA-BAROLO-500',
        productName: 'Grappa di Barolo 0,5 l',
        manufacturer: 'Sibona',
        brand: 'Sibona',
        category: 'spirits',
        regulatoryClassification: 'spirits',
        alcoholByVolume: 40 / 100,
        volumeMl: 500,
        packCount: null,
        containerType: 'other',
        depositSystem: false,
        ean: null,
        priceCents: 2590,
        weightGrams: 750,
        availability: 'in_stock',
        sourceUrl: 'https://bottleofitaly.com/products/grappa-di-barolo-05-l',
        reviewHoldReason: null,
      }),
      // The `41-5` decimal-halves tag form → 0.415; `70cl` title
      // token; sold-out variant; no weight surprise.
      expect.objectContaining({
        productId: 'WHISKY-SM-70',
        category: 'spirits',
        alcoholByVolume: 41.5 / 100,
        volumeMl: 700,
        weightGrams: 1400,
        availability: 'out_of_stock',
      }),
      // Comma-decimal title volume `0,75 l` → 750; still wine.
      expect.objectContaining({
        productId: 'CHIANTI-CC-75',
        category: 'wine_still',
        regulatoryClassification: 'wine_still',
        alcoholByVolume: 12.5 / 100,
        volumeMl: 750,
      }),
      // Whole-tag volume fallback: no title token, `75cl` tag → 750.
      expect.objectContaining({
        productId: 'BAROLO-DOCG-75',
        category: 'wine_still',
        alcoholByVolume: 14 / 100,
        volumeMl: 750,
        sourceUrl: 'https://bottleofitaly.com/products/barolo-docg',
      }),
      // The wine ESTIMATED-volume bucket: no volume token anywhere →
      // honest 0 ml, record kept (ABV parsed, so no hold).
      expect.objectContaining({
        productId: 'BARBARESCO-75',
        category: 'wine_still',
        alcoholByVolume: 13.5 / 100,
        volumeMl: 0,
        reviewHoldReason: null,
      }),
      // Multipack title → per-unit volume 330 + packCount 24 (never
      // 24 × 330); Birra → beer.
      expect.objectContaining({
        productId: 'BIRRA-ART-24X33',
        category: 'beer',
        alcoholByVolume: 6.5 / 100,
        volumeMl: 330,
        packCount: 24,
      }),
      // The no-tag row: null ABV through the non-alcoholic guard —
      // re-keyed to the non-alcoholic tax key with the review hold,
      // record kept (the ESTIMATED path).
      expect.objectContaining({
        productId: 'VERNACCIA-75',
        category: 'other_fermented',
        regulatoryClassification: 'other_fermented',
        alcoholByVolume: null,
        volumeMl: 750,
        reviewHoldReason: 'nonalcoholic_in_alcohol_category',
      }),
    ]);
  });

  it('keeps EUR-native provenance; compare_at_price is never consulted (design D2)', () => {
    for (const record of records) {
      expect(record.currency).toBe('EUR');
      expect(record.originalCurrency).toBe('EUR');
      expect(record.originalPriceCents).toBe(record.priceCents);
      // Absence marks the no-conversion path (fx-rate-dataset spec).
      expect(record.fxDatasetVersion).toBeUndefined();
    }
    // The grappa row carries compare_at_price "35.00" — the marketing
    // "was" price must not surface as the original-price provenance.
    const grappa = BOTTLEOFITALY_GOLDEN_PRODUCTS[0].variants[0];
    expect(grappa.compare_at_price).toBe('35.00');
    expect(records[0].priceCents).toBe(2590);
    expect(records[0].originalPriceCents).toBe(2590);
  });

  it('flags every internal-code SKU EAN-less; the barcode field is unread', () => {
    const skuCorrections = errors.filter((error) =>
      error.includes('does not match any accepted'),
    );
    // 7 kept rows + the dropped merch pair's riding corrections.
    expect(skuCorrections).toHaveLength(9);
    for (const record of records) {
      expect(record.ean).toBeNull();
    }
    // 0 barcodes across the live catalog: the fixture pins the null
    // shape and the parser never consults the field.
    for (const row of BOTTLEOFITALY_GOLDEN_PRODUCTS) {
      expect(row.variants[0].barcode).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Tag extraction — the sweep-proven readers
// ---------------------------------------------------------------------------

describe('tagAbvPercent — the gradazione tag forms', () => {
  it('parses the integer and decimal-halves forms', () => {
    expect(tagAbvPercent(['custom-gradazione-40-0'])).toBe(40);
    expect(tagAbvPercent(['custom-gradazione-41-5'])).toBe(41.5);
    expect(tagAbvPercent(['custom-gradazione-12-5'])).toBe(12.5);
    // The `custom-` prefix is not part of the match (substring, per
    // the sweep spec).
    expect(tagAbvPercent(['gradazione-45-0'])).toBe(45);
  });

  it('finds the tag among decorative noise', () => {
    expect(
      tagAbvPercent(['sibona', 'custom-gradazione-40-0', 'distillati', 'italia']),
    ).toBe(40);
  });

  it('rejects absent, zero and implausible tags — no honest ABV', () => {
    expect(tagAbvPercent([])).toBeNull();
    expect(tagAbvPercent(['sibona', 'vino'])).toBeNull();
    // `0-0` is no parseable alcohol content (the sweep's > 0 filter).
    expect(tagAbvPercent(['custom-gradazione-0-0'])).toBeNull();
    // Above 100 % is a fat-fingered tag, never an ABV — and never an
    // out-of-scale fraction that would throw the mapper.
    expect(tagAbvPercent(['custom-gradazione-400-0'])).toBeNull();
  });
});

describe('tagVolumeMl — the whole-tag volume fallback', () => {
  it('parses volume-shaped tags in every unit', () => {
    expect(tagVolumeMl(['75cl'])).toBe(750);
    expect(tagVolumeMl(['150cl'])).toBe(1500);
    expect(tagVolumeMl(['500ml'])).toBe(500);
    expect(tagVolumeMl(['0,75 l'])).toBe(750);
    expect(tagVolumeMl(['vino', '75cl', 'piemonte'])).toBe(750);
  });

  it('never mistakes other tags for volumes — anchored to the full tag', () => {
    expect(tagVolumeMl(['custom-gradazione-40-0'])).toBeNull();
    expect(tagVolumeMl(['cantine-riunite'])).toBeNull();
    expect(tagVolumeMl([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Volume fallback chain — title → tag → honest 0 ml (design D2)
// ---------------------------------------------------------------------------

describe('volume fallback chain', () => {
  /** A minimal valid spirits row with overridable fields. */
  function rowWith(overrides: Partial<BottleofItalyFixtureProduct>): BottleofItalyFixtureProduct {
    return {
      id: 829999,
      title: 'Grappa 0,5 l',
      handle: null,
      product_type: 'Spirits',
      vendor: 'Test Vendor',
      tags: [],
      variants: [
        {
          title: 'Default Title',
          sku: 'TEST-500',
          barcode: null,
          grams: null,
          price: '19.90',
          available: true,
        },
      ],
      ...overrides,
    };
  }

  it('prefers the title token over a volume-shaped tag', () => {
    const { records } = parseBottleofItalyProducts([
      rowWith({ title: 'Vino Rosso 0,7 l', tags: ['75cl'] }),
    ]);
    expect(records[0].volumeMl).toBe(700);
  });

  it('falls back to the whole-tag volume when the title carries no token', () => {
    const { records } = parseBottleofItalyProducts([
      rowWith({ title: 'Barolo DOCG', tags: ['custom-gradazione-14-0', '75cl'] }),
    ]);
    expect(records[0].volumeMl).toBe(750);
  });

  it('lands on the honest 0 ml when no source has a token — never a guess', () => {
    const { records } = parseBottleofItalyProducts([
      rowWith({ title: 'Barbaresco DOCG', tags: ['custom-gradazione-13-5'] }),
    ]);
    expect(records[0].volumeMl).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Correction queue — category drops and kept-with-correction rows
// ---------------------------------------------------------------------------

describe('correction queue', () => {
  /**
   * A minimal valid spirits-family row with a chosen product_type.
   * Tags default to empty — the live merch reality (ABV carries no
   * gradazione tag), so unmapped types drop on the null-ABV path.
   */
  function rowOfType(
    product_type: string | null,
    tags: readonly string[] = [],
  ): Record<string, unknown> {
    return {
      id: 829998,
      title: 'Mystery Item 0,5 l',
      product_type,
      vendor: 'Test Vendor',
      tags,
      variants: [
        { title: 'Default Title', sku: 'MYSTERY-500', grams: 500, price: '9.90', available: true },
      ],
    };
  }

  it('drops the merch pair naming the unmappable product_type (design D3/D8)', () => {
    const { records, errors } = parseBottleofItalyProducts([
      rowOfType('Olio'),
      rowOfType('Aceto'),
    ]);
    expect(records).toHaveLength(0);
    // Each dropped row carries its riding SKU correction plus the
    // category drop (the alks error order).
    expect(errors).toHaveLength(4);
    const drops = errors.filter((error) => error.includes('maps to no canonical'));
    expect(drops).toHaveLength(2);
    expect(drops[0]).toContain('product_type "Olio"');
    expect(drops[1]).toContain('product_type "Aceto"');
  });

  it('drops the deliberately-unmapped set: Altro, Gadget, Buoni regalo, bare Vino', () => {
    const { records, errors } = parseBottleofItalyProducts([
      rowOfType('Altro'),
      rowOfType('Gadget'),
      rowOfType('Buoni regalo'),
      rowOfType('Vino'),
    ]);
    expect(records).toHaveLength(0);
    const drops = errors.filter((error) => error.includes('maps to no canonical'));
    expect(drops).toHaveLength(4);
    expect(drops[0]).toContain('"Altro"');
    expect(drops[1]).toContain('"Gadget"');
    expect(drops[2]).toContain('"Buoni regalo"');
    expect(drops[3]).toContain('"Vino"');
  });

  it('drops rows with a missing product_type, naming the structural gap', () => {
    const { records, errors } = parseBottleofItalyProducts([rowOfType(null), rowOfType('')]);
    expect(records).toHaveLength(0);
    const drops = errors.filter((error) => error.includes('product_type is missing'));
    expect(drops).toHaveLength(2);
  });

  it('keeps a beverage above the 22 % boundary even on the unmapped Altro type (the ABV-guarded mapper)', () => {
    // mapSourceCategory's boundary rule: above 22 % the fermented
    // buckets are not lawful retail categories — the unmapped type
    // resolves to spirits under the boundary rule (the alks parser
    // discipline this parser inherits), never a silent merch drop of
    // a proven-40 % product.
    const { records, errors } = parseBottleofItalyProducts([
      rowOfType('Altro', ['custom-gradazione-40-0']),
    ]);
    expect(errors).toHaveLength(1); // the SKU correction only
    expect(records[0].category).toBe('spirits');
  });

  it('holds a no-tag beverage row with the machine-readable hold reason, kept', () => {
    const { records, errors } = parseBottleofItalyProducts([
      {
        id: 829997,
        title: 'Vino Bianco 0,75 l',
        product_type: 'Vino Bianco',
        vendor: 'Test Vendor',
        tags: ['vino'],
        variants: [
          { title: 'Default Title', sku: 'BIANCO-75', grams: 1250, price: '11.90', available: true },
        ],
      },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].alcoholByVolume).toBeNull();
    expect(records[0].category).toBe('other_fermented');
    expect(records[0].reviewHoldReason).toBe('nonalcoholic_in_alcohol_category');
    const hold = errors.find((error) => error.includes('Held for review'));
    expect(hold).toBeDefined();
    expect(hold).toContain('nonalcoholic_in_alcohol_category');
  });

  it('keeps a non-matching SKU EAN-less and names the SKU and the accepted forms', () => {
    const { records, errors } = parseBottleofItalyProducts([
      rowOfType('Spirits', ['custom-gradazione-40-0']),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('SKU "MYSTERY-500" does not match any accepted');
    expect(errors[0]).toContain('record kept without an EAN');
  });

  it('emits no SKU correction when the variant carries no SKU at all', () => {
    const { records, errors } = parseBottleofItalyProducts([
      {
        id: 829996,
        title: 'Grappa 0,5 l',
        product_type: 'Spirits',
        vendor: 'Test Vendor',
        tags: ['custom-gradazione-40-0'],
        variants: [
          { title: 'Default Title', sku: null, grams: 500, price: '19.90', available: true },
        ],
      },
    ]);
    expect(records).toHaveLength(1);
    // productId falls back to the Shopify product id; SKU-less rows
    // are simply EAN-less without a correction line.
    expect(records[0].productId).toBe('829996');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Structural drops — always named, never thrown
// ---------------------------------------------------------------------------

describe('structural drops', () => {
  it('rejects a non-array payload', () => {
    const { records, errors } = parseBottleofItalyProducts({
      products: [],
    } as unknown as readonly unknown[]);
    expect(records).toHaveLength(0);
    expect(errors).toEqual([
      'bottleofitaly payload is not a JSON array of products.json products',
    ]);
  });

  it('drops a non-object row', () => {
    const { records, errors } = parseBottleofItalyProducts([42]);
    expect(records).toHaveLength(0);
    expect(errors).toEqual(['bottleofitaly product row is not a JSON object']);
  });

  it('drops a row with no title', () => {
    const { records, errors } = parseBottleofItalyProducts([
      {
        id: 829995,
        title: '  ',
        product_type: 'Spirits',
        vendor: 'V',
        tags: [],
        variants: [
          { title: 'Default Title', sku: null, grams: 1, price: '1.00', available: true },
        ],
      },
    ]);
    expect(records).toHaveLength(0);
    expect(errors[0]).toContain('missing or empty product title');
  });

  it('drops a row with no variants — nothing to price', () => {
    const { records, errors } = parseBottleofItalyProducts([
      {
        id: 829994,
        title: 'Ghost Product',
        product_type: 'Spirits',
        vendor: 'V',
        tags: [],
        variants: [],
      },
    ]);
    expect(records).toHaveLength(0);
    expect(errors[0]).toContain('has no variants');
  });

  it('drops a row with an unusable price string', () => {
    const { records, errors } = parseBottleofItalyProducts([
      {
        id: 829993,
        title: 'Grappa 0,5 l',
        product_type: 'Spirits',
        vendor: 'V',
        tags: ['custom-gradazione-40-0'],
        variants: [
          { title: 'Default Title', sku: null, grams: 500, price: '19,90', available: true },
        ],
      },
    ]);
    expect(records).toHaveLength(0);
    expect(errors[0]).toContain('missing or invalid decimal price "19,90"');
  });
});

// ---------------------------------------------------------------------------
// Variant and merchant mapping — grams, availability, vendor, handle
// ---------------------------------------------------------------------------

describe('variant and merchant mapping', () => {
  function parseOne(variant: Record<string, unknown>, product: Record<string, unknown> = {}) {
    return parseBottleofItalyProduct({
      id: 829992,
      title: 'Grappa 0,5 l',
      handle: 'grappa-05-l',
      product_type: 'Spirits',
      vendor: 'Test Vendor',
      tags: ['custom-gradazione-40-0'],
      variants: [variant],
      ...product,
    });
  }

  it('maps grams straight through; unusable or absent grams → null without an error (design D7)', () => {
    expect(parseOne({ sku: null, grams: 750, price: '19.90', available: true })
      .record?.weightGrams).toBe(750);
    expect(parseOne({ sku: null, grams: 0, price: '19.90', available: true })
      .record?.weightGrams).toBeNull();
    expect(parseOne({ sku: null, price: '19.90', available: true })
      .record?.weightGrams).toBeNull();
    // Weight never errors — no correction lines for any of the above.
    expect(parseOne({ sku: null, grams: 0, price: '19.90', available: true }).errors).toEqual([]);
  });

  it('maps the variant available flag: true → in_stock, false → out_of_stock, absent → unknown', () => {
    expect(parseOne({ sku: null, price: '19.90', available: true })
      .record?.availability).toBe('in_stock');
    expect(parseOne({ sku: null, price: '19.90', available: false })
      .record?.availability).toBe('out_of_stock');
    expect(parseOne({ sku: null, price: '19.90' }).record?.availability).toBe('unknown');
  });

  it('maps vendor to both manufacturer and brand; a missing vendor keeps the empty-brand key', () => {
    expect(parseOne({ sku: null, price: '19.90', available: true }).record?.brand).toBe('Test Vendor');
    expect(parseOne({ sku: null, price: '19.90', available: true }).record?.manufacturer).toBe('Test Vendor');
    const noVendor = parseBottleofItalyProduct({
      id: 829991,
      title: 'Grappa 0,5 l',
      product_type: 'Spirits',
      tags: ['custom-gradazione-40-0'],
      variants: [{ sku: null, price: '19.90', available: true }],
    });
    expect(noVendor.record?.brand).toBe('');
    expect(noVendor.record?.manufacturer).toBe('');
  });

  it('builds sourceUrl from the handle; a missing handle → null', () => {
    expect(parseOne({ sku: null, price: '19.90', available: true }).record?.sourceUrl).toBe(
      'https://bottleofitaly.com/products/grappa-05-l',
    );
    const noHandle = parseBottleofItalyProduct({
      id: 829990,
      title: 'Grappa 0,5 l',
      handle: null,
      product_type: 'Spirits',
      tags: ['custom-gradazione-40-0'],
      variants: [{ sku: null, price: '19.90', available: true }],
    });
    expect(noHandle.record?.sourceUrl).toBeNull();
  });

  it('carries depositSystem false and the CHECK-safe container default on every row', () => {
    const { records } = parseBottleofItalyProducts(BOTTLEOFITALY_GOLDEN_PAYLOAD.products);
    for (const record of records) {
      expect(record.depositSystem).toBe(false);
      expect(record.containerType).toBe('other');
      expect(record.packCount).not.toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Per-row function identity — the plural is the row loop
// ---------------------------------------------------------------------------

describe('parseBottleofItalyProduct — per-row identity', () => {
  it('matches the plural loop output for a single golden row', () => {
    const single = parseBottleofItalyProduct(BOTTLEOFITALY_GOLDEN_PAYLOAD.products[0]);
    const plural = parseBottleofItalyProducts([BOTTLEOFITALY_GOLDEN_PAYLOAD.products[0]]);
    expect(single).toEqual({
      record: plural.records[0],
      errors: plural.errors,
    });
  });
});
