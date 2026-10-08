/**
 * Golden dataset for the bottleofitaly.com Shopify products.json feed
 * (task 3.1, change onboard-shopify-lmdw-merchants).
 *
 * The rows distill the 1.1 sweep reality (22,937-product census,
 * notes §1.1) into one row per parser branch, in the live field
 * shapes: `custom-gradazione-XX-X` ABV tags riding noisy decorative
 * tags, decimal-string variant prices with the marketing
 * `compare_at_price` alongside (present-but-ignored, design D2),
 * `barcode` null on every row (0 across the live catalog — the field
 * is unread; EAN provenance is the accepted SKU forms only), integer
 * `grams`, "Default Title" variant titles, and `product_type` from
 * the census vocabulary. Every SKU is an internal code — none matches
 * an accepted EAN form — so each kept row carries the per-row SKU
 * correction error, the 99.8 %-of-catalog EAN-less reality.
 *
 * Branch coverage: tag-ABV `40-0` and `41-5` forms; title volume
 * (dot-free comma decimals, `cl`); the whole-tag volume fallback
 * (`75cl`-shaped tag, the sweep's discovery); wine with no volume
 * anywhere → honest 0 ml + ESTIMATED; a beverage with no gradazione
 * tag → null ABV through the non-alcoholic guard; the `Birra`
 * multipack title (`24 x 33 cl` → packCount 24, per-unit 330); the
 * merch pair `Olio`/`Aceto` dropping to the correction queue.
 *
 * @module BottleofItalyProductsFixture
 */

/**
 * Shopify variant shape, narrowed to the fields the parser consumes
 * plus the two it deliberately ignores: `compare_at_price` (marketing
 * "was" price, design D2) and `barcode` (0 across the live catalog).
 */
export interface BottleofItalyFixtureVariant {
  readonly title: string;
  readonly sku: string | null;
  readonly barcode: null;
  readonly grams: number | null;
  readonly price: string;
  readonly compare_at_price?: string | null;
  readonly available: boolean;
}

/** Shopify product shape, narrowed to the fields the parser consumes. */
export interface BottleofItalyFixtureProduct {
  readonly id: number;
  readonly title: string;
  readonly handle: string | null;
  readonly product_type: string | null;
  readonly vendor: string;
  readonly tags: readonly string[];
  readonly variants: readonly BottleofItalyFixtureVariant[];
}

