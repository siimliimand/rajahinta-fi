/**
 * Golden dataset for the Alko storefront parser (change
 * data-quality-and-publication-trust).
 *
 * Pins the payload contract documented in adapters/alko.adapter.ts: the
 * REAL alko.fi storefront search API — one `{"@odata.count":N,"value":[…]}`
 * page whose rows are plural storefront groups ("oluet"), percent ABV,
 * litre volumes, and pipe-coded packageTypes. The fixture IS the
 * contract: it was rebuilt from the live catalog sweep (2026-09-30,
 * 11,307 rows) so parser drift against reality shows up as a golden-test
 * failure instead of a silent data outage.
 *
 * Every row is EAN-less — the storefront carries no EAN field at all,
 * so the fixture row type has no `ean` key (the explicit absence), and
 * the parser must emit `ean: null`, never a guessed barcode. Rows also
 * carry no manufacturer/brand/currency fields.
 *
 * The set deliberately exercises every mapping branch the parser owns:
 * beer/wine/sparkling/spirits/cider/long-drink categories, a liqueur
 * row (spirits tax key), a zero-ABV non-alcoholic row, the mainGroup
 * fallback (merged productGroup bucket → välituotteet), a sibling-leaf
 * resolution (unmapped 'grapat' next to a mapped leaf), one
 * unmappable-group row (rejected per-item to the correction queue), and
 * one price-less row (rejected; id mirrors a row observed live).
 *
 * @module AlkoAssortmentFixture
 */

/**
 * One storefront product row — only the fields the parser consumes.
 * The live payload carries more (imageUrl, taste, closures, …); the
 * parser never reads them (D4 image discipline, alks precedent).
 */
export interface AlkoFixtureRow {
  readonly id: string;
  readonly name: string;
  /** ABV in PERCENT; null on non-beverage rows (real accessories). */
  readonly abv: number | null;
  /** Retail price in EUR including VAT; 0 = unpriced. */
  readonly price: number;
  /** Package volume in LITRES; null on non-beverage rows. */
  readonly volume: number | null;
  readonly mainGroupName: readonly string[];
  readonly productGroupName: readonly string[];
  /** Pipe-coded packages; omitted on non-beverage rows. */
  readonly packageTypes?: readonly string[];
  readonly countryName: string;
  readonly webshopStock: number;
}

export interface AlkoFixturePage {
  readonly '@odata.count': number;
  readonly value: readonly AlkoFixtureRow[];
}

