/**
 * kuhns.shop products.json parser tests (task 3.2, change
 * onboard-shopify-lmdw-merchants).
 *
 * The golden fixture IS the payload contract (the alks/araxes pattern):
 * eight rows pin every parser branch the 1.2 sweep measured — the
 * strict `alc. 12 Vol.-%` ABV form, the comma-decimal `0,75l` volume,
 * the multipack `24x0,02l` (per-unit volume + packCount, never
 * multiplied), the range-ABV ESTIMATED path (neither bound parsed), the
 * 93.7 % empty-`product_type` bucket riding title inference, the
 * product_type-vs-title contradiction gate, the deliberately-unmapped
 * merch drop, the `alc. 0,0 Vol.-%` hygiene hold, the unitless `1,0
 * Ltr.` volume miss, and the 100 % EAN-less ML-SKU reality. Inline rows
 * pin the strict-form misses, decimal-price branches, and structural
 * drops on top.
 *
 * @module KuhnsParserTest
 */
import { describe, it, expect } from 'vitest';
import {
  parseKuhnsProduct,
  parseKuhnsProducts,
} from '../adapters/kuhns.parser';
import {
  KUHNS_GOLDEN_PAYLOAD,
  KUHNS_GOLDEN_PRODUCTS,
} from '../adapters/__fixtures__/kuhns-products.fixture';

