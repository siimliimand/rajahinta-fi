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

  it('maps seven golden rows and reports six per-row corrections', () => {
    expect(records).toHaveLength(7);
    expect(errors).toHaveLength(6);
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
      // Unparseable name: record kept with the unparsed fields null/0 —
      // and, because the category maps to beer (an alcohol category),
      // held by the non-alcoholic guard: re-keyed non-alcoholic with the
      // review hold and a correction error (change
      // nonalcoholic-catalog-hygiene).
      expect.objectContaining({
        productId: 'ee-6410000000009',
        ean: '6410000000009',
        category: 'other_fermented',
        regulatoryClassification: 'other_fermented',
        alcoholByVolume: null,
        volumeMl: 0,
        containerType: 'other',
        availability: 'out_of_stock',
        weightGrams: null,
        reviewHoldReason: 'nonalcoholic_in_alcohol_category',
      }),
      // Guard rows 6–8: the live non-alcoholic drift shapes — each
      // ingests re-keyed to the non-alcoholic tax key with the review
      // hold (change nonalcoholic-catalog-hygiene).
      expect.objectContaining({
        productId: 'fi-9016290000018',
        productName: 'Red Bull Sugarfree tölkki 0,355 l',
        category: 'other_fermented',
        alcoholByVolume: null,
        volumeMl: 355,
        containerType: 'can',
        weightGrams: 370,
        brand: 'Red Bull',
        reviewHoldReason: 'nonalcoholic_in_alcohol_category',
      }),
      expect.objectContaining({
        productId: 'se-7310870004017',
        productName: 'Ramlösa Citrus 0,5 l pullo',
        category: 'other_fermented',
        alcoholByVolume: null,
        volumeMl: 500,
        containerType: 'bottle',
        weightGrams: 550,
        reviewHoldReason: 'nonalcoholic_in_alcohol_category',
      }),
      expect.objectContaining({
        productId: 'fi-6410405001235',
        productName: 'Kirsikkamehu 1 l',
        category: 'other_fermented',
        alcoholByVolume: null,
        volumeMl: 1000,
        containerType: 'other',
        weightGrams: null,
        reviewHoldReason: 'nonalcoholic_in_alcohol_category',
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
    expect(errors[2]).toContain('756334');
    expect(errors[2]).toContain('de-4006421333909');
    expect(errors[2]).toContain('beer');
    expect(errors[2]).toContain('wine_still');
    expect(errors[2]).toContain('correction queue');
  });

  it('reports each held non-alcoholic row naming it and the hold reason', () => {
    const held = errors.filter((message) => message.startsWith('Held for review'));
    expect(held).toHaveLength(4);
    for (const message of held) {
      expect(message).toContain('nonalcoholic_in_alcohol_category');
      expect(message).toContain('correction queue');
    }
    expect(held[0]).toContain('756333');
    expect(held[1]).toContain('756335');
    expect(held[2]).toContain('756336');
    expect(held[3]).toContain('756337');
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
    // The unparsed field stays null — and, since the category maps to
    // beer, the non-alcoholic guard holds the row with a correction
    // error instead of letting it into the alcohol catalog (change
    // nonalcoholic-catalog-hygiene).
    expect(record).not.toBeNull();
    expect(record?.alcoholByVolume).toBeNull();
    expect(record?.volumeMl).toBe(0);
    expect(record?.reviewHoldReason).toBe('nonalcoholic_in_alcohol_category');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Held for review');
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

describe('parseAlksStoreProduct — ABV-guarded category (first-impression-pass 1.2)', () => {
  // Minimal row: the category source and the name-embedded ABV are the
  // only variables — a 41 % "Muut juomat" row is the audited
  // misclassification shape (keyword bucket → other_fermented before
  // the guard existed).
  const guardRow = (id: number, name: string, categoryName: string) => ({
    id,
    name,
    sku: `fi-6410400${String(id).padStart(6, '0')}`,
    permalink: `https://alks.fi/product/guard-${id}/`,
    prices: { price: '1899', currency_code: 'EUR' },
    categories: [{ name: categoryName }],
    is_in_stock: true,
  });

  it('above-boundary keyword residue ("Muut juomat", 41 % akvavit) re-keys to spirits — the 00:00 UTC cron cannot re-misclassify', () => {
    const { record, errors } = parseAlksStoreProduct(
      guardRow(756400, 'Lignell Akvavit 41% 0,5 l', 'Muut juomat'),
    );
    expect(errors).toEqual([]);
    expect(record?.category).toBe('spirits');
    expect(record?.regulatoryClassification).toBe('spirits');
    expect(record?.alcoholByVolume).toBe(0.41);
  });

  it('arrak 58 % under the same keyword bucket re-keys to spirits', () => {
    const { record, errors } = parseAlksStoreProduct(
      guardRow(756401, 'Arrak 58% 0,5 l', 'Muut juomat'),
    );
    expect(errors).toEqual([]);
    expect(record?.category).toBe('spirits');
  });

  it('sambuca 38 % under "Juomasekoitus" re-keys — the long-drink bucket is capped too', () => {
    const { record, errors } = parseAlksStoreProduct(
      guardRow(756402, 'Antica Sambuca 38% 0,7 l', 'Juomasekoitus'),
    );
    expect(errors).toEqual([]);
    expect(record?.category).toBe('spirits');
  });

  it('below-boundary "Muut juomat" keeps the honest fermented bucket', () => {
    const { record, errors } = parseAlksStoreProduct(
      guardRow(756403, 'Marjasekoitus 4,7% 0,33 l', 'Muut juomat'),
    );
    expect(errors).toEqual([]);
    expect(record?.category).toBe('other_fermented');
  });

  it('unparseable ABV leaves the guard unkeyed — the fermented bucket stands (honest unknown)', () => {
    const { record, errors } = parseAlksStoreProduct(
      guardRow(756404, 'Juomasekoitus 0,5 l', 'Muut juomat'),
    );
    expect(errors).toEqual([]);
    expect(record?.category).toBe('other_fermented');
    expect(record?.alcoholByVolume).toBeNull();
  });

  it('spirit-family keyword category maps to spirits at any ABV — a keyword outcome, never boundary-attributed', () => {
    const { record, errors } = parseAlksStoreProduct(
      guardRow(756405, 'Anker Akvavit 37% 0,5 l', 'Akvavit'),
    );
    expect(errors).toEqual([]);
    expect(record?.category).toBe('spirits');
  });

  it('a boundary-guarded category can still contradict a name token — the disagreement drops to the correction queue', () => {
    // 41 % "Muut juomat" resolves to spirits (boundary), the name token
    // 'olut' resolves to beer — different tax keys, never silently picked.
    const { record, errors } = parseAlksStoreProduct(
      guardRow(756406, 'Olut 41% 0,5 l', 'Muut juomat'),
    );
    expect(record).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('spirits');
    expect(errors[0]).toContain('beer');
    expect(errors[0]).toContain('correction queue');
  });
});

// ---------------------------------------------------------------------------
// Non-alcoholic ingestion guard (change nonalcoholic-catalog-hygiene,
// design D3) — spec scenarios of the data-acquisition delta
// ---------------------------------------------------------------------------

describe('parseAlksStoreProduct — non-alcoholic rows barred from alcohol categories', () => {
  /** Minimal row builder: the category source and the name vary. */
  const row = (id: number, name: string, categoryName: string) => ({
    id,
    name,
    sku: `fi-6410400${String(id).padStart(6, '0')}`,
    permalink: `https://alks.fi/product/guard-${id}/`,
    prices: { price: '299', currency_code: 'EUR' },
    categories: [{ name: categoryName }],
    is_in_stock: true,
  });

  it('scenario: zero-ABV row is held from alcohol categories', () => {
    // Karhu 0,0 — genuinely alcohol-branded, but with nothing for the
    // landed-cost engine to compute: held for review, never published
    // into beer (design risk note).
    const { record, errors } = parseAlksStoreProduct(
      row(756420, 'Karhu 0,0% 0,33 l tölkki', 'Olut'),
    );
    expect(record).not.toBeNull();
    expect(record?.alcoholByVolume).toBe(0);
    expect(record?.category).toBe('other_fermented');
    expect(record?.regulatoryClassification).toBe('other_fermented');
    expect(record?.reviewHoldReason).toBe('nonalcoholic_in_alcohol_category');
    expect(record?.volumeMl).toBe(330);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ABV is 0');
    expect(errors[0]).toContain('nonalcoholic_in_alcohol_category');
    expect(errors[0]).toContain('correction queue');
  });

  it('scenario: unparseable-ABV row is held, status contract intact', () => {
    // The Red Bull live shape: no percentage anywhere in the name. The
    // row still ingests — ABV null, the same ESTIMATED-status contract
    // as before this change — with the hold and the correction flag as
    // the only delta.
    const { record, errors } = parseAlksStoreProduct(
      ALKS_GOLDEN_PRODUCTS[5],
    );
    expect(record).not.toBeNull();
    expect(record?.alcoholByVolume).toBeNull();
    expect(record?.category).toBe('other_fermented');
    expect(record?.reviewHoldReason).toBe('nonalcoholic_in_alcohol_category');
    // The rest of the parse is untouched: volume/container/brand all
    // resolve exactly as they did before the guard existed.
    expect(record?.volumeMl).toBe(355);
    expect(record?.containerType).toBe('can');
    expect(record?.brand).toBe('Red Bull');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ABV is unparseable');
  });

  it('scenario: parsed non-zero ABV is unchanged — beer stays beer, no hold, no error', () => {
    const { record, errors } = parseAlksStoreProduct(
      row(756421, 'Karhu III Olut 4,7% 0,33 l tölkki', 'Olut'),
    );
    expect(errors).toEqual([]);
    expect(record?.category).toBe('beer');
    expect(record?.alcoholByVolume).toBe(0.047);
    expect(record?.reviewHoldReason).toBeNull();
  });

  it('a non-alcoholic storefront category is never held — the guard only bars alcohol categories', () => {
    const { record, errors } = parseAlksStoreProduct(
      row(756422, 'Energy Drink 0,355 l', 'Energy drink'),
    );
    expect(errors).toEqual([]);
    expect(record?.category).toBe('other_fermented');
    expect(record?.reviewHoldReason).toBeNull();
  });

  it('an explicit-other category with an alcohol-type name on a zero-ABV row is held through the guarded source', () => {
    // "Muut juomat" (explicit other) plus the name token 'olut': the
    // name's guarded outcome carries the hold so agreement never
    // cancels the correction flag.
    const { record, errors } = parseAlksStoreProduct(
      row(756423, 'Olut 0,0% 0,33 l', 'Muut juomat'),
    );
    expect(record).not.toBeNull();
    expect(record?.category).toBe('other_fermented');
    expect(record?.reviewHoldReason).toBe('nonalcoholic_in_alcohol_category');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ABV is 0');
  });

  it('the guard never fights the boundary rule — a >22 % row re-keys to spirits exactly as before', () => {
    const { record, errors } = parseAlksStoreProduct(
      row(756424, 'Lignell Akvavit 41% 0,5 l', 'Muut juomat'),
    );
    expect(errors).toEqual([]);
    expect(record?.category).toBe('spirits');
    expect(record?.alcoholByVolume).toBe(0.41);
    expect(record?.reviewHoldReason).toBeNull();
  });

  it('a zero-ABV row whose name alone implies the alcohol category is held (name source)', () => {
    // No mappable category at all — the name token 'olut' is the only
    // alcohol-implying source, and it cannot place a 0,0 % row in beer.
    const { record, errors } = parseAlksStoreProduct(
      row(756425, 'Karhu 0,0% olut 0,33 l', 'Kesämonsteriaitat'),
    );
    expect(record).not.toBeNull();
    expect(record?.category).toBe('other_fermented');
    expect(record?.reviewHoldReason).toBe('nonalcoholic_in_alcohol_category');
    expect(errors).toHaveLength(1);
  });
});

describe('parseAlksStoreProduct — accepted SKU shape set (onboard-kippis-merchant 2.1)', () => {
  // Minimal row builder: the name parses cleanly so the only variable
  // under test is the SKU shape.
  const rowWithSku = (id: number, sku?: string) => ({
    id,
    name: 'Sisu Vodka 40% 500 ml',
    ...(sku === undefined ? {} : { sku }),
    permalink: `https://alks.fi/product/sku-shape-${id}/`,
    prices: { price: '1899', currency_code: 'EUR' },
    categories: [{ name: 'Väkevä' }],
    is_in_stock: true,
  });

  it('prefixed SKU — de-4740077005916 yields EAN 4740077005916 with no correction', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowWithSku(756340, 'de-4740077005916'),
    );
    expect(errors).toEqual([]);
    expect(record?.ean).toBe('4740077005916');
  });

  it('bare 13-digit SKU — 6410405217457 yields itself as EAN with no correction', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowWithSku(756341, '6410405217457'),
    );
    expect(errors).toEqual([]);
    expect(record?.ean).toBe('6410405217457');
  });

  it('GTIN-14 SKU — 06412700071701 yields the leading zero stripped', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowWithSku(756342, '06412700071701'),
    );
    expect(errors).toEqual([]);
    expect(record?.ean).toBe('6412700071701');
  });

  it('internal code — 1038480 keeps the record EAN-less with a correction error naming the new shape set', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowWithSku(756343, '1038480'),
    );
    expect(record).not.toBeNull();
    expect(record?.ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('1038480');
    expect(errors[0]).toContain('does not match any accepted');
    expect(errors[0]).toContain('^\\d{13}$');
    expect(errors[0]).toContain('^0\\d{13}$');
    expect(errors[0]).toContain('correction queue');
  });

  it('empty and missing SKU — record kept EAN-less with no correction error', () => {
    const empty = parseAlksStoreProduct(rowWithSku(756344, ''));
    expect(empty.record?.ean).toBeNull();
    expect(empty.errors).toEqual([]);

    const missing = parseAlksStoreProduct(rowWithSku(756345));
    expect(missing.record?.ean).toBeNull();
    expect(missing.errors).toEqual([]);
  });

  it('12-digit SKU — 641040521745 is rejected, never zero-padded', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowWithSku(756346, '641040521745'),
    );
    expect(record).not.toBeNull();
    expect(record?.ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('641040521745');
    expect(errors[0]).toContain('does not match any accepted');
    expect(errors[0]).toContain('correction queue');
  });

  it('suffixed variant — 4740019769500/3 is rejected, never suffix-stripped', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowWithSku(756347, '4740019769500/3'),
    );
    expect(record).not.toBeNull();
    expect(record?.ean).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('4740019769500/3');
    expect(errors[0]).toContain('does not match any accepted');
    expect(errors[0]).toContain('correction queue');
  });
});

