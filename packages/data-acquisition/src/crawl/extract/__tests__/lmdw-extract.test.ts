/**
 * whisky.fr (LMDW) extraction tests — the per-source normalizer through
 * the guarded state reader and the shared extractor (task 3.1, change
 * onboard-lmdw-crawl-merchant; design D2/D4).
 *
 * Pinned to the 300-page probe's measured shapes: state-JSON
 * volume/strength forms and windows, the i18n-dictionary decoys, the
 * canonical `productFromServer` path (alternate shapes ride ESTIMATED),
 * the m3 taxonomy as the category candidates, page-attested
 * check-digit-valid GTINs only, and the honest correction lines for
 * every keyed-uncertainty ESTIMATED path.
 *
 * @module LmdwExtractTest
 */
import { describe, it, expect } from 'vitest';
import { extractProductPage } from '../extract-page';
import { LMDW_EXTRACTOR_CONFIG } from '../source-configs';
import {
  categoryLabelsImpliedMapping,
  isValidEan13CheckDigit,
  readLmdwPageState,
} from '../lmdw-state.reader';
import {
  LMDW_PRODUCT_HTML,
  LMDW_PRODUCT_URL,
} from '../__fixtures__/lmdw-product.fixture';

const CONFIG = LMDW_EXTRACTOR_CONFIG;

const NO_STATE_HTML = LMDW_PRODUCT_HTML.replace(
  /<script id="__NEXT_DATA__"[\s\S]*?<\/script\s*>/,
  '',
);

describe('readLmdwPageState — guarded volume/strength forms', () => {
  it('spec: the canonical path yields volume 0.7 l → 700 ml and strength 40 → 0.4', () => {
    const state = readLmdwPageState(LMDW_PRODUCT_HTML);
    expect(state).not.toBeNull();
    expect(state!.volumeMl).toBe(700);
    expect(state!.abvFraction).toBe(0.4);
    expect(state!.categoryLabels).toEqual([
      'whisky',
      'single malt whisky',
      'single malt whisky',
    ]);
  });

  it('string-comma and bare-number forms both parse (probe: dot-string 297/297, number 297/299)', () => {
    expect(
      readLmdwPageState(
        LMDW_PRODUCT_HTML.replace('"volume": "0.7",', '"volume": "0,059",'),
      )!.volumeMl,
    ).toBe(59);
    expect(
      readLmdwPageState(
        LMDW_PRODUCT_HTML.replace('"strength": 40,', '"strength": "43,5",'),
      )!.abvFraction,
    ).toBe(0.435);
  });

  it('the i18n dictionary strings never parse — only the canonical path is read', () => {
    // The fixture carries the measured digit-free decoys on every page.
    const state = readLmdwPageState(LMDW_PRODUCT_HTML)!;
    expect(state.volumeMl).toBe(700);
    expect(state.abvFraction).toBe(0.4);
  });

  it('guards: zero volume and zero strength reject (measured ×2 / ×12 populations)', () => {
    expect(
      readLmdwPageState(
        LMDW_PRODUCT_HTML.replace('"volume": "0.7",', '"volume": "0",'),
      )!.volumeMl,
    ).toBeNull();
    expect(
      readLmdwPageState(
        LMDW_PRODUCT_HTML.replace('"strength": 40,', '"strength": 0,'),
      )!.abvFraction,
    ).toBeNull();
  });

  it('guards: the unit windows are 0 < litres < 100 and 0 < percent ≤ 100', () => {
    expect(
      readLmdwPageState(
        LMDW_PRODUCT_HTML.replace('"volume": "0.7",', '"volume": 100.5,'),
      )!.volumeMl,
    ).toBeNull();
    expect(
      readLmdwPageState(
        LMDW_PRODUCT_HTML.replace('"volume": "0.7",', '"volume": 0.05,'),
      )!.volumeMl,
    ).toBe(50);
    expect(
      readLmdwPageState(
        LMDW_PRODUCT_HTML.replace('"strength": 40,', '"strength": 101,'),
      )!.abvFraction,
    ).toBeNull();
    expect(
      readLmdwPageState(
        LMDW_PRODUCT_HTML.replace('"strength": 40,', '"strength": 100,'),
      )!.abvFraction,
    ).toBe(1);
  });

  it('absence: no carrier, unparseable blob, or no productFromServer → null fields, never a guess', () => {
    expect(readLmdwPageState(NO_STATE_HTML)).toBeNull();
    expect(
      readLmdwPageState(
        LMDW_PRODUCT_HTML.replace('"__N_SSG": true', '"__N_SSG": true,,,'),
      ),
    ).toBeNull();
    const cmsShaped = readLmdwPageState(
      // The measured CMS/redirect shape: no canonical product node —
      // volume/strength ride null even though other subtrees carry data.
      LMDW_PRODUCT_HTML.replace(
        '"productFromServer"',
        '"productFromAlternatePath"',
      ),
    )!;
    expect(cmsShaped.volumeMl).toBeNull();
    expect(cmsShaped.abvFraction).toBeNull();
    // The m3 labels are whole-blob (present on 300/300 pages, including
    // the pages without productFromServer) — they still classify.
    expect(cmsShaped.categoryLabels).toContain('whisky');
  });
});