export const BOTTLEOFITALY_GOLDEN_PRODUCTS: readonly BottleofItalyFixtureProduct[] = [
  // Spirits row — the sweep's dominant parent (7,616, 33.2 %). Tag-ABV
  // `40-0` → 0.40; title volume `0,5 l` → 500 ml; the marketing
  // compare_at_price rides along present-but-ignored (design D2);
  // grams → weightGrams; internal-code SKU → EAN-less with the
  // per-row correction error.
  {
    id: 820001,
    title: 'Grappa di Barolo 0,5 l',
    handle: 'grappa-di-barolo-05-l',
    product_type: 'Spirits',
    vendor: 'Sibona',
    tags: ['sibona', 'custom-gradazione-40-0', 'distillati', 'italia'],
    variants: [
      {
        title: 'Default Title',
        sku: 'GRAPPA-BAROLO-500',
        barcode: null,
        grams: 750,
        price: '25.90',
        compare_at_price: '35.00',
        available: true,
      },
    ],
  },
  // The `41-5` decimal-halves tag form → 0.415 — the other gradazione
  // shape the sweep pinned. Title `70cl` → 700 ml; sold out variant.
  {
    id: 820002,
    title: 'Single Malt Whisky 70cl',
    handle: 'single-malt-whisky-70cl',
    product_type: 'Spirits',
    vendor: 'Glen Elgin',
    tags: ['whisky', 'custom-gradazione-41-5', 'scotch'],
    variants: [
      {
        title: 'Default Title',
        sku: 'WHISKY-SM-70',
        barcode: null,
        grams: 1400,
        price: '48.00',
        available: false,
      },
    ],
  },
  // Still-wine leaf (`Vino Rosso`, 6,128, 26.7 %) with the comma-
  // decimal title form `0,75 l` → 750 ml and a `12-5` tag → 0.125.
  {
    id: 820003,
    title: 'Chianti Classico 0,75 l',
    handle: 'chianti-classico-075-l',
    product_type: 'Vino Rosso',
    vendor: 'Ruffino',
    tags: ['vino', 'custom-gradazione-12-5', 'toscana'],
    variants: [
      {
        title: 'Default Title',
        sku: 'CHIANTI-CC-75',
        barcode: null,
        grams: 1250,
        price: '14.50',
        available: true,
      },
    ],
  },
  // The sweep-discovered whole-tag volume fallback: the title carries
  // no volume token, but a tag IS the bottle size (`75cl`, anchored
  // full-tag form) → 750 ml. Still wine → wine_still.
  {
    id: 820004,
    title: 'Barolo DOCG',
    handle: 'barolo-docg',
    product_type: 'Vino Rosso',
    vendor: 'Vietti',
    tags: ['vino', 'custom-gradazione-14-0', '75cl', 'piemonte'],
    variants: [
      {
        title: 'Default Title',
        sku: 'BAROLO-DOCG-75',
        barcode: null,
        grams: 1300,
        price: '29.50',
        available: true,
      },
    ],
  },
  // The wine ESTIMATED-volume bucket (11,975 rows, 52.2 %): ABV tag
  // present, no volume token in the title or any tag → honest 0 ml,
  // record kept (design D2 — never guessed).
  {
    id: 820005,
    title: 'Barbaresco DOCG',
    handle: 'barbaresco-docg',
    product_type: 'Vino Rosso',
    vendor: 'Produttori Barbaresco',
    tags: ['vino', 'custom-gradazione-13-5', 'piemonte'],
    variants: [
      {
        title: 'Default Title',
        sku: 'BARBARESCO-75',
        barcode: null,
        grams: 1300,
        price: '32.00',
        available: true,
      },
    ],
  },
  // `Birra` (378, 1.6 %) with the multipack title convention
  // (`24 x 33 cl` → packCount 24, per-unit volumeMl 330 — design D1,
  // data-quality-and-publication-trust).
  {
    id: 820006,
    title: 'Birra Artigianale 24 x 33 cl',
    handle: 'birra-artigianale-24x33-cl',
    product_type: 'Birra',
    vendor: 'Baladin',
    tags: ['birra', 'custom-gradazione-6-5', 'artigianale'],
    variants: [
      {
        title: 'Default Title',
        sku: 'BIRRA-ART-24X33',
        barcode: null,
        grams: 10500,
        price: '68.00',
        available: true,
      },
    ],
  },
  // The no-tag beverage (7.3 % of the catalog): no gradazione tag →
  // null ABV through the non-alcoholic guard — the row STILL ingests,
  // re-keyed to the non-alcoholic tax key with the review hold and
  // the correction error (change nonalcoholic-catalog-hygiene).
  {
    id: 820007,
    title: 'Vernaccia di San Gimignano 0,75 l',
    handle: 'vernaccia-di-san-gimignano-075-l',
    product_type: 'Vino Bianco',
    vendor: 'Antinori',
    tags: ['vino', 'toscana', 'bianco'],
    variants: [
      {
        title: 'Default Title',
        sku: 'VERNACCIA-75',
        barcode: null,
        grams: 1250,
        price: '11.90',
        available: true,
      },
    ],
  },
  // Merch pair, first half (design D3/D8): `Olio` (430) maps to no
  // canonical beverage category — the row DROPS with a correction
  // error naming the type, never a guessed tax key.
  {
    id: 820008,
    title: 'Olio Extravergine di Oliva 0,5 l',
    handle: 'olio-extravergine-05-l',
    product_type: 'Olio',
    vendor: 'Frantoio Primo',
    tags: ['olio', 'toscano'],
    variants: [
      {
        title: 'Default Title',
        sku: 'OLIO-EVO-500',
        barcode: null,
        grams: 550,
        price: '12.00',
        available: true,
      },
    ],
  },
  // Merch pair, second half: `Aceto` (171) drops like `Olio`. The
  // title carries a volume token — the row still drops by category
  // (the sweep's volume-only merch bucket, 5.0 %).
  {
    id: 820009,
    title: 'Aceto Balsamico di Modena 500 ml',
    handle: 'aceto-balsamico-di-modena',
    product_type: 'Aceto',
    vendor: 'Giusti',
    tags: ['aceto', 'modena'],
    variants: [
      {
        title: 'Default Title',
        sku: 'ACETO-G-250',
        barcode: null,
        grams: 350,
        price: '8.90',
        available: true,
      },
    ],
  },
];

/** The payload envelope the shared walk strips before parsing. */
export function bottleofItalyPage(
  products: readonly BottleofItalyFixtureProduct[],
): { products: readonly unknown[] } {
  return { products };
}

export const BOTTLEOFITALY_GOLDEN_PAYLOAD: { products: readonly unknown[] } =
  bottleofItalyPage(BOTTLEOFITALY_GOLDEN_PRODUCTS);