// ---------------------------------------------------------------------------
// Multipack-aware volume parse and bundle-name rejection (task 1.3,
// design D1, change data-quality-and-publication-trust)
// ---------------------------------------------------------------------------

describe('parseAlksStoreProduct — multipack volume tokens (task 1.3, design D1)', () => {
  /** Minimal row builder: only the name varies. */
  const rowNamed = (id: number, name: string) => ({
    id,
    name,
    sku: 'de-4740077005916',
    permalink: `https://alks.fi/product/multipack-${id}/`,
    prices: { price: '3099', currency_code: 'EUR' },
    categories: [{ name: 'Olut' }],
    is_in_stock: true,
  });

  it('spec: "24×0,33 l" resolves to unit 330 ml with pack count 24', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757001, 'Karhu Olut 5.3% 24×0,33 l tölkki'),
    );
    expect(errors).toEqual([]);
    expect(record?.volumeMl).toBe(330);
    expect(record?.packCount).toBe(24);
  });

  it('spec: "24 x 33 cl" resolves to unit 330 ml with pack count 24', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757002, 'Karin Munk Olut 4,7% 24 x 33 cl'),
    );
    expect(errors).toEqual([]);
    expect(record?.volumeMl).toBe(330);
    expect(record?.packCount).toBe(24);
  });

  it('spec: the encoded "&#215;" separator parses identically — the parser runs before entity decoding', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757003, 'Sidra 4,5% 24&#215;0,33 l tölkki'),
    );
    expect(errors).toEqual([]);
    expect(record?.volumeMl).toBe(330);
    expect(record?.packCount).toBe(24);
    // The name is carried verbatim — decoding happens later, at mapping.
    expect(record?.productName).toContain('&#215;');
  });

  it('spec: "24×33 l" parses deterministically as unit 33 l (pack 24) — the ceiling gate judges it, not the parser', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757004, 'Karhu Olut 5.3% 24×33 l'),
    );
    expect(errors).toEqual([]);
    expect(record?.volumeMl).toBe(33000);
    expect(record?.packCount).toBe(24);
  });

  it('spec: a 6-pack of 0,5 l bottles resolves to unit 500 ml with pack count 6', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757005, 'Olut 5,5% 6 x 0,5 l pullo'),
    );
    expect(errors).toEqual([]);
    expect(record?.volumeMl).toBe(500);
    expect(record?.packCount).toBe(6);
  });
});