describe('isValidEan13CheckDigit — GS1 gate (design D4)', () => {
  it('accepts the probe-attested values, rejects a flipped check digit', () => {
    expect(isValidEan13CheckDigit('5000277000982')).toBe(true);
    expect(isValidEan13CheckDigit('5011013100156')).toBe(true);
    expect(isValidEan13CheckDigit('5000277000983')).toBe(false);
    expect(isValidEan13CheckDigit('500027700098')).toBe(false);
    expect(isValidEan13CheckDigit('not-a-number-13')).toBe(false);
  });
});

describe('categoryLabelsImpliedMapping — first mappable m3 candidate', () => {
  it('first label with a canonical mapping wins, in candidate order', () => {
    const mapping = categoryLabelsImpliedMapping(
      ['Types de produit', 'whisky', 'single malt whisky'],
      0.4,
    );
    expect(mapping!.canonicalCategory).toBe('spirits');
  });

  it('a deliberately-unmapped set returns null — never a guessed category', () => {
    // The pure-vocabulary outcome (the 2.1 replay): no usable ABV on
    // the gift/merch branch, and no candidate resolves.
    expect(
      categoryLabelsImpliedMapping(['solide', 'Types de produit', 'verres'], null),
    ).toBeNull();
  });
});

describe('extractProductPage — lmdw golden page', () => {
  const { record, errors } = extractProductPage(
    LMDW_PRODUCT_URL,
    LMDW_PRODUCT_HTML,
    CONFIG,
  );

  it('spec: state-JSON ABV/volume, m3 category, attested EAN, EUR minor units', () => {
    expect(errors).toEqual([]);
    expect(record).toMatchObject({
      productId: '1000425',
      productName: 'Ardbeg Uigeadail',
      brand: 'Ardbeg',
      manufacturer: 'Ardbeg',
      category: 'spirits',
      regulatoryClassification: 'spirits',
      alcoholByVolume: 0.4,
      volumeMl: 700,
      packCount: null,
      containerType: 'other',
      depositSystem: false,
      ean: '5000277000982',
      priceCents: 5890,
      currency: 'EUR',
      originalPriceCents: 5890,
      originalCurrency: 'EUR',
      availability: 'in_stock',
      sourceUrl: LMDW_PRODUCT_URL,
      reviewHoldReason: null,
    });
  });

  it('the state JSON wins over any name tokens — name parsing never runs', () => {
    const html = LMDW_PRODUCT_HTML.replace(
      '"volume": "0.7",',
      '"volume": "0.5",',
    );
    const { record } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    expect(record!.volumeMl).toBe(500);
  });
});