describe('parseKuhnsProducts — golden dataset (sweep §1.2)', () => {
  const { records, errors } = parseKuhnsProducts(KUHNS_GOLDEN_PAYLOAD);

  it('keeps six of eight golden rows and reports twelve per-row corrections', () => {
    // Kept: rows 1, 2, 3, 4, 7, 8. Dropped: the contradiction (row 5)
    // and the unmapped merch term (row 6). Errors: the EAN-less SKU
    // correction on all eight rows (corrections accumulate even on
    // dropped rows) + the two hygiene holds + the two drops.
    expect(records).toHaveLength(6);
    expect(errors).toHaveLength(12);
  });

  it('produces exactly these canonical records (designs D2/D3)', () => {
    expect(records).toEqual([
      // Typed `Wein` row: `alc. 12 Vol.-%` → 0.12, `0,75l` → 750 ml,
      // house vendor verbatim, grams integer, handle-built sourceUrl.
      expect.objectContaining({
        productId: 'ML9501',
        productName: 'Kuhns Riesling trocken alc. 12 Vol.-% 0,75l',
        category: 'wine_still',
        regulatoryClassification: 'wine_still',
        alcoholByVolume: 0.12,
        volumeMl: 750,
        packCount: null,
        containerType: 'other',
        brand: 'Kuhns Trinkgenuss',
        manufacturer: 'Kuhns Trinkgenuss',
        weightGrams: 1250,
        availability: 'in_stock',
        sourceUrl: 'https://kuhns.shop/products/kuhns-riesling-trocken',
        ean: null,
      }),
      // The untyped majority: empty product_type, `Whisky` title token
      // → spirits (design D3 correction); real-brand vendor verbatim;
      // no grams → null without an error.
      expect.objectContaining({
        productId: 'ML4021',
        category: 'spirits',
        alcoholByVolume: 45.8 / 100,
        volumeMl: 700,
        brand: 'Talisker',
        manufacturer: 'Talisker',
        weightGrams: null,
        sourceUrl: 'https://kuhns.shop/products/talisker-10-years-single-malt',
      }),
      // Multipack: `24x0,02l` → packCount 24 with PER-UNIT 20 ml —
      // never 24 × 20 ml; missing handle → null sourceUrl; available
      // false → out_of_stock.
      expect.objectContaining({
        productId: 'ML7730',
        category: 'spirits',
        alcoholByVolume: 0.4,
        volumeMl: 20,
        packCount: 24,
        availability: 'out_of_stock',
        sourceUrl: null,
        brand: 'Kuhns-onlineshop',
      }),
      // Range ABV `4,9-6,0 Vol.-%`: NEITHER bound parsed — kept with
      // null ABV through the ESTIMATED path; multipack 12 × 330 ml.
      // Mapped `Bier` and the title token agree, and with the ABV
      // unparseable the live guard holds the agreed outcome: re-keyed
      // non-alcoholic with the review hold (the row still ingests).
      expect.objectContaining({
        productId: 'ML8104',
        category: 'other_fermented',
        regulatoryClassification: 'other_fermented',
        alcoholByVolume: null,
        volumeMl: 330,
        packCount: 12,
        reviewHoldReason: 'nonalcoholic_in_alcohol_category',
      }),
      // `alc. 0,0 Vol.-%` with the `Sekt` title token: keyed-zero ABV,
      // guard re-keys sparkling → non-alcoholic tax key with the hold.
      expect.objectContaining({
        productId: 'ML6620',
        category: 'other_fermented',
        regulatoryClassification: 'other_fermented',
        alcoholByVolume: 0,
        volumeMl: 750,
        reviewHoldReason: 'nonalcoholic_in_alcohol_category',
      }),
      // Unitless `1,0 Ltr.`: volume stays 0 through the ESTIMATED path
      // — the bare decimal is never guessed into millilitres.
      expect.objectContaining({
        productId: 'ML3305',
        category: 'wine_still',
        alcoholByVolume: 0.125,
        volumeMl: 0,
        packCount: null,
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

  it('reports the EAN-less ML-SKU on every row, naming the accepted forms', () => {
    const eanCorrections = errors.filter((message) =>
      message.includes('does not match any accepted'),
    );
    // All eight rows carry ML-shaped SKUs; corrections accumulate even
    // on the two dropped rows.
    expect(eanCorrections).toHaveLength(8);
    for (const message of eanCorrections) {
      expect(message).toContain('record kept without an EAN');
      expect(message).toContain('correction queue');
    }
    expect(errors[0]).toContain('ML9501');
  });

  it('reports the contradiction naming both sides', () => {
    const contradiction = errors.find((message) =>
      message.includes('never silently resolved'),
    );
    expect(contradiction).toBeDefined();
    expect(contradiction).toContain('ML9002');
    expect(contradiction).toContain('spirits');
    expect(contradiction).toContain('wine_still');
  });

  it('reports the unmapped merch row naming the missing canonical category', () => {
    const dropped = errors.find((message) =>
      message.includes('no canonical beverage category'),
    );
    expect(dropped).toBeDefined();
    expect(dropped).toContain('ML5510');
    expect(dropped).toContain('correction queue');
  });

  it('reports each held row naming it and the hold reason', () => {
    const held = errors.filter((message) => message.startsWith('Held for review'));
    // The keyed-zero `Sekt` row and the range-ABV `Bier` row (unparseable
    // ABV in an alcohol category — the live hygiene rule, alks precedent).
    expect(held).toHaveLength(2);
    for (const message of held) {
      expect(message).toContain('nonalcoholic_in_alcohol_category');
      expect(message).toContain('correction queue');
    }
    expect(held.find((message) => message.includes('ML6620'))).toContain('ABV is 0');
    expect(held.find((message) => message.includes('ML8104'))).toContain(
      'ABV is unparseable',
    );
  });

  it('golden fixture stays exhaustive — every fixture row is mapped or reported', () => {
    const mapped = new Set(records.map((r) => r.productId));
    const reported = new Set(
      errors.map((e) => e.match(/kuhns product \d+ \(SKU ([^)]+)\)/)?.[1]).filter(Boolean),
    );
    for (const product of KUHNS_GOLDEN_PRODUCTS) {
      const sku = product.variants[0]?.sku ?? '';
      expect(mapped.has(sku) || reported.has(sku)).toBe(true);
    }
  });

  it('containerType stays inside the product_master CHECK vocabulary (migration 0002)', () => {
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

// ---------------------------------------------------------------------------
// Strict ABV form — the sweep's parse/no-parse boundary
// ---------------------------------------------------------------------------

describe('parseKuhnsProduct — strict `alc. N Vol.-%` ABV (design D2)', () => {
  function rowWith(title: string): Record<string, unknown> {
    return {
      id: 1,
      title,
      product_type: 'Whisky',
      vendor: 'V',
      variants: [{ sku: 'ML1', price: '10.00', available: true }],
    };
  }

  it('spec: `alc. 12 Vol.-%` → 0.12 and comma decimals normalize', () => {
    const { record } = parseKuhnsProduct(rowWith('Test alc. 12 Vol.-% 0,7l'));
    expect(record?.alcoholByVolume).toBe(0.12);

    const comma = parseKuhnsProduct(rowWith('Test alc. 45,8 Vol.-% 0,7l'));
    expect(comma.record?.alcoholByVolume).toBeCloseTo(0.458, 10);

    const dot = parseKuhnsProduct(rowWith('Test alc. 40.5 Vol.-% 0,7l'));
    expect(dot.record?.alcoholByVolume).toBeCloseTo(0.405, 10);
  });

  it('spec: range forms parse NEITHER bound — the record rides the ESTIMATED path', () => {
    // The sweep's attested range shapes; a midpoint pick would be a
    // guess, so the strict pattern rejects them structurally. With the
    // ABV unparseable in an alcohol category, the live guard holds the
    // row (it still ingests — the ESTIMATED-status contract).
    for (const title of [
      'Test alc. 40,5-46 Vol.-% 0,7l',
      'Test alc. 4,9/6,0 Vol.-% 0,33l',
      'Test alc. 15-17 Vol.-% 0,5l',
    ]) {
      const { record, errors } = parseKuhnsProduct(rowWith(title));
      expect(record, title).not.toBeNull();
      expect(record?.alcoholByVolume, title).toBeNull();
      expect(record?.volumeMl, title).toBeGreaterThan(0);
      // The ABV miss itself never errors — the corrections are the
      // EAN-less SKU line and the hygiene hold for the unparseable ABV.
      expect(errors, title).toHaveLength(2);
      expect(errors.find((message) => message.includes('does not match any accepted'))).toBeDefined();
      expect(
        errors.find((message) => message.startsWith('Held for review')),
        title,
      ).toContain('ABV is unparseable');
    }
  });

  it('the other strict-form misses stay unparsed and kept (sweep §1.2)', () => {
    for (const title of [
      'Test alc 36 Vol.-% 0,7l', // no dot after alc
      'Test alc. 40 Vol. 0,7l', // no -% suffix
      'Test 63,5 Vol.-% 0,7l', // no alc. prefix
    ]) {
      const { record } = parseKuhnsProduct(rowWith(title));
      expect(record, title).not.toBeNull();
      expect(record?.alcoholByVolume, title).toBeNull();
    }
  });

  it('a keyed 0,0 % is a real value, not a miss', () => {
    const { record } = parseKuhnsProduct(rowWith('Test alc. 0,0 Vol.-% 0,75l'));
    expect(record?.alcoholByVolume).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Volume — comma decimals, multipack per-unit convention, unitless misses
// ---------------------------------------------------------------------------

describe('parseKuhnsProduct — title volume (design D2)', () => {
  // `product_type: 'Whisky'` keeps every row classified so the volume
  // assertions are unaffected by category drops; all titles carry a
  // parseable ABV, so the hygiene hold never interferes.
  function rowWith(title: string): Record<string, unknown> {
    return {
      id: 1,
      title,
      product_type: 'Whisky',
      vendor: 'V',
      variants: [{ sku: 'ML1', price: '10.00', available: true }],
    };
  }

  it('spec: `0,75l` → 750 and the unit scale applies', () => {
    expect(parseKuhnsProduct(rowWith('Test alc. 12 Vol.-% 0,75l')).record?.volumeMl).toBe(750);
    expect(parseKuhnsProduct(rowWith('Test alc. 12 Vol.-% 0,7l')).record?.volumeMl).toBe(700);
    expect(parseKuhnsProduct(rowWith('Test alc. 12 Vol.-% 50cl')).record?.volumeMl).toBe(500);
    expect(parseKuhnsProduct(rowWith('Test alc. 12 Vol.-% 330ml')).record?.volumeMl).toBe(330);
    expect(parseKuhnsProduct(rowWith('Test alc. 12 Vol.-% 1L')).record?.volumeMl).toBe(1000);
  });

  it('spec: multipack `24x0,02l` → packCount 24 with PER-UNIT volume 20 ml', () => {
    // The RawFeedRecord multipack contract: volumeMl stays PER UNIT,
    // never multiplied by the pack count.
    const { record } = parseKuhnsProduct(rowWith('Test Kalender alc. 40 Vol.-% 24x0,02l'));
    expect(record?.volumeMl).toBe(20);
    expect(record?.packCount).toBe(24);

    const cl = parseKuhnsProduct(rowWith('Test Paket alc. 5 Vol.-% 12x0,33l'));
    expect(cl.record?.volumeMl).toBe(330);
    expect(cl.record?.packCount).toBe(12);

    const ml = parseKuhnsProduct(rowWith('Test alc. 5 Vol.-% 25x20ml'));
    expect(ml.record?.volumeMl).toBe(20);
    expect(ml.record?.packCount).toBe(25);
  });

  it('spec: unitless `0,7` and `1,0 Ltr.` forms stay 0 — no unambiguous unit token', () => {
    for (const title of [
      'Test alc. 40 Vol.-% 0,7',
      'Test alc. 12 Vol.-% 1,0 Ltr.',
    ]) {
      const { record } = parseKuhnsProduct(rowWith(title));
      expect(record, title).not.toBeNull();
      expect(record?.volumeMl, title).toBe(0);
      expect(record?.packCount, title).toBeNull();
    }
  });

  it('an absent volume token keeps the record with volumeMl 0 (design D3)', () => {
    const { record, errors } = parseKuhnsProduct(rowWith('Test alc. 40 Vol.-%'));
    expect(record).not.toBeNull();
    expect(record?.volumeMl).toBe(0);
    // The volume miss never errors; the SKU correction is the only line.
    expect(errors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Category resolution — the 93.7 % untyped bucket, the gate, the queue
// ---------------------------------------------------------------------------

describe('parseKuhnsProduct — product_type first, title tokens second (design D3)', () => {
  const BASE = {
    id: 1,
    vendor: 'V',
    variants: [{ sku: 'ML1', price: '10.00', available: true }],
  };

  it('spec: an untyped title classifies through its beverage token', () => {
    const whisky = parseKuhnsProduct({
      ...BASE,
      title: 'Talisker 10 Years Single Malt Scotch Whisky alc. 45,8 Vol.-% 0,7l',
      product_type: '',
    });
    expect(whisky.record?.category).toBe('spirits');

    const sekt = parseKuhnsProduct({
      ...BASE,
      title: 'Kuhns Riesling Sekt brut alc. 12 Vol.-% 0,75l',
      product_type: '',
    });
    expect(sekt.record?.category).toBe('wine_sparkling');

    const bier = parseKuhnsProduct({
      ...BASE,
      title: 'Kuhns Bier alc. 5,2 Vol.-% 0,5l',
      product_type: '',
    });
    expect(bier.record?.category).toBe('beer');

    const likör = parseKuhnsProduct({
      ...BASE,
      title: 'Kuhns Likör alc. 20 Vol.-% 0,5l',
      product_type: '',
    });
    expect(likör.record?.category).toBe('spirits');
  });

  it('a word-bounded token scan does not match German compounds', () => {
    // "Weinbrand", "Kräuterlikör" and "Landbier" carry the type word
    // inside a compound; stemming compounds would be a guess machine,
    // so the word-bounded scan leaves those rows to the correction
    // queue — the honest miss.
    for (const title of [
      'Weinbrand alc. 38 Vol.-% 0,7l',
      'Kräuterlikör alc. 30 Vol.-% 0,5l',
      'Landbier alc. 5,2 Vol.-% 0,5l',
    ]) {
      const { record, errors } = parseKuhnsProduct({
        ...BASE,
        title,
        product_type: '',
      });
      expect(record, title).toBeNull();
      expect(
        errors.find((message) =>
          message.includes('no canonical beverage category'),
        ),
        title,
      ).toBeDefined();
    }
  });

  it('spec: a mapped product_type and a disagreeing title token drop the row', () => {
    const { record, errors } = parseKuhnsProduct({
      ...BASE,
      title: 'Kuhns Geschenkset Wein und Whisky alc. 40 Vol.-% 0,7l',
      product_type: 'Wein',
    });
    expect(record).toBeNull();
    // Corrections accumulate: the EAN-less SKU line rides along with
    // the contradiction.
    expect(errors).toHaveLength(2);
    const contradiction = errors.find((message) =>
      message.includes('never silently resolved'),
    );
    expect(contradiction).toContain('name implies spirits but product_type implies wine_still');
  });

  it('agreeing sources agree: a mapped type with a matching token keeps the row', () => {
    const { record, errors } = parseKuhnsProduct({
      ...BASE,
      title: 'Kuhns Riesling Wein alc. 12 Vol.-% 0,75l',
      product_type: 'Wein',
    });
    expect(record).not.toBeNull();
    expect(record?.category).toBe('wine_still');
    // Only the EAN-less SKU correction.
    expect(errors).toHaveLength(1);
  });

  it('spec: no inference at all drops the row naming the missing canonical category', () => {
    const { record, errors } = parseKuhnsProduct({
      ...BASE,
      title: 'Kuhns Bio Direktsaft Apfel naturtrüb 1,0l',
      product_type: 'Bio Direktsaft',
    });
    expect(record).toBeNull();
    expect(
      errors.find((message) => message.includes('no canonical beverage category')),
    ).toBeDefined();
  });

  it('the untyped rows with no title token drop into the queue too', () => {
    const { record } = parseKuhnsProduct({
      ...BASE,
      title: 'Kuhns Geschenkbox ohne Inhalt',
      product_type: '',
    });
    expect(record).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Prices — decimal-string cents, structural guards
// ---------------------------------------------------------------------------

describe('parseKuhnsProduct — prices and structural guards', () => {
  it('spec: Shopify decimal strings become integer cents by string math', () => {
    const twoDecimals = parseKuhnsProduct({
      id: 1,
      title: 'T Whisky alc. 40 Vol.-% 0,7l',
      product_type: '',
      vendor: 'V',
      variants: [{ sku: 'ML1', price: '42.90', available: true }],
    });
    expect(twoDecimals.record?.priceCents).toBe(4290);

    const oneDecimal = parseKuhnsProduct({
      id: 1,
      title: 'T Whisky alc. 40 Vol.-% 0,7l',
      product_type: '',
      vendor: 'V',
      variants: [{ sku: 'ML1', price: '42.9', available: true }],
    });
    expect(oneDecimal.record?.priceCents).toBe(4290);

    const whole = parseKuhnsProduct({
      id: 1,
      title: 'T Whisky alc. 40 Vol.-% 0,7l',
      product_type: '',
      vendor: 'V',
      variants: [{ sku: 'ML1', price: '89', available: true }],
    });
    expect(whole.record?.priceCents).toBe(8900);
  });

  it('drops rows with no usable variant, unusable price, or no title — always named', () => {
    const noVariant = parseKuhnsProduct({
      id: 7,
      title: 'T Whisky alc. 40 Vol.-% 0,7l',
      product_type: '',
      vendor: 'V',
      variants: [],
    });
    expect(noVariant.record).toBeNull();
    expect(noVariant.errors[0]).toContain('kuhns product 7');
    expect(noVariant.errors[0]).toContain('no usable product variant');

    const badPrice = parseKuhnsProduct({
      id: 8,
      title: 'T Whisky alc. 40 Vol.-% 0,7l',
      product_type: '',
      vendor: 'V',
      variants: [{ sku: 'ML1', price: '29,90', available: true }],
    });
    expect(badPrice.record).toBeNull();
    expect(badPrice.errors[0]).toContain('missing or invalid decimal price "29,90"');

    const noTitle = parseKuhnsProduct({
      id: 9,
      title: '',
      product_type: 'Wein',
      vendor: 'V',
      variants: [{ sku: 'ML1', price: '9.90', available: true }],
    });
    expect(noTitle.record).toBeNull();
    expect(noTitle.errors[0]).toContain('missing or empty product title');
  });

  it('a non-object row drops with the structural error', () => {
    const { record, errors } = parseKuhnsProduct('nope');
    expect(record).toBeNull();
    expect(errors).toEqual(['kuhns product row is not a JSON object']);
  });

  it('a non-array payload yields no records and the payload-level error', () => {
    const { records, errors } = parseKuhnsProducts({ products: [] });
    expect(records).toEqual([]);
    expect(errors).toEqual(['kuhns payload is not a JSON array of Shopify products']);
  });
});
