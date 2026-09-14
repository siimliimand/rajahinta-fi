/**
 * Golden dataset for the longero.fi WooCommerce Store API feed
 * (task 2.1, change onboard-longero-merchant).
 *
 * Longero's payload is field-for-field compatible with the alks Store
 * API contract — the existing parser (`parseAlksStoreProducts`) is
 * reused unchanged, so the row shape IS the alks shape. The types are
 * therefore type-aliases of the alks fixture types: any future payload
 * contract drift fails here at compile time, not at ingestion time.
 *
 * The rows reflect the longero sweep reality (change
 * onboard-longero-merchant, tasks 1.1/1.2): EAN-shaped SKUs with the
 * `ee-` prefix on some rows, non-matching SKU shapes on others — a
 * `V2-…` prefix and a 12-digit SKU (the sweep's ~32% SKU/EAN gap) —
 * `is_in_stock` availability, name-embedded ABV/volume (`14.5%
 * 0.75 l`), EUR minor-unit prices, and the Finnish category vocabulary
 * the sweep mapped (`Roseeviinit`, `Juomasekoitus`, `Väkevä`,
 * `Muut juomat`).
 *
 * Rows deliberately exercise every branch the parser owns: the
 * weight-absent path, two non-matching SKUs (record kept, correction
 * error each), a name without parseable ABV/volume (record kept, null
 * field, out of stock), and a name/category contradiction (correction
 * error, no record).
 *
 * @module LongeroStoreProductsFixture
 */

import type {
  AlksFixturePrices,
  AlksFixtureProduct,
  AlksFixtureTerm,
} from './alks-store-products.fixture';

/** Same Store API price shape — minor-unit EUR strings. */
export type LongeroFixturePrices = AlksFixturePrices;

/** Same Store API category/brand term shape. */
export type LongeroFixtureTerm = AlksFixtureTerm;

/** Same Store API product row shape — the parser is reused unchanged. */
export type LongeroFixtureProduct = AlksFixtureProduct;

export const LONGERO_GOLDEN_PRODUCTS: readonly LongeroFixtureProduct[] = [
  // Clean wine row in longero's naming style (ABV/volume embedded with
  // dot decimals); feed weight present.
  {
    id: 12001,
    name: 'Mulberry Wine 14.5% 0.75 l',
    sku: 'ee-4740160012345',
    permalink: 'https://longero.fi/product/mulberry-wine-14-5-0-75-l/',
    prices: { price: '1599', currency_code: 'EUR' },
    categories: [{ name: 'Roseeviinit' }],
    brands: [],
    weight: '1.4',
    is_in_stock: true,
  },
  // Long drink — longero's core assortment. Weight absent →
  // weightGrams null without an error (design D7); comma-decimal
  // volume form; brand present.
  {
    id: 12002,
    name: 'Long Drink 5,5% 0,33 l',
    sku: 'ee-6412900456789',
    permalink: 'https://longero.fi/product/long-drink-5-5-0-33-l/',
    prices: { price: '199', currency_code: 'EUR' },
    categories: [{ name: 'Juomasekoitus' }],
    brands: [{ name: 'Tallinna Joogitehas' }],
    is_in_stock: true,
  },
  // Non-matching SKU, `V2-…` shape with a 12-digit body — the sweep's
  // documented SKU gap → record kept without an EAN plus a correction
  // error naming the SKU (design D1 — never guessed around).
  {
    id: 12003,
    name: 'Vodka 40% 0,5 l',
    sku: 'V2-474016001234',
    permalink: 'https://longero.fi/product/vodka-40-0-5-l/',
    prices: { price: '1499', currency_code: 'EUR' },
    categories: [{ name: 'Väkevä' }],
    weight: '0.72',
    is_in_stock: true,
  },
  // Name without parseable ABV/volume → record still ingested with
  // alcoholByVolume null and volumeMl 0 (design D3 — no drops);
  // `is_in_stock: false` → out-of-stock availability.
  {
    id: 12004,
    name: 'Longero Gift Box',
    sku: 'ee-4740160012348',
    permalink: 'https://longero.fi/product/longero-gift-box/',
    prices: { price: '2499', currency_code: 'EUR' },
    categories: [{ name: 'Olut' }],
    is_in_stock: false,
  },
  // Name/category contradiction (beer vs wine) → correction error,
  // no record — disagreeing sources are never silently resolved.
  {
    id: 12005,
    name: 'Craft Beer 5,5% 0,33 l',
    sku: 'ee-4740160012349',
    permalink: 'https://longero.fi/product/craft-beer-5-5-0-33-l/',
    prices: { price: '189', currency_code: 'EUR' },
    categories: [{ name: 'Roseeviinit' }],
    weight: '0.66',
    is_in_stock: true,
  },
  // Second non-matching SKU shape — `ee-` prefix but 12 digits →
  // record kept without an EAN plus a correction error naming the SKU.
  {
    id: 12006,
    name: 'Cider 4,7% 0,33 l',
    sku: 'ee-474016001234',
    permalink: 'https://longero.fi/product/cider-4-7-0-33-l/',
    prices: { price: '169', currency_code: 'EUR' },
    categories: [{ name: 'Muut juomat' }],
    is_in_stock: true,
  },
];

/**
 * The golden payload — a Store API page is a top-level JSON array.
 * Frozen so accidental fixture edits fail loudly.
 */
export const LONGERO_GOLDEN_PAYLOAD: readonly LongeroFixtureProduct[] = Object.freeze(
  LONGERO_GOLDEN_PRODUCTS,
);
