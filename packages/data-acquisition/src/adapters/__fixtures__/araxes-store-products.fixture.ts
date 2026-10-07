/**
 * Golden dataset for the araxes.ee WooCommerce Store API feed
 * (task 2.1, change onboard-araxes-merchant).
 *
 * Araxes' payload is field-for-field compatible with the alks Store
 * API contract — the existing parser (`parseAlksStoreProducts`) is
 * reused unchanged, so the row shape IS the alks shape. The types are
 * therefore type-aliases of the alks fixture types: any future payload
 * contract drift fails here at compile time, not at ingestion time.
 * Two additive fields ride the live feed and stay present-but-
 * ignored: `prices.regular_price`/`prices.sale_price` on sale rows
 * (the parser reads only `prices.price` — the effective SALE price —
 * so the crossed-out regular amount is pinned as never consulted),
 * and the row-level structured `attributes` (`Maht`,
 * `Alkoholisisaldus`, `Pant`, `Päritolumaa`, …) the parser never
 * reads this change.
 *
 * The rows reflect the araxes sweep reality (change
 * onboard-araxes-merchant, notes §1; 1630-row census, 94.5 % parsed
 * after task 1.2): 5-digit internal-code SKUs on every row (none
 * matches an accepted EAN form, design D2), sale prices as the
 * effective `prices.price`, empty `brands` on every row, kg-string
 * weights, and the BARE (undecorated) Estonian category vocabulary
 * mapped additively in task 1.2 — the mydrink ` ▾` decorations and
 * plurals do not occur here. Every row is kept: the sweep's category
 * drops (merch terms, `Kokteilid`, bare `Vein`) live outside this
 * golden set, whose five rows all resolve canonically — the only
 * correction surface is the per-row SKU note, one per row, matching
 * the 1630/1630 EAN-less reality.
 *
 * @module AraxesStoreProductsFixture
 */

import type {
  AlksFixturePrices,
  AlksFixtureProduct,
  AlksFixtureTerm,
} from './alks-store-products.fixture';

/**
 * Same Store API price shape; sale rows also carry the crossed-out
 * regular price and the matching sale amount. The parser reads
 * `price` only — the effective price.
 */
export interface AraxesFixturePrices extends AlksFixturePrices {
  /** WooCommerce minor-unit string; present-but-ignored by the parser. */
  readonly regular_price?: string;
  /** WooCommerce minor-unit string; present-but-ignored by the parser. */
  readonly sale_price?: string;
}

/** Same Store API category/brand term shape. */
export type AraxesFixtureTerm = AlksFixtureTerm;

/**
 * Store API structured attribute (`Maht`, `Alkoholisisaldus`, `Pant`,
 * `Päritolumaa`, …) — pinned present-but-ignored: the parser reads
 * names and categories only, and no attribute may silently become a
 * data source (design D1's rejected alternative).
 */
export interface AraxesFixtureAttribute {
  readonly name: string;
  readonly options?: readonly string[];
}

/** Same Store API product row shape — the parser is reused unchanged. */
export type AraxesFixtureProduct = Omit<AlksFixtureProduct, 'prices'> & {
  readonly prices: AraxesFixturePrices;
  readonly attributes?: readonly AraxesFixtureAttribute[];
};

