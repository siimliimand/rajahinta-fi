/**
 * Golden dataset for the mydrink.ee WooCommerce Store API feed
 * (task 2.1, change onboard-mydrink-merchant).
 *
 * MyDrink's payload is field-for-field compatible with the alks Store
 * API contract — the existing parser (`parseAlksStoreProducts`) is
 * reused unchanged, so the row shape IS the alks shape. The types are
 * therefore type-aliases of the alks fixture types: any future payload
 * contract drift fails here at compile time, not at ingestion time.
 * The one additive field is `prices.regular_price`, which sale rows
 * carry on the live feed; the parser reads only `prices.price` — the
 * effective SALE price — so the crossed-out regular amount is pinned
 * as present-but-ignored.
 *
 * The rows reflect the mydrink sweep reality (change
 * onboard-mydrink-merchant, notes §1.1; 707-row census): internal-code
 * SKUs on every row (`MTBE026-1-2-1` shape — none matches an accepted
 * EAN form, design D2), sale prices as the effective `prices.price`,
 * Estonian comma-decimal names, empty `brands` on every row, kg-string
 * weights, and the Estonian category vocabulary mapped additively in
 * task 1.2. Two rows drop the way the live feed drops: a wine row
 * carrying only the unmapped `veinid ▾` parent (leaf-first, design
 * D3) and the `Kingiideed ▾` promo section — both land in the
 * correction queue with an error, never a silent drop.
 *
 * @module MydrinkStoreProductsFixture
 */

import type {
  AlksFixturePrices,
  AlksFixtureProduct,
  AlksFixtureTerm,
} from './alks-store-products.fixture';

/**
 * Same Store API price shape; sale rows also carry the crossed-out
 * regular price. The parser reads `price` only.
 */
export interface MydrinkFixturePrices extends AlksFixturePrices {
  /** WooCommerce minor-unit string; present-but-ignored by the parser. */
  readonly regular_price?: string;
}

/** Same Store API category/brand term shape. */
export type MydrinkFixtureTerm = AlksFixtureTerm;

/** Same Store API product row shape — the parser is reused unchanged. */
export type MydrinkFixtureProduct = Omit<AlksFixtureProduct, 'prices'> & {
  readonly prices: MydrinkFixturePrices;
};

