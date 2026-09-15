/**
 * Golden dataset for the kippis.net WooCommerce Store API feed
 * (task 2.2, change onboard-kippis-merchant).
 *
 * Kippis's payload is field-for-field compatible with the alks Store
 * API contract — the existing parser (`parseAlksStoreProducts`) is
 * reused unchanged, so the row shape IS the alks shape. The types are
 * therefore type-aliases of the alks fixture types: any future payload
 * contract drift fails here at compile time, not at ingestion time.
 *
 * The rows reflect the kippis sweep reality (change
 * onboard-kippis-merchant, notes §1.1): numeric unprefixed SKUs — bare
 * 13-digit EANs and one GTIN-14 — plus the correction-path shapes the
 * sweep measured (a suffixed EAN variant, an internal code, a 12-digit
 * numeric, and the 165 no-SKU rows kept EAN-less silently); EUR
 * minor-unit prices where `prices.price` already carries the effective
 * SALE price (25 rows on sale across the live catalog — no separate
 * sale flag exists for the parser to read); Finnish comma-decimal
 * names; and the Finnish department terms mapped additively in task 1.2
 * (all 13 appear here, one row each or shared). Merchandising groups
 * (`Lahjakortti`) stay unmapped and drop, as on the live feed.
 *
 * The sweep measured zero category disagreements and zero non-EUR rows,
 * so unlike the alks/longero fixtures there is deliberately no
 * contradiction row — the kippis correction surface is the SKU/EAN gap,
 * and the drop row here is the live gift-card term. The multipack case
 * row pins the sweep's accepted-risk: `prices.price` is the CASE price
 * while volume stays per-container (documented skew, no scope change).
 *
 * @module KippisStoreProductsFixture
 */

import type {
  AlksFixturePrices,
  AlksFixtureProduct,
  AlksFixtureTerm,
} from './alks-store-products.fixture';

/** Same Store API price shape — minor-unit EUR strings. */
export type KippisFixturePrices = AlksFixturePrices;

/** Same Store API category/brand term shape. */
export type KippisFixtureTerm = AlksFixtureTerm;

/** Same Store API product row shape — the parser is reused unchanged. */
export type KippisFixtureProduct = AlksFixtureProduct;

