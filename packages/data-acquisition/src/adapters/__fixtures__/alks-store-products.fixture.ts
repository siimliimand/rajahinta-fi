/**
 * Golden dataset for the alks.fi WooCommerce Store API parser
 * (task 1.1, change alks-feed-and-import-vat; designs D1/D3/D4/D7).
 *
 * Row 1 is pinned from the live Store API sample captured during
 * exploration (`GET https://alks.fi/wp-json/wc/store/v1/products`,
 * sampled 2026-09): the same id, SKU, name, prices, categories and
 * weight as the real payload — with the image fields stripped. The
 * parser reads no image data (design D4) and this fixture must not
 * carry it, so any future payload contract drift shows up as a
 * golden-test failure instead of a silent data outage.
 *
 * Rows 2–5 deliberately exercise every branch the parser owns: the
 * weight-absent path, a non-matching SKU (record kept, correction
 * error), a name without parseable ABV/volume (record kept, null
 * field), and a name/category contradiction (correction error, no
 * record).
 *
 * @module AlksStoreProductsFixture
 */

export interface AlksFixturePrices {
  /** WooCommerce minor-unit string ("699" = €6.99). */
  readonly price: string;
  readonly currency_code: string;
}

export interface AlksFixtureTerm {
  readonly name: string;
}

export interface AlksFixtureProduct {
  readonly id: number;
  readonly name: string;
  readonly sku: string;
  readonly permalink: string;
  readonly prices: AlksFixturePrices;
  readonly categories: readonly AlksFixtureTerm[];
  readonly brands?: readonly AlksFixtureTerm[];
  /** Plain-decimal kg string ("0.53"), as the Store API sends it. */
  readonly weight?: string;
  readonly is_in_stock: boolean;
}

export const ALKS_GOLDEN_PRODUCTS: readonly AlksFixtureProduct[] = [
  // Live Store API sample row (image fields stripped, design D4).
  {
    id: 756330,
    name: 'Herb Liqueur 35% 0.5 l PET',
    sku: 'de-4740077005916',
    permalink: 'https://alks.fi/product/herb-liqueur-35-0-5-l-pet/',
    prices: { price: '699', currency_code: 'EUR' },
    categories: [
      { name: 'EE-str' },
      { name: 'Likööri' },
      { name: 'Liquor' },
      { name: 'Väkevä' },
    ],
    brands: [],
    weight: '0.53',
    is_in_stock: true,
  },
  // Weight absent → weightGrams null without an error (design D7);
  // comma-decimal volume form; no container token in the name.
  {
    id: 756331,
    name: 'German Pilsner 4.8% 0,5 l',
    sku: 'de-4260123456789',
    permalink: 'https://alks.fi/product/german-pilsner-4-8-0-5-l/',
    prices: { price: '549', currency_code: 'EUR' },
    categories: [{ name: 'Olut' }, { name: 'Beer' }],
    brands: [{ name: 'Kulbrau' }],
    is_in_stock: true,
  },
  // Non-matching SKU → record kept without an EAN plus a correction
  // error naming the SKU (design D1 — never guessed around).
  {
    id: 756332,
    name: 'Fruit Wine 8% 0,75 l',
    sku: 'promo-123',
    permalink: 'https://alks.fi/product/fruit-wine-8-0-75-l/',
    prices: { price: '899', currency_code: 'EUR' },
    categories: [{ name: 'Viini' }, { name: 'Wine' }],
    weight: '1.25',
    is_in_stock: true,
  },
  // Name without parseable ABV/volume → record still ingested with
  // alcoholByVolume null and volumeMl 0 (design D3 — no drops).
  {
    id: 756333,
    name: 'Mystery Gift Box',
    sku: 'ee-6410000000009',
    permalink: 'https://alks.fi/product/mystery-gift-box/',
    prices: { price: '1299', currency_code: 'EUR' },
    categories: [{ name: 'Olut' }],
    is_in_stock: false,
  },
  // Name/category contradiction (beer vs wine) → correction error,
  // no record — disagreeing sources are never silently resolved.
  {
    id: 756334,
    name: 'Craft Beer 5,5% 0,33 l',
    sku: 'de-4006421333909',
    permalink: 'https://alks.fi/product/craft-beer-5-5-0-33-l/',
    prices: { price: '449', currency_code: 'EUR' },
    categories: [{ name: 'Viini' }],
    weight: '0.66',
    is_in_stock: true,
  },
];

/**
 * The golden payload — a Store API page is a top-level JSON array.
 * Frozen so accidental fixture edits fail loudly.
 */
export const ALKS_GOLDEN_PAYLOAD: readonly AlksFixtureProduct[] = Object.freeze(
  ALKS_GOLDEN_PRODUCTS,
);