export const MYDRINK_GOLDEN_PRODUCTS: readonly MydrinkFixtureProduct[] = [
  // Spirits row — the sweep's dominant department (`kange alkohol ▾`,
  // 251 census rows). SALE row: `prices.price` is the effective
  // 18.99 € against a crossed-out 21.99 € regular_price. Internal-code
  // SKU → record kept EAN-less with the per-row correction error
  // (design D2); kg-string weight; empty brands (every live row).
  {
    id: 700001,
    name: 'Viru Vali Vodka 40% 0,5L',
    sku: 'MTBE026-1-2-1',
    permalink: 'https://mydrink.ee/product/viru-vali-vodka-40-0-5l/',
    prices: { price: '1899', regular_price: '2199', currency_code: 'EUR' },
    categories: [{ name: 'Kange alkohol ▾' }],
    brands: [],
    weight: '1.5',
    is_in_stock: true,
  },
  // Still-wine leaf AFTER the unmapped `veinid ▾` parent — the
  // leaf-first pin (design D3): category mapping takes the first
  // MAPPABLE term in payload order, so `punased` wins and the row
  // stays still wine (`wine_still`) even with the parent sorted first.
  {
    id: 700002,
    name: 'Chateau Kassari 2022 13% 0,75L',
    sku: 'MTVE010-2-1-1',
    permalink: 'https://mydrink.ee/product/chateau-kassari-2022/',
    prices: { price: '1149', currency_code: 'EUR' },
    categories: [{ name: 'Veinid ▾' }, { name: 'Punased' }],
    brands: [],
    weight: '1.4',
    is_in_stock: true,
  },
  // Sparkling leaf AFTER the same parent — the still-vs-sparkling
  // excise split the parent mapping would have destroyed (`vahuveinid`
  // → `wine_sparkling`). No weight field → weightGrams null without
  // an error (design D7).
  {
    id: 700003,
    name: 'Villa Conchi Cava Brut 11,5% 0,75L',
    sku: 'MTPA004-3-1-1',
    permalink: 'https://mydrink.ee/product/villa-conchi-cava-brut/',
    prices: { price: '1349', currency_code: 'EUR' },
    categories: [{ name: 'Veinid ▾' }, { name: 'Vahuveinid' }],
    brands: [],
    is_in_stock: true,
  },
  // Beer department (`õlu ▾` — the ` ▾` decoration is part of the
  // exact-match key, task 1.2). Sweep's example name verbatim:
  // comma decimals, ABV + volume embedded.
  {
    id: 700004,
    name: 'A. le Coq Arkti 4,7% 0,5L',
    sku: 'MTOL001-1-1-1',
    permalink: 'https://mydrink.ee/product/a-le-coq-arkti-4-7-0-5l/',
    prices: { price: '159', currency_code: 'EUR' },
    categories: [{ name: 'Õlu ▾' }],
    brands: [],
    weight: '0.9',
    is_in_stock: true,
  },
  // Cider (`siider` → `other_fermented`).
  {
    id: 700005,
    name: 'Somersby Siider 4,5% 0,33L',
    sku: 'MTSI003-1-1-1',
    permalink: 'https://mydrink.ee/product/somersby-siider-4-5-0-33l/',
    prices: { price: '129', currency_code: 'EUR' },
    categories: [{ name: 'Siider' }],
    brands: [],
    is_in_stock: true,
  },
  // Liqueur — the Estonian double-ö `liköör` maps to `liqueur`, which
  // shares the spirits tax key with vodka (parser agreement rule).
  {
    id: 700006,
    name: 'Vana Tallinn 40% 0,5L',
    sku: 'MTLI005-1-1-1',
    permalink: 'https://mydrink.ee/product/vana-tallinn-40-0-5l/',
    prices: { price: '1599', currency_code: 'EUR' },
    categories: [{ name: 'Liköör' }],
    brands: [],
    is_in_stock: true,
  },
  // Non-alcoholic mixers (`karastusjoogid` → `other_fermented`); no
  // ABV in the name → alcoholByVolume null, record kept (design D3);
  // `is_in_stock: false` → out_of_stock.
  {
    id: 700007,
    name: 'Fanta Free 0,33L',
    sku: 'MTKA009-1-1-1',
    permalink: 'https://mydrink.ee/product/fanta-free-0-33l/',
    prices: { price: '89', currency_code: 'EUR' },
    categories: [{ name: 'Karastusjoogid' }],
    brands: [],
    is_in_stock: false,
  },
  // Wine row with ONLY the `veinid ▾` parent — deliberately unmapped
  // (design D3: 152 live rows): the parent would misfile
  // Vahuveinid/Shampanjad rows as still wine whenever it sorts first.
  // Drops with the correction error; the SKU correction rides along
  // (only non-empty SKUs are named — this one is).
  {
    id: 700008,
    name: 'Terra Vitis Merlot 12,5% 0,75L',
    sku: 'MTVE020-1-1-1',
    permalink: 'https://mydrink.ee/product/terra-vitis-merlot/',
    prices: { price: '899', currency_code: 'EUR' },
    categories: [{ name: 'Veinid ▾' }],
    brands: [],
    is_in_stock: true,
  },
  // `Kingiideed ▾` promo section — decorative, not a beverage
  // category: drops like on the live feed, with the correction error.
  {
    id: 700009,
    name: 'Kinkekaart 25 eurot',
    sku: 'MTKI001-1-1-1',
    permalink: 'https://mydrink.ee/product/kinkekaart-25-eurot/',
    prices: { price: '2500', currency_code: 'EUR' },
    categories: [{ name: 'Kingiideed ▾' }],
    brands: [],
    is_in_stock: true,
  },
];

/**
 * The golden payload — a Store API page is a top-level JSON array.
 * Frozen so accidental fixture edits fail loudly.
 */
export const MYDRINK_GOLDEN_PAYLOAD: readonly MydrinkFixtureProduct[] = Object.freeze(
  MYDRINK_GOLDEN_PRODUCTS,
);