export const KIPPIS_GOLDEN_PRODUCTS: readonly KippisFixtureProduct[] = [
  // Bare 13-digit SKU — the sweep's dominant shape (438/512 SKUs).
  // Sale price flows through as-is (the sweep's 25 sale rows carry the
  // effective price in `prices.price`); feed weight present.
  {
    id: 30001,
    name: 'Torres Viña Sol 11,5% 0,75 l',
    sku: '6410405217457',
    permalink: 'https://www.kippis.net/product/torres-vina-sol-11-5-0-75-l/',
    prices: { price: '1099', currency_code: 'EUR' },
    categories: [{ name: 'Valkoviinit' }],
    brands: [],
    weight: '1.3',
    is_in_stock: true,
  },
  // GTIN-14 SKU (leading zero) — the sweep's second shape (21/512);
  // sale price; weight present.
  {
    id: 30002,
    name: 'Casillero del Diablo Cabernet Sauvignon 13,5% 0,75 l',
    sku: '06412700071701',
    permalink:
      'https://www.kippis.net/product/casillero-del-diablo-cabernet-sauvignon/',
    prices: { price: '1299', currency_code: 'EUR' },
    categories: [{ name: 'punaviinit' }],
    weight: '1.4',
    is_in_stock: true,
  },
  // Sparkling-wine department; sale price.
  {
    id: 30003,
    name: 'Villa Conchi Cava Brut 11,5% 0,75 l',
    sku: '8412045110704',
    permalink: 'https://www.kippis.net/product/villa-conchi-cava-brut/',
    prices: { price: '1499', currency_code: 'EUR' },
    categories: [{ name: 'kuohuviinit' }],
    is_in_stock: true,
  },
  // Vodka-and-viina department — name token ('viina') and category
  // agree on the same tax-rule key (spirits), so the row is kept.
  {
    id: 30004,
    name: 'Koskenkorva Viina 40% 0,5 l',
    sku: '6412700012345',
    permalink: 'https://www.kippis.net/product/koskenkorva-viina/',
    prices: { price: '1699', currency_code: 'EUR' },
    categories: [{ name: 'Vodkat ja Viinat' }],
    is_in_stock: true,
  },
  {
    id: 30005,
    name: 'Glenfiddich 12 Year Single Malt 40% 0,7 l',
    sku: '5010327332111',
    permalink: 'https://www.kippis.net/product/glenfiddich-12-single-malt/',
    prices: { price: '4999', currency_code: 'EUR' },
    categories: [{ name: 'Viskit' }],
    is_in_stock: true,
  },
  {
    id: 30006,
    name: 'Rémy Martin VSOP 40% 0,7 l',
    sku: '3359951001234',
    permalink: 'https://www.kippis.net/product/remy-martin-vsop/',
    prices: { price: '4499', currency_code: 'EUR' },
    categories: [{ name: 'Konjakit' }],
    is_in_stock: true,
  },
  // Gin department — name token ('gin') and category agree on spirits.
  {
    id: 30007,
    name: 'Kyrö Napue Rye Gin 43,5% 0,5 l',
    sku: '6430051111116',
    permalink: 'https://www.kippis.net/product/kyro-napue-rye-gin/',
    prices: { price: '3699', currency_code: 'EUR' },
    categories: [{ name: 'Ginit' }],
    is_in_stock: true,
  },
  // Suffixed EAN variant (`…500/3`, the sweep's documented third
  // correction shape) → record kept without an EAN plus a correction
  // error naming the SKU (design D1 — never guessed around).
  {
    id: 30008,
    name: 'Bacardi Carta Blanca 37,5% 0,7 l',
    sku: '4740019769500/3',
    permalink: 'https://www.kippis.net/product/bacardi-carta-blanca/',
    prices: { price: '1899', currency_code: 'EUR' },
    categories: [{ name: 'rommit' }],
    is_in_stock: true,
  },
  {
    id: 30009,
    name: 'Baileys Original Irish Cream 17% 0,5 l',
    sku: '5000267014003',
    permalink: 'https://www.kippis.net/product/baileys-original-irish-cream/',
    prices: { price: '1299', currency_code: 'EUR' },
    categories: [{ name: 'Liköörit' }],
    is_in_stock: true,
  },
  {
    id: 30010,
    name: 'Martini Bianco 15% 1 l',
    sku: '8000221001234',
    permalink: 'https://www.kippis.net/product/martini-bianco/',
    prices: { price: '1199', currency_code: 'EUR' },
    categories: [{ name: 'Aperitiivit' }],
    is_in_stock: true,
  },
  // Multipack case row, verbatim from the sweep sample: `prices.price`
  // is the CASE price (30.99 € / 24 cans) while the name's volume stays
  // per-container (33 cl) — the sweep's documented 2.6× unit-price skew,
  // accepted risk, no scope change. Internal code SKU (`1038480`) →
  // kept without an EAN plus a correction error naming the SKU.
  {
    id: 30011,
    name: 'Hartwall Original Long Drink Light Strawberry 4,5% 33cl x 24 tölkkiä',
    sku: '1038480',
    permalink:
      'https://www.kippis.net/product/hartwall-original-long-drink-light-strawberry/',
    prices: { price: '3099', currency_code: 'EUR' },
    categories: [{ name: 'Siiderit lonkerot ja seltzerit' }],
    is_in_stock: true,
  },
  // Mixer department — no ABV in the name → alcoholByVolume null
  // (record kept, design D3); `is_in_stock: false` → out-of-stock.
  {
    id: 30012,
    name: 'Coca-Cola 0,33 l tölkki',
    sku: '5449000000996',
    permalink: 'https://www.kippis.net/product/coca-cola-tolkki/',
    prices: { price: '89', currency_code: 'EUR' },
    categories: [{ name: 'Virvoitusjuomat ja mikserit' }],
    is_in_stock: false,
  },
  {
    id: 30013,
    name: 'Battery Energy Drink 0,5 l tölkki',
    sku: '6417252001234',
    permalink: 'https://www.kippis.net/product/battery-energy-drink/',
    prices: { price: '259', currency_code: 'EUR' },
    categories: [{ name: 'Energiajuomat' }],
    is_in_stock: true,
  },
  // 12-digit numeric SKU — the sweep's largest "other" bucket (16 rows)
  // → kept without an EAN plus a correction error naming the SKU (D2:
  // no UPC-A zero-padding).
  {
    id: 30014,
    name: 'Siideri 4,7% 0,33 l tölkki',
    sku: '641977500123',
    permalink: 'https://www.kippis.net/product/siideri-tolkki/',
    prices: { price: '169', currency_code: 'EUR' },
    categories: [{ name: 'Siiderit lonkerot ja seltzerit' }],
    is_in_stock: true,
  },
  // Merchandising group row (`Lahjakortti` gift card, 4 live rows) —
  // unmapped on purpose, dropped with the correction error; empty SKU
  // adds no EAN correction on top (only non-empty SKUs are named).
  {
    id: 30015,
    name: 'Lahjakortti 25 euroa',
    sku: '',
    permalink: 'https://www.kippis.net/product/lahjakortti-25/',
    prices: { price: '2500', currency_code: 'EUR' },
    categories: [{ name: 'Lahjakortti' }],
    is_in_stock: true,
  },
  // One of the sweep's 165 no-SKU rows: kept EAN-less SILENTLY — a
  // missing SKU is parser design, not a correction error (design D1).
  {
    id: 30016,
    name: 'Fanta Free 0,33 l tölkki',
    sku: '',
    permalink: 'https://www.kippis.net/product/fanta-free-tolkki/',
    prices: { price: '159', currency_code: 'EUR' },
    categories: [{ name: 'Virvoitusjuomat ja mikserit' }],
    is_in_stock: true,
  },
];

/**
 * The golden payload — a Store API page is a top-level JSON array.
 * Frozen so accidental fixture edits fail loudly.
 */
export const KIPPIS_GOLDEN_PAYLOAD: readonly KippisFixtureProduct[] = Object.freeze(
  KIPPIS_GOLDEN_PRODUCTS,
);