export const ARAXES_GOLDEN_PRODUCTS: readonly AraxesFixtureProduct[] = [
  // Spirits row — the sweep's dominant parent (`Kange alkohol`, 860
  // census rows) with its `Viski` leaf (133). Internal-code SKU →
  // record kept EAN-less with the per-row correction error (design
  // D2); kg-string weight; empty brands (every live row). The
  // structured attributes ride along present-but-ignored — `Pant` is
  // the Estonian deposit system, never Finnish pantti membership
  // (design D5), and `Maht`/`Alkoholisisaldus`/`Päritolumaa` stay
  // unread (the parser takes ABV/volume from the name only).
  {
    id: 710001,
    name: 'WILLIAM PEEL Blended Scotch Whisky 1L 40% Whisky',
    sku: '42631',
    permalink: 'https://araxes.ee/product/william-peel-blended-scotch-whisky-1l/',
    prices: { price: '2199', currency_code: 'EUR' },
    categories: [{ name: 'Kange alkohol' }, { name: 'Viski' }],
    brands: [],
    weight: '1',
    attributes: [
      { name: 'Maht', options: ['1 L'] },
      { name: 'Alkoholisisaldus', options: ['40%'] },
      { name: 'Pant', options: ['0,10 €'] },
      { name: 'Kuller', options: ['3,00 €'] },
      { name: 'Transport üle Eesti', options: ['tasuta'] },
      { name: 'Kohaletoimetamine', options: ['1-3 tööpäeva'] },
      { name: 'Päritolumaa', options: ['Šotimaa'] },
    ],
    is_in_stock: true,
  },
  // Still-wine leaf AFTER the unmapped bare `Vein` parent — the
  // leaf-first pin (design D3): category mapping takes the first
  // MAPPABLE term in payload order, so `Punane vein` (171 census
  // rows) wins and the row stays still wine (`wine_still`) even with
  // the parent sorted first.
  {
    id: 710002,
    name: 'Chateau Varti Merlot 12,5% 0,75L',
    sku: '42914',
    permalink: 'https://araxes.ee/product/chateau-varti-merlot/',
    prices: { price: '1149', currency_code: 'EUR' },
    categories: [{ name: 'Vein' }, { name: 'Punane vein' }],
    brands: [],
    weight: '1.4',
    is_in_stock: true,
  },
  // Non-alcoholic section (`Alkoholivaba`, 68 census rows) with its
  // `Karastusjook` child (24) — one tax family (`other_fermented`);
  // no ABV in the name → alcoholByVolume null, record kept (design
  // D3); `is_in_stock: false` → out_of_stock; no weight field →
  // weightGrams null without an error (design D7).
  {
    id: 710003,
    name: 'Fanta Free 0,33L',
    sku: '43012',
    permalink: 'https://araxes.ee/product/fanta-free-0-33l/',
    prices: { price: '89', currency_code: 'EUR' },
    categories: [{ name: 'Alkoholivaba' }, { name: 'Karastusjook' }],
    brands: [],
    is_in_stock: false,
  },
  // SALE row — `sale_price` < `regular_price`, the effective amount
  // already in `prices.price` (`Vahuvein` → `wine_sparkling`, kept
  // apart from still wine for the excise split). The parser reads
  // `price` only: both sale fields are present-but-ignored.
  {
    id: 710004,
    name: 'Freixenet Cordon Negro 11,5% 0,75L',
    sku: '43555',
    permalink: 'https://araxes.ee/product/freixenet-cordon-negro/',
    prices: {
      price: '1349',
      regular_price: '1699',
      sale_price: '1349',
      currency_code: 'EUR',
    },
    categories: [{ name: 'Vahuvein' }],
    brands: [],
    weight: '1.4',
    is_in_stock: true,
  },
  // Beer section (`Õlu` under `Lahja alkohol`, 75 census rows) —
  // another 5-digit internal code: kept EAN-less with the correction
  // error naming the SKU, like every row on the live feed (design
  // D2, 1630/1630).
  {
    id: 710005,
    name: 'A. le Coq Premium 4,7% 0,5L',
    sku: '42877',
    permalink: 'https://araxes.ee/product/a-le-coq-premium-4-7-0-5l/',
    prices: { price: '159', currency_code: 'EUR' },
    categories: [{ name: 'Õlu' }],
    brands: [],
    weight: '0.9',
    is_in_stock: true,
  },
];

/**
 * The golden payload — a Store API page is a top-level JSON array.
 * Frozen so accidental fixture edits fail loudly.
 */
export const ARAXES_GOLDEN_PAYLOAD: readonly AraxesFixtureProduct[] = Object.freeze(
  ARAXES_GOLDEN_PRODUCTS,
);