describe('parseAlksStoreProduct — bundle names held for review (task 1.3, design D1)', () => {
  /** Minimal row builder: only the name (and optionally the category) varies. */
  const rowNamed = (id: number, name: string, category = 'Väkevä') => ({
    id,
    name,
    sku: 'de-4740077005916',
    permalink: `https://alks.fi/product/bundle-${id}/`,
    prices: { price: '4999', currency_code: 'EUR' },
    categories: [{ name: category }],
    is_in_stock: true,
  });

  it('spec: the observed bundle shape ("… + Jägermeister 0") drops with a review error — no record', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757010, 'Koskenkorva Vodka 40% 0,5 l + Jägermeister 0'),
    );
    expect(record).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('multi-product bundle');
    expect(errors[0]).toContain('Jägermeister');
    expect(errors[0]).toContain('held for review');
    expect(errors[0]).toContain('correction queue');
  });

  it('a second concatenated brand drops the same way, with the row label naming the product', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757011, 'Absolut Vodka 40% 0,5 l + Gordon\'s Gin 0,5 l'),
    );
    expect(record).toBeNull();
    expect(errors[0]).toContain('757011');
    expect(errors[0]).toContain('multi-product bundle');
  });

  it('spec: promo shapes never false-positive — "4+1" keeps the record', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757012, 'Karhu III Olut 4,7% 4+1 0,5 l tölkki', 'Olut'),
    );
    expect(errors).toEqual([]);
    expect(record).not.toBeNull();
    expect(record?.volumeMl).toBe(500);
    expect(record?.packCount).toBeNull();
  });
});