export const ALKO_GOLDEN_ROWS: readonly AlkoFixtureRow[] = [
  // Beer — plural storefront group → historical 'olut' → tax beer.
  {
    id: '700439',
    name: 'Lapin Kulta IVA',
    abv: 4.7,
    price: 2.19,
    volume: 0.33,
    mainGroupName: ['panimotuotteet'],
    productGroupName: ['oluet'],
    packageTypes: ['packageTypeId|packageType_tölkki|tölkki'],
    countryName: 'Suomi',
    webshopStock: 412,
  },
  // Still wine (red) → 'viini' → wine_still.
  {
    id: '001793',
    name: 'Casillero del Diablo Merlot',
    abv: 13.5,
    price: 10.48,
    volume: 0.75,
    mainGroupName: ['viinit'],
    productGroupName: ['punaviinit'],
    packageTypes: ['packageTypeId|packageType_pullo|lasipullo'],
    countryName: 'Chile',
    webshopStock: 88,
  },
  // Sparkling (champagne) → 'samppanja' → wine_sparkling.
  {
    id: '000312',
    name: 'Moët & Chandon Impérial',
    abv: 12.0,
    price: 44.98,
    volume: 0.75,
    mainGroupName: ['viinit'],
    productGroupName: ['samppanjat'],
    packageTypes: ['packageTypeId|packageType_pullo|lasipullo'],
    countryName: 'Ranska',
    webshopStock: 0,
  },
  // Spirits → 'viina' → spirits.
  {
    id: '009038',
    name: 'Koskenkorva Viina',
    abv: 40.0,
    price: 16.99,
    volume: 0.5,
    mainGroupName: ['väkevät'],
    productGroupName: ['viina'],
    packageTypes: ['packageTypeId|packageType_pullo|lasipullo'],
    countryName: 'Suomi',
    webshopStock: 350,
  },
  // Cider → 'siideri' → other_fermented.
  {
    id: '003145',
    name: 'Golden Cap Omena',
    abv: 4.7,
    price: 1.99,
    volume: 0.33,
    mainGroupName: ['panimotuotteet'],
    productGroupName: ['siiderit'],
    packageTypes: ['packageTypeId|packageType_tölkki|tölkki'],
    countryName: 'Suomi',
    webshopStock: 240,
  },
  // Long drink → 'long drink' → other_fermented.
  {
    id: '004361',
    name: 'Original Long Drink',
    abv: 5.5,
    price: 2.49,
    volume: 0.5,
    mainGroupName: ['panimotuotteet'],
    productGroupName: ['long drink'],
    packageTypes: ['packageTypeId|packageType_tölkki|tölkki'],
    countryName: 'Suomi',
    webshopStock: 620,
  },
  // Liqueur → 'likööri' → spirits tax key (shared with spirits).
  {
    id: '006102',
    name: 'Baileys Original',
    abv: 17.0,
    price: 12.98,
    volume: 0.5,
    mainGroupName: ['väkevät'],
    productGroupName: ['liköörit', 'kermaliköörit'],
    packageTypes: ['packageTypeId|packageType_pullo|lasipullo'],
    countryName: 'Irlanti',
    webshopStock: 130,
  },
  // Zero-ABV non-alcoholic → 'alkoholiton' → other_fermented.
  {
    id: '006857',
    name: 'Heineken 0.0',
    abv: 0.0,
    price: 1.29,
    volume: 0.33,
    mainGroupName: ['alkoholittomat'],
    productGroupName: ['alkoholittomat oluet'],
    packageTypes: ['packageTypeId|packageType_tölkki|tölkki'],
    countryName: 'Alankomaat',
    webshopStock: 95,
  },
  // Merged productGroup bucket (deliberately unmapped token) resolves
  // through the mainGroup fallback: 'välituotteet' → fortified-wine
  // family → intermediate_products.
  {
    id: '003591',
    name: 'Harveys Bristol Cream',
    abv: 17.5,
    price: 12.98,
    volume: 0.75,
    mainGroupName: ['välituotteet'],
    productGroupName: ['jälkiruokaviinit, väkevöidyt ja muut viinit'],
    packageTypes: ['packageTypeId|packageType_pullo|lasipullo'],
    countryName: 'Espanja',
    webshopStock: 44,
  },
  // Unmapped 'grapat' row resolves through its sibling leaf —
  // first-mappable-token scan ('ginit ja maustetut viinat' → gin →
  // spirits); observed live on row 904045.
  {
    id: '904045',
    name: 'Heidell Hoburg',
    abv: 44.0,
    price: 41.74,
    volume: 0.5,
    mainGroupName: ['väkevät'],
    productGroupName: ['grapat', 'grapat', 'ginit ja maustetut viinat'],
    packageTypes: ['packageTypeId|packageType_pullo|lasipullo'],
    countryName: 'Espanja',
    webshopStock: 6,
  },
  // Unmappable group — drinkware accessory, not a beverage (real live
  // row shape: null abv/volume, no packageTypes, unmapped mainGroup).
  // Per-item rejection to the correction queue; a fallback category
  // assignment is forbidden by the product-normalization spec.
  {
    id: '833275',
    name: 'Iittala Aino Aalto Lasipari',
    abv: null,
    price: 24.9,
    volume: null,
    mainGroupName: ['lahja- ja juomatarvikkeet'],
    productGroupName: ['juomatarvikkeet'],
    countryName: 'Suomi',
    webshopStock: 12,
  },
  // Price-less row (0 EUR) — rejected per-item; the full-catalog sweep
  // observed a price-less row at this id (gift-assortment range).
  {
    id: '833310',
    name: 'Alko Lahjapakkaus Viinipullo',
    abv: 13.0,
    price: 0,
    volume: 0.75,
    mainGroupName: ['viinit'],
    productGroupName: ['punaviinit'],
    packageTypes: ['packageTypeId|packageType_pullo|lasipullo'],
    countryName: 'Suomi',
    webshopStock: 0,
  },
];

/** The golden page — frozen so accidental fixture edits fail loudly. */
export const ALKO_GOLDEN_PAYLOAD: AlkoFixturePage = Object.freeze({
  '@odata.count': ALKO_GOLDEN_ROWS.length,
  value: Object.freeze(ALKO_GOLDEN_ROWS),
});