describe('extractProductPage — keyed-uncertainty ESTIMATED paths', () => {
  it('missing state fields ride ESTIMATED even when the name carries tokens', () => {
    const html = LMDW_PRODUCT_HTML
      .replace('"volume": "0.7",', '')
      .replace('"strength": 40,', '')
      .replaceAll('"name": "Ardbeg Uigeadail"', '"name": "Ardbeg Uigeadail 40% 70cl"')
      .replace('"label": "whisky"', '"label": "BOISSONS SANS ALCOOL"')
      .replaceAll('"label": "single malt whisky"', '"label": "sodas"');
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    // The name's "40%" and "70cl" are never consulted: the state JSON
    // is the only ABV/volume carrier, and it had neither.
    expect(record!.alcoholByVolume).toBeNull();
    expect(record!.volumeMl).toBe(0);
    expect(record!.reviewHoldReason).toBeNull();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('no usable strength');
    expect(errors[1]).toContain('no usable volume');
    expect(errors.every((line) => line.includes('ESTIMATED'))).toBe(true);
  });

  it('zero strength (the measured non-alcoholic population): ESTIMATED + hold on a typed label', () => {
    const html = LMDW_PRODUCT_HTML.replace('"strength": 40,', '"strength": 0,');
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    expect(record!.alcoholByVolume).toBeNull();
    // The keyed ABV-guard: a typed label with no usable strength re-keys
    // to the non-alcoholic bucket (tax key other_fermented) under hold.
    expect(record!.category).toBe('other_fermented');
    expect(record!.reviewHoldReason).not.toBeNull();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('no usable strength');
    expect(errors[1]).toContain('Held for review');
  });

  it('zero strength on a non-alcoholic taxonomy page: ESTIMATED error, no hold', () => {
    const html = LMDW_PRODUCT_HTML
      .replace('"strength": 40,', '"strength": 0,')
      .replace('"label": "whisky"', '"label": "boissons sans alcool"')
      .replaceAll('"label": "single malt whisky"', '"label": "sirops/cordials"');
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    expect(record!.alcoholByVolume).toBeNull();
    expect(record!.category).toBe('other_fermented');
    expect(record!.reviewHoldReason).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no usable strength');
  });

  it('zero volume rides 0 ml with a correction line', () => {
    const html = LMDW_PRODUCT_HTML.replace('"volume": "0.7",', '"volume": "0",');
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    expect(record!.volumeMl).toBe(0);
    expect(record!.alcoholByVolume).toBe(0.4);
    expect(errors).toEqual([
      expect.stringContaining('no usable volume'),
    ]);
  });

  it('no state JSON at all: ESTIMATED fields + the inherited name-token category', () => {
    const html = NO_STATE_HTML.replaceAll(
      '"name": "Ardbeg Uigeadail"',
      '"name": "Whisky Ardbeg Uigeadail"',
    );
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    // With no usable strength the ABV-guarded name mapping re-keys the
    // typed name token to the non-alcoholic bucket under the review
    // hold — the same keyed-uncertainty contract every crawl source
    // rides (the record's category carries the tax key).
    expect(record!.alcoholByVolume).toBeNull();
    expect(record!.volumeMl).toBe(0);
    expect(record!.category).toBe('other_fermented');
    expect(record!.reviewHoldReason).not.toBeNull();
    expect(errors).toHaveLength(3);
  });

  it('alternate-path shape (no productFromServer): ESTIMATED fields, m3 labels still read', () => {
    const html = LMDW_PRODUCT_HTML.replace(
      '"productFromServer"',
      '"productFromAlternatePath"',
    );
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    expect(record!.alcoholByVolume).toBeNull();
    expect(record!.volumeMl).toBe(0);
    // Null ABV on a typed label → the keyed non-alcoholic hold.
    expect(record!.category).toBe('other_fermented');
    expect(record!.reviewHoldReason).not.toBeNull();
    expect(errors).toHaveLength(3);
  });

  it('no state JSON and a token-less name: correction, no record', () => {
    const { record, errors } = extractProductPage(
      LMDW_PRODUCT_URL,
      NO_STATE_HTML,
      CONFIG,
    );
    expect(record).toBeNull();
    expect(errors).toEqual([
      expect.stringContaining('no usable strength'),
      expect.stringContaining('no usable volume'),
      expect.stringContaining('no canonical beverage category'),
    ]);
  });
});

