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
 * Rows 6–8 (change nonalcoholic-catalog-hygiene) pin the live feed's
 * non-alcoholic drift shapes the proposal documents (2026-10-04 sample):
 * an energy drink, a mineral water, and a juice, each filed by the
 * storefront under the cider parent — the parent term plus its mappable
 * leaf, the payload shape the parser resolves first-mappable-term — with
 * no parseable ABV. Each ingests — the ESTIMATED-status contract is
 * untouched — re-keyed to the non-alcoholic category with the review
 * hold and a correction error, held from user-facing surfaces by the
 * shared listing predicate.
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
  // Non-alcoholic guard, live drift shape 1 (change
  // nonalcoholic-catalog-hygiene): the energy drink the proposal quotes
  // ("Red Bull Sugarfree tölkki", other_fermented, alcoholByVolume 0) —
  // no parseable ABV, storefront cider parent → ingested re-keyed to
  // non-alcoholic with the review hold plus a correction error.
  {
    id: 756335,
    name: 'Red Bull Sugarfree tölkki 0,355 l',
    sku: 'fi-9016290000018',
    permalink: 'https://alks.fi/product/red-bull-sugarfree-tolkki/',
    prices: { price: '189', currency_code: 'EUR' },
    categories: [{ name: 'Siideri ja pitkäjuoma' }, { name: 'Siideri' }],
    brands: [{ name: 'Red Bull' }],
    weight: '0.37',
    is_in_stock: true,
  },
  // Live drift shape 2: mineral water under the same cider parent —
  // held exactly like the energy drink (unparseable ABV).
  {
    id: 756336,
    name: 'Ramlösa Citrus 0,5 l pullo',
    sku: 'se-7310870004017',
    permalink: 'https://alks.fi/product/ramlosa-citrus/',
    prices: { price: '169', currency_code: 'EUR' },
    categories: [{ name: 'Siideri ja pitkäjuoma' }, { name: 'Siideri' }],
    brands: [{ name: 'Ramlösa' }],
    weight: '0.55',
    is_in_stock: true,
  },
  // Live drift shape 3: cherry juice under the same cider parent —
  // held exactly like the energy drink (unparseable ABV, no weight).
  {
    id: 756337,
    name: 'Kirsikkamehu 1 l',
    sku: 'fi-6410405001235',
    permalink: 'https://alks.fi/product/kirsikkamehu/',
    prices: { price: '249', currency_code: 'EUR' },
    categories: [{ name: 'Siideri ja pitkäjuoma' }, { name: 'Siideri' }],
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
