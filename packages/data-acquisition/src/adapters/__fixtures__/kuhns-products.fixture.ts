/**
 * Golden dataset for the kuhns.shop Shopify products.json feed (task 3.2,
 * change onboard-shopify-lmdw-merchants).
 *
 * Per-merchant fixture (NOT the shared ingestion-gate file): the Shopify
 * products.json row shape is the walk's raw row minus the envelope, so
 * the types pin exactly the fields the parser consumes plus the fields
 * pinned as present-but-ignored (`handle` rides along, `compare_at_price`
 * is deliberately absent — the parser must never read it). Row 1 is the
 * probe-baseline shape (notes §Probe: `Wein`, `Kuhns Trinkgenuss`,
 * `ML9500`-shaped SKU, grams present); the rest pin every parser branch
 * the 1.2 sweep measured: the 93.7 % empty-`product_type` bucket riding
 * title inference, the 3.6 % multipack token (`24x0,02l`), the range-ABV
 * forms (`4,9-6,0 Vol.-%`) parsed on NEITHER bound, the unitless
 * `1,0 Ltr.` volume miss, the `alc. 0,0 Vol.-%` hygiene-hold row, the
 * product_type-vs-title contradiction, and the deliberately-unmapped
 * merch term (`Bio Direktsaft`). Six of eight rows are kept — the
 * per-row noise is the EAN-less SKU correction on every row (100 % of
 * the sweep, `ML` internal codes) plus the review-hold lines the live
 * hygiene rule stamps on rows whose ABV is keyed zero or unparseable in
 * an alcohol category, mirroring the alks reality.
 *
 * @module KuhnsProductsFixture
 */

/** Shopify product variant — the price/grams/available/sku carrier. */
export interface KuhnsFixtureVariant {
  readonly id: number;
  readonly sku: string;
  /** Shopify decimal price string in the store currency ("9.90"). */
  readonly price: string;
  readonly grams?: number;
  readonly available: boolean;
  /** Crossed-out "was" price — pinned absent: never read (design D2). */
  readonly compare_at_price?: never;
}

/** Shopify products.json product row — the fields the parser consumes. */
export interface KuhnsFixtureProduct {
  readonly id: number;
  readonly title: string;
  /** URL slug; the sourceUrl handle pattern builds the product link. */
  readonly handle?: string;
  /** The store's DE product_type — empty string on 93.7 % of live rows. */
  readonly product_type: string;
  /** Mixed house + real-brand vendor names (1.2 sweep finding). */
  readonly vendor: string;
  readonly variants: readonly KuhnsFixtureVariant[];
}