describe('parseAlksStoreProduct — single-product passthrough unchanged (task 1.3)', () => {
  /** Minimal row builder: only the name varies (category must agree with the name tokens). */
  const rowNamed = (id: number, name: string, category = 'Olut') => ({
    id,
    name,
    sku: 'de-4740077005916',
    permalink: `https://alks.fi/product/single-${id}/`,
    prices: { price: '699', currency_code: 'EUR' },
    categories: [{ name: category }],
    is_in_stock: true,
  });

  it('spec: a single-product name keeps its volume and a null pack count', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757020, 'Herb Liqueur 35% 0.5 l PET', 'Liköörit'),
    );
    expect(errors).toEqual([]);
    expect(record?.volumeMl).toBe(500);
    expect(record?.packCount).toBeNull();
  });

  it('spec: the comma-decimal single volume form is unchanged', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757021, 'Olut 4,7% 0,33 l tölkki'),
    );
    expect(errors).toEqual([]);
    expect(record?.volumeMl).toBe(330);
    expect(record?.packCount).toBeNull();
  });

  it('spec: the unit-first live case shape ("33cl x 24") keeps the per-container volume and no pack count', () => {
    // The kippis sweep's documented skew: `33cl x 24` is not a
    // pack-first token, so the plain single-token parse stands.
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(
        757022,
        'Hartwall Original Long Drink 4,5% 33cl x 24 tölkkiä',
        'Siiderit lonkerot ja seltzerit',
      ),
    );
    expect(errors).toEqual([]);
    expect(record?.volumeMl).toBe(330);
    expect(record?.packCount).toBeNull();
  });

  it('spec: an unparsed name keeps the 0-ml encoding with a null pack count', () => {
    const { record, errors } = parseAlksStoreProduct(
      rowNamed(757023, 'Mysteeri Juoma'),
    );
    // The volume encoding is unchanged — and the Olut category plus the
    // missing ABV additionally earns the non-alcoholic guard's hold
    // (change nonalcoholic-catalog-hygiene): the row ingests, held.
    expect(record?.volumeMl).toBe(0);
    expect(record?.packCount).toBeNull();
    expect(record?.reviewHoldReason).toBe('nonalcoholic_in_alcohol_category');
    expect(errors).toHaveLength(1);
  });
});