describe('extractProductPage — GTIN13 page-attested only (design D4)', () => {
  it('EAN-less world: no gtin13 → record kept without an EAN, no correction line', () => {
    const html = LMDW_PRODUCT_HTML.replace(
      '    "gtin13": "5000277000982",\n',
      '',
    );
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    expect(record!.ean).toBeNull();
    expect(errors).toEqual([]);
  });

  it('form-valid but check-digit-invalid: EAN-less + correction naming the GTIN', () => {
    const html = LMDW_PRODUCT_HTML.replaceAll(
      '5000277000982',
      '5000277000983',
    );
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    expect(record!.ean).toBeNull();
    expect(errors).toEqual([
      expect.stringContaining('fails the GS1 check digit'),
    ]);
    expect(errors[0]).toContain('5000277000983');
  });
});

describe('extractProductPage — m3 category through the 2.1 vocabulary', () => {
  const cases: ReadonlyArray<[string, string]> = [
    // [m3_category label, expected tax key]
    ['liqueurs', 'spirits'],
    ['vins tranquilles', 'wine_still'],
    ['vins effervescents', 'wine_sparkling'],
    ['bieres', 'beer'],
  ];
  for (const [label, tax] of cases) {
    it(`m3_category "${label}" → ${tax}`, () => {
      const html = LMDW_PRODUCT_HTML.replace(
        '"label": "whisky"',
        `"label": "${label}"`,
      );
      const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
      expect(errors).toEqual([]);
      expect(record!.category).toBe(tax);
      expect(record!.regulatoryClassification).toBe(tax);
    });
  }

  it('sake below the 22 % boundary stays sake — above it the boundary re-keys to spirits', () => {
    const html = LMDW_PRODUCT_HTML.replace(
      '"label": "whisky"',
      '"label": "sakes"',
    );
    expect(
      extractProductPage(
        LMDW_PRODUCT_URL,
        html.replace('"strength": 40,', '"strength": 15,'),
        CONFIG,
      ).record!.category,
    ).toBe('other_fermented');
    expect(
      extractProductPage(LMDW_PRODUCT_URL, html, CONFIG).record!.category,
    ).toBe('spirits');
  });

  it('non-alcoholic taxonomy page (the measured zero-strength population) classifies cleanly', () => {
    const html = LMDW_PRODUCT_HTML
      .replace('"strength": 40,', '"strength": 0,')
      .replace('"label": "whisky"', '"label": "BOISSONS SANS ALCOOL"')
      .replaceAll('"label": "single malt whisky"', '"label": "sodas"');
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    // The non-alcoholic canonical passes the ABV guard unchanged — no
    // hold; the only correction line is the strength ESTIMATED one.
    expect(record!.category).toBe('other_fermented');
    expect(record!.reviewHoldReason).toBeNull();
    expect(errors).toEqual([expect.stringContaining('no usable strength')]);
  });

  it('deliberately-unmapped labels only (the solide gift/merch branch): correction naming the labels, no record', () => {
    const html = LMDW_PRODUCT_HTML
      .replace('"strength": 40,', '"strength": 0,')
      .replace('"label": "whisky"', '"label": "Types de produit"')
      .replaceAll('"label": "single malt whisky"', '"label": "verres"');
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    expect(record).toBeNull();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('no usable strength');
    expect(errors[1]).toContain('"Types de produit", "verres", "verres"');
    expect(errors[1]).toContain('no canonical beverage category');
  });
});

describe('extractProductPage — price and currency', () => {
  it('non-EUR offers are a per-row correction error, never converted', () => {
    const html = LMDW_PRODUCT_HTML
      .replace('"price": "58.90"', '"price": "70.00"')
      .replace('"priceCurrency": "EUR"', '"priceCurrency": "USD"');
    const { record, errors } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    expect(record).toBeNull();
    expect(errors).toEqual([
      expect.stringContaining('"USD" is not EUR'),
    ]);
  });

  it('EUR minor units round-trip through the shared price reader', () => {
    const html = LMDW_PRODUCT_HTML.replace(
      '"price": "58.90"',
      '"price": 1895.4',
    );
    const { record } = extractProductPage(LMDW_PRODUCT_URL, html, CONFIG);
    expect(record!.priceCents).toBe(189540);
  });
});