export const KUHNS_GOLDEN_PRODUCTS: readonly KuhnsFixtureProduct[] = [
  // Typed row (`Wein`, one of the 127 typed census rows): mapped
  // product_type, strict ABV form `alc. 12 Vol.-%`, comma-decimal volume
  // `0,75l`, house vendor, ML-code SKU → EAN-less with correction.
  {
    id: 6601001,
    title: 'Kuhns Riesling trocken alc. 12 Vol.-% 0,75l',
    handle: 'kuhns-riesling-trocken',
    product_type: 'Wein',
    vendor: 'Kuhns Trinkgenuss',
    variants: [
      { id: 39300001, sku: 'ML9501', price: '9.90', grams: 1250, available: true },
    ],
  },
  // The untyped majority (93.7 %): empty product_type, classification
  // rides the title token `Whisky` → spirits (design D3 correction).
  // Real-brand vendor (`Talisker`) passed through verbatim; no grams →
  // weightGrams null without an error (design D7).
  {
    id: 6601002,
    title: 'Talisker 10 Years Single Malt Scotch Whisky alc. 45,8 Vol.-% 0,7l',
    handle: 'talisker-10-years-single-malt',
    product_type: '',
    vendor: 'Talisker',
    variants: [
      { id: 39300002, sku: 'ML4021', price: '42.90', available: true },
    ],
  },
  // Multipack token (the sweep's 3.6 % Adventskalender shape):
  // `24x0,02l` → packCount 24, volumeMl 20 PER UNIT — never 24 × 20 ml.
  // No handle → sourceUrl null; `available: false` → out_of_stock.
  {
    id: 6601003,
    title: 'Kuhns Whisky Adventskalender 2026 alc. 40 Vol.-% 24x0,02l',
    product_type: '',
    vendor: 'Kuhns-onlineshop',
    variants: [
      { id: 39300003, sku: 'ML7730', price: '89.00', grams: 4000, available: false },
    ],
  },
  // Range ABV (`4,9-6,0 Vol.-%`, the sweep's honest-ambiguity form):
  // NEITHER bound is parsed — the record is kept with alcoholByVolume
  // null through the keyed-uncertainty ESTIMATED path (alks precedent).
  // Typed `Bier` and the title token `Bier` agree; with the ABV
  // unparseable, the live non-alcoholic guard re-keys the agreed
  // outcome with the review hold (the row still ingests, ESTIMATED).
  // `12x0,33l` → packCount 12, per-unit 330 ml.
  {
    id: 6601004,
    title: 'Kuhns Craft Bier Paket alc. 4,9-6,0 Vol.-% 12x0,33l',
    handle: 'kuhns-craft-bier-paket',
    product_type: 'Bier',
    vendor: 'Kuhns Trinkgenuss',
    variants: [
      { id: 39300004, sku: 'ML8104', price: '39.90', grams: 9500, available: true },
    ],
  },
  // Contradiction gate: mapped `Wein` (wine_still) vs the title token
  // `Whisky` (spirits) — disagreeing sources are never silently
  // resolved; the row is dropped for the correction queue (design D3).
  {
    id: 6601005,
    title: 'Kuhns Geschenkset Wein und Whisky alc. 40 Vol.-% 0,7l',
    handle: 'kuhns-geschenkset-wein-whisky',
    product_type: 'Wein',
    vendor: 'Kuhns Trinkgenuss',
    variants: [
      { id: 39300005, sku: 'ML9002', price: '29.90', grams: 1800, available: true },
    ],
  },
  // Deliberately-unmapped merch (`Bio Direktsaft`, the strict
  // non-beverage list in the task 2.2 keys): no product_type mapping and
  // no title token → dropped with a correction error naming the missing
  // canonical category.
  {
    id: 6601006,
    title: 'Kuhns Bio Direktsaft Apfel naturtrüb 1,0l',
    handle: 'kuhns-bio-direktsaft-apfel',
    product_type: 'Bio Direktsaft',
    vendor: 'Kuhns Trinkgenuss',
    variants: [
      { id: 39300006, sku: 'ML5510', price: '4.50', grams: 1100, available: true },
    ],
  },
  // The sweep's `alc. 0,0 Vol.-%` shape: the ABV parses as keyed zero,
  // the title token `Sekt` resolves to an alcohol category, and the
  // non-alcoholic ingestion guard re-keys the row to non-alcoholic with
  // the review hold (change nonalcoholic-catalog-hygiene) — ingested,
  // held from user-facing surfaces.
  {
    id: 6601007,
    title: 'Kuhns Alkoholfreier Sekt alc. 0,0 Vol.-% 0,75l',
    handle: 'kuhns-alkoholfreier-sekt',
    product_type: '',
    vendor: 'Kuhns Trinkgenuss',
    variants: [
      { id: 39300007, sku: 'ML6620', price: '6.90', grams: 1300, available: true },
    ],
  },
  // The unitless volume miss (1.0 % of the sweep): `1,0 Ltr.` has no
  // unambiguous unit token, so volumeMl stays 0 through the ESTIMATED
  // path — never guessed from the bare decimal. ABV and category
  // (`Wein` mapped, title token agreeing) resolve normally.
  {
    id: 6601008,
    title: 'Kuhns Wein Probierpaket alc. 12,5 Vol.-% 1,0 Ltr.',
    handle: 'kuhns-wein-probierpaket',
    product_type: 'Wein',
    vendor: 'Kuhns Trinkgenuss',
    variants: [
      { id: 39300008, sku: 'ML3305', price: '49.90', grams: 6500, available: true },
    ],
  },
];

/** The walk hands the parser the raw `{ products: [...] }` rows array. */
export const KUHNS_GOLDEN_PAYLOAD: readonly KuhnsFixtureProduct[] =
  KUHNS_GOLDEN_PRODUCTS;
