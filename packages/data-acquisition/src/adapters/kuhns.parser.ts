/**
 * kuhns.shop Shopify products.json parser (task 3.2, change
 * onboard-shopify-lmdw-merchants; designs D2/D3).
 *
 * Pure function: no I/O, deterministic on its input. The shared Shopify
 * walk (`shopify-products.walk.ts`, task 2.1) strips the products.json
 * envelope and hands every raw product row through the adapter's
 * {@link parseProducts} hook into here.
 *
 * Contract, pinned by the golden fixture
 * (adapters/__fixtures__/kuhns-products.fixture.ts) and the 1.2 sweep
 * (2,012 products / 2,013 variants, 0 page failures):
 *
 * - ABV from the title ONLY through the strict German form
 *   `alc. 12 Vol.-%` — 95.0 % of the sweep's rows. Comma decimals
 *   normalize ("12" → 0.12, "45,8" → 0.458). Range forms ("40,5-46",
 *   "4,9/6,0", "15-17" — measured in the sweep) cannot be honestly
 *   single-valued, so the strict pattern rejects them structurally and
 *   NEITHER bound is parsed: the record is kept with a null ABV through
 *   the keyed-uncertainty ESTIMATED path (honest-over-clever, the alks
 *   precedent — a midpoint guess is still a guess). The other sweep
 *   misses ("alc 36 Vol.-%" without the dot, "alc. 40 Vol." without
 *   `-%`, bare "63,5 Vol.-%") stay unparsed for the same reason. A keyed
 *   zero ("alc. 0,0 Vol.-%") is a real value: the non-alcoholic guard,
 *   not the parser, decides its category fate.
 * - Volume from the title: a single token (`0,75l`, `0,7l`, `25x20ml`
 *   shapes — 95.3 % of the sweep) or a multipack token (`24x0,02l` —
 *   3.6 %). Comma decimals normalize; ml/cl/l scale. The multipack
 *   token resolves to the PER-UNIT volume plus `packCount` —
 *   "24x0,02l" is 24 units of 20 ml, never 24 × 20 ml (the
 *   RawFeedRecord multipack contract, design D1 of
 *   data-quality-and-publication-trust). Unitless forms ("0,7",
 *   "1,0 Ltr." — the sweep's 1.0 % misses) are parsed ONLY when an
 *   unambiguous unit token is present; otherwise volumeMl stays 0
 *   through the ESTIMATED path. Unparsed ABV/volume never drop a row.
 * - Beverage category (design D3 correction: `product_type` is EMPTY on
 *   93.7 % of rows, so title inference carries this store): the typed
 *   `product_type` resolves through `mapSourceCategory` first — the
 *   task 2.2 DE exact-key vocabulary (`wein`, `bier`, `sekt`, `whisky`,
 *   `rum`; `likör`/`vodka` predate it) — then the title's German
 *   beverage tokens, each resolved through the SAME mapper, so both
 *   sources are comparable. Both present must agree on the tax-rule key
 *   (a canonical difference with identical tax treatment is not a
 *   contradiction), and the ABV-guarded mapper keeps an above-22 %
 *   product out of the fermented buckets; a keyed-zero or unparseable
 *   ABV re-keys a typed alcohol outcome to non-alcoholic with the
 *   review hold (change nonalcoholic-catalog-hygiene). A contradiction
 *   drops the row; no inference at all drops the row with a correction
 *   error naming the missing canonical category — the deliberately
 *   unmapped merch terms (juice/water/soft-drink/gift terms) land there
 *   by design, never in a guessed category.
 * - EAN from the variant SKU through the shared accepted-forms reader
 *   (`readEanFromSku`): kuhns SKUs are `ML9500`-shaped internal codes —
 *   100 % of rows ingest EAN-less with the per-row correction error
 *   (design D2; the sweep measured zero bare-13 EAN-shaped SKUs at full
 *   scale). The record is kept.
 * - Prices: Shopify decimal strings ("9.90") converted to integer cents
 *   by string math — never a float round-trip. products.json carries NO
 *   per-row currency (the currency is shop-level, probed EUR via
 *   cart.js and confirmed by the sweep), so rows are EUR by the
 *   registry-pinned store identity, not by a per-row check; a future
 *   multi-currency delivery would be another contract. EUR-native
 *   provenance: `originalPriceCents` = `priceCents`,
 *   `originalCurrency: 'EUR'`, no `fxDatasetVersion`. The variant's
 *   `compare_at_price` is unread (marketing "was" price, design D2).
 * - The FIRST variant carries the record (2,013 variants / 2,012
 *   products; a second variant is out of the one-record-per-row
 *   contract and drops nothing silently — it is simply not read).
 *   `grams` is already integer grams in Shopify (no Woo-style kg
 *   string); absent → null, no error (design D7). `available` →
 *   in_stock/out_of_stock.
 * - `vendor` → manufacturer and brand VERBATIM (design D2): the sweep
 *   found the field mixed (house names `Kuhns Trinkgenuss`,
 *   `Kuhns-onlineshop` and real brands `Talisker`, `Hendrick's`), and
 *   the parser cannot judge which is which — both flow through
 *   unchanged, never classified or cleaned here. `handle` builds the
 *   canonical product URL; a missing handle keeps the record with a
 *   null sourceUrl.
 * - `depositSystem: false` always — German deposits are not Finnish
 *   pantti membership (the cross-border container rule).
 * - No title token names a container in the sweep vocabulary, so
 *   containerType is the CHECK-safe 'other' (never 'unknown' — outside
 *   the migration 0002 CHECK).
 *
 * @module KuhnsParser
 */

import {
  mapSourceCategory,
  NONALCOHOLIC_HOLD_REASON,
} from '@rajahinta/core-domain';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';
import { readEanFromSku } from './alks.parser';

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

/**
 * A parsed products.json row: the canonical feed record plus the feed
 * weight. Same pattern as `AlksParsedRecord`: the shape requires the
 * resolved optional fields so the adapter can return parser output
 * unchanged.
 */
export interface KuhnsParsedRecord extends RawFeedRecord {
  readonly weightGrams: number | null;
  /** Units per multipack; null when the title carries no multipack token. */
  readonly packCount: number | null;
}

/** Per-row parse outcome: the record and/or its correction errors. */
export interface KuhnsProductParseResult {
  readonly record: KuhnsParsedRecord | null;
  readonly errors: readonly string[];
}

// ---------------------------------------------------------------------------
// Payload shapes (only the fields the parser consumes)
// ---------------------------------------------------------------------------

interface KuhnsVariantRow {
  sku?: unknown;
  price?: unknown;
  grams?: unknown;
  available?: unknown;
}

interface KuhnsProductRow {
  id?: unknown;
  title?: unknown;
  handle?: unknown;
  product_type?: unknown;
  vendor?: unknown;
  variants?: unknown;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Shopify decimal price string ("9.90", "42.9", "89") → integer cents
 * by string math ("9.90" → 990, "42.9" → 4290, "89" → 8900) — exact,
 * no float round-trip. Anything else (missing, comma decimal, >2
 * fraction digits, non-numeric) is drift and rejects the row.
 */
function readDecimalCents(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (match === null) return null;
  const whole = Number.parseInt(match[1], 10);
  const fraction = (match[2] ?? '0').padEnd(2, '0');
  return whole * 100 + Number.parseInt(fraction, 10);
}

/** Shopify `grams` is already integer grams; absent or unusable → null. */
function readGrams(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

function readAvailability(
  value: unknown,
): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (value === true) return 'in_stock';
  if (value === false) return 'out_of_stock';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Title parsing — ABV, volume (multipack-aware)
// ---------------------------------------------------------------------------

/**
 * The strict German ABV form, 95.0 % sweep coverage: `alc. 12 Vol.-%`.
 * The unit suffix `Vol.-%` must follow the number immediately, so the
 * sweep's range forms ("40,5-46", "4,9/6,0") fail structurally — exactly
 * the honest-over-clever outcome task 3.2 chose: a range is genuinely
 * ambiguous, so NEITHER bound is parsed and the row rides the ESTIMATED
 * path. Pattern is applied to the lowercased title.
 */
const ABV_PATTERN = /alc\.\s*(\d+(?:[.,]\d+)?)\s*vol\.?-%/;

/** "0,75l", "700 ml", "25x20ml"-shaped units, unit must end the token. */
const VOLUME_PATTERN = /(\d+(?:[.,]\d+)?)\s*(ml|cl|l)(?![a-z])/;

/**
 * Multipack volume token: `pack [x×] unit` — the sweep's Adventskalender
 * shapes ("24x0,02l", "24x0,44l", "25x20ml"). products.json is a JSON
 * string, so the separator arrives as a literal `x` or `×` (the
 * HTML-entity forms of the Woo pattern are a WooCommerce name-encoding
 * artifact that cannot occur here). First number is the PACK, second the
 * per-unit volume.
 */
const MULTIPACK_PATTERN =
  /(\d+)\s*(?:×|x)\s*(\d+(?:[.,]\d+)?)\s*(ml|cl|l)(?![a-z])/;

const VOLUME_TO_ML: Record<string, number> = { ml: 1, cl: 10, l: 1000 };

/** Volume resolved from a title: per-unit millilitres plus the pack count. */
export interface KuhnsParsedVolume {
  /** Per-UNIT volume — never multiplied by the pack count. */
  readonly volumeMl: number;
  /** Units per multipack; null when the title carries no multipack token. */
  readonly packCount: number | null;
}

/**
 * ABV percent from the strict `alc. N Vol.-%` form, 0–100; null when
 * absent (including every range and bare-decimal form — see
 * {@link ABV_PATTERN}). A keyed 0,0 % is a real value, not a miss.
 */
function kuhnsAbvPercent(name: string): number | null {
  const match = ABV_PATTERN.exec(name.toLowerCase());
  if (match === null) return null;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

/** "0,02" + "l" → 20; null when the value or unit is implausible. */
function volumeToMl(value: string, unit: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  const factor = VOLUME_TO_ML[unit];
  if (!Number.isFinite(parsed) || parsed <= 0 || factor === undefined) {
    return null;
  }
  return Math.round(parsed * factor);
}

/**
 * Volume from the title, multipack-aware: a `pack × unit` token resolves
 * to the per-unit volume plus the pack count ("24x0,02l" → 20 ml, 24).
 * A malformed multipack token falls through to the single-token parse;
 * unitless forms ("0,7", "1,0 Ltr." — no unambiguous unit token) never
 * match and stay 0 through the ESTIMATED path. Null when no plausible
 * volume token exists.
 */
function parseKuhnsVolume(name: string): KuhnsParsedVolume | null {
  const lowered = name.toLowerCase();

  const multipack = MULTIPACK_PATTERN.exec(lowered);
  if (multipack !== null) {
    const pack = Number.parseInt(multipack[1], 10);
    const unitMl = volumeToMl(multipack[2], multipack[3]);
    if (pack >= 1 && unitMl !== null) {
      return { volumeMl: unitMl, packCount: pack };
    }
  }

  const match = VOLUME_PATTERN.exec(lowered);
  if (match === null) return null;
  const volumeMl = volumeToMl(match[1], match[2]);
  return volumeMl === null ? null : { volumeMl, packCount: null };
}

// ---------------------------------------------------------------------------
// Category resolution — product_type first, title tokens second
// ---------------------------------------------------------------------------

type SourceCategoryMapping = NonNullable<
  ReturnType<typeof mapSourceCategory>
>;

/**
 * Beverage-type words the 1.2 sweep census attests for kuhns titles,
 * each resolved through `mapSourceCategory` — the same mapping authority
 * as `product_type`, so both sources are comparable and the
 * ABV-boundary and non-alcoholic guards apply identically. Checked
 * word-bounded in list order; the first token with a canonical mapping
 * wins ("Weißwein"-style compounds stay unmapped — stemming German
 * compounds would be a guess machine; those rows land in the correction
 * queue honestly). All listed tokens resolve today: the DE nouns ride
 * the task 2.2 keys (`wein`, `bier`, `sekt`, `whisky`, `rum`, `likör`),
 * `calvados` has its own key, and the international spirits/sparkling
 * nouns resolve through `normalizeCategory`.
 */
const TITLE_BEVERAGE_TOKENS = [
  'whisky',
  'whiskey',
  'rum',
  'cognac',
  'brandy',
  'calvados',
  'tequila',
  'gin',
  'vodka',
  'likör',
  'sekt',
  'prosecco',
  'champagne',
  'vermouth',
  'sherry',
  'wein',
  'bier',
] as const;

/** Word-bounded contains: "Ginger" must not match "gin", "Liköre" stays plural-exact. */
function wordBoundedPattern(token: string): RegExp {
  return new RegExp(`(?<![a-z])${token}(?![a-z])`);
}

const BEVERAGE_PATTERNS = TITLE_BEVERAGE_TOKENS.map((token) => ({
  token,
  pattern: wordBoundedPattern(token),
}));

/**
 * First title token with a canonical beverage mapping, in token order.
 * The 93.7 % empty-`product_type` majority classifies here (design D3
 * correction); an unmapped title resolves null and the row drops.
 */
function nameImpliedMapping(
  name: string,
  abv: number | null,
): SourceCategoryMapping | null {
  const lowered = name.toLowerCase();
  for (const { token, pattern } of BEVERAGE_PATTERNS) {
    if (!pattern.test(lowered)) continue;
    const mapping = mapSourceCategory(token, abv);
    if (mapping !== null) return mapping;
  }
  return null;
}

/** The row's `product_type` through the mapper, when present and mapped. */
function productTypeImpliedMapping(
  productType: unknown,
  abv: number | null,
): SourceCategoryMapping | null {
  const name = readNonEmptyString(productType);
  if (name === null) return null;
  return mapSourceCategory(name, abv);
}

// ---------------------------------------------------------------------------
// Per-row parse
// ---------------------------------------------------------------------------

/** The registry-pinned store URL (design D8) — the sourceUrl base. */
const KUHNS_STORE_BASE_URL = 'https://kuhns.shop';

/**
 * Parse a single Shopify products.json product row.
 *
 * Structural failures (no title, no usable variant, unusable price) and
 * the category contradiction or a no-inference row drop the row with a
 * per-row error — the correction-queue surface shared with the alks
 * parser. A non-matching SKU (every kuhns row) and unparsed ABV/volume
 * keep the record by design (D2/D3); weight never errors (D7).
 */
export function parseKuhnsProduct(row: unknown): KuhnsProductParseResult {
  if (typeof row !== 'object' || row === null) {
    return { record: null, errors: ['kuhns product row is not a JSON object'] };
  }
  const product = row as KuhnsProductRow;

  const id = typeof product.id === 'number' && Number.isFinite(product.id)
    ? String(product.id)
    : String(product.id ?? '(unknown)');

  // The FIRST variant carries price/SKU/weight/availability. products.json
  // always ships a variants array; an unusable one leaves nothing to
  // ingest — the row drops naming the product.
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variant = typeof variants[0] === 'object' && variants[0] !== null
    ? (variants[0] as KuhnsVariantRow)
    : null;
  if (variant === null) {
    return {
      record: null,
      errors: [
        `Failed to map kuhns product ${id}: has no usable product variant to price — ` +
          'flagged for the correction queue',
      ],
    };
  }

  const variantSku = readNonEmptyString(variant.sku);
  const label = `kuhns product ${id}${variantSku !== null ? ` (SKU ${variantSku})` : ''}`;

  const title = readNonEmptyString(product.title);
  if (title === null) {
    return {
      record: null,
      errors: [`Failed to map ${label}: missing or empty product title`],
    };
  }

  const priceCents = readDecimalCents(variant.price);
  if (priceCents === null) {
    return {
      record: null,
      errors: [
        `Failed to map ${label}: missing or invalid decimal price "${String(variant.price)}"`,
      ],
    };
  }

  // D2: a non-matching SKU is never guessed around — the record is kept
  // without an EAN and the correction error names the SKU. Every kuhns
  // row lands here (ML-shaped internal codes, sweep-measured 100 %).
  const ean = readEanFromSku(variantSku);
  const errors: string[] = [];
  if (variantSku !== null && ean === null) {
    errors.push(
      `Failed to map ${label}: SKU "${variantSku}" does not match any accepted ` +
        'EAN SKU form (^[a-z]{2}-\\d{13}$, ^\\d{13}$, ^0\\d{13}$) — ' +
        'record kept without an EAN, flagged for the correction queue',
    );
  }

  // D3 (correction): `product_type` is empty on 93.7 % of rows, so the
  // typed minority resolves through the mapped product_type and the
  // untyped majority through the title tokens. Both present must agree —
  // on the tax-rule key the record actually carries (liqueur and spirits
  // share it; a canonical difference with identical tax treatment is not
  // a contradiction). Both sources resolve through the ABV-guarded
  // mapper: the title-parsed fraction feeds the EU intermediate-products
  // ceiling, and a keyed-zero or unparseable ABV re-keys a typed alcohol
  // outcome to non-alcoholic (the guard is not keyed by an omitted
  // argument — none exists here, the fraction is always offered).
  const abvPercent = kuhnsAbvPercent(title);
  // kuhnsAbvPercent is bounded 0–100, so the fraction is always 0–1: the
  // scale the mapper requires (it throws RangeError on anything else).
  const abvFraction = abvPercent !== null ? abvPercent / 100 : null;
  const fromProductType = productTypeImpliedMapping(
    product.product_type,
    abvFraction,
  );
  const fromName = nameImpliedMapping(title, abvFraction);

  let mapping: SourceCategoryMapping | null;
  if (fromProductType !== null && fromName !== null) {
    if (fromProductType.taxCategory !== fromName.taxCategory) {
      return {
        record: null,
        errors: [
          ...errors,
          `Failed to map ${label}: name implies ${fromName.taxCategory} but product_type implies ` +
            `${fromProductType.taxCategory} — disagreeing sources are never silently resolved, ` +
            'flagged for the correction queue',
        ],
      };
    }
    // Agreeing sources agree on the tax key; when exactly one side
    // carried the non-alcoholic guard, the guarded outcome wins so a
    // hold never cancels on agreement (the alks gate verbatim).
    mapping =
      fromProductType.nonAlcoholicHold === true
        ? fromProductType
        : fromName.nonAlcoholicHold === true
          ? fromName
          : fromProductType;
  } else {
    mapping = fromProductType ?? fromName;
  }

  if (mapping === null) {
    return {
      record: null,
      errors: [
        ...errors,
        `Failed to map ${label}: product_type and title yield no canonical beverage category — ` +
          'flagged for the correction queue',
      ],
    };
  }

  // Non-alcoholic ingestion guard (change nonalcoholic-catalog-hygiene,
  // design D3): the mapper re-keyed a typed alcohol outcome to
  // non-alcoholic because the ABV is zero or unparseable. The row STILL
  // ingests (the ESTIMATED-status contract for unparseable fields is
  // untouched) but carries the correction error and the machine-readable
  // review hold the persistence layer stamps onto review_hold_reason.
  const held = mapping.nonAlcoholicHold === true;
  if (held) {
    errors.push(
      `Held for review ${label}: ABV is ${abvPercent === 0 ? '0' : 'unparseable'} but the ` +
        'product_type or title resolves to an alcohol category — non-alcoholic rows are ' +
        `barred from alcohol categories, ingested as non-alcoholic with hold reason ` +
        `${NONALCOHOLIC_HOLD_REASON}, flagged for the correction queue`,
    );
  }

  const volume = parseKuhnsVolume(title);
  // Mixed house/real-brand vendor (1.2 sweep): passed through verbatim —
  // the parser cannot judge which a string is, and design D2 pins the
  // vendor → manufacturer + brand mapping without cleaning.
  const vendor = readNonEmptyString(product.vendor) ?? '';
  const handle = readNonEmptyString(product.handle);

  const record: KuhnsParsedRecord = {
    productId: variantSku ?? id,
    productName: title,
    manufacturer: vendor,
    brand: vendor,
    category: mapping.taxCategory,
    alcoholByVolume: abvPercent !== null ? abvPercent / 100 : null,
    volumeMl: volume?.volumeMl ?? 0,
    packCount: volume?.packCount ?? null,
    // No container token exists in the kuhns sweep vocabulary — the
    // CHECK-safe default, never 'unknown' (outside the migration 0002
    // CHECK's value set).
    containerType: 'other',
    regulatoryClassification: mapping.taxCategory,
    // Cross-border container: Finnish pantti membership is unknown at
    // the feed level, never assumed true for a foreign merchant.
    depositSystem: false,
    ean,
    priceCents,
    currency: 'EUR',
    // EUR-native (shop-level currency, probe + sweep): canonical and
    // original amounts are the same cents; no fxDatasetVersion — absence
    // marks the no-conversion path. compare_at_price is never read (D2).
    originalPriceCents: priceCents,
    originalCurrency: 'EUR',
    availability: readAvailability(variant.available),
    // The canonical Shopify product URL from the row's handle; missing
    // handle → null, record kept.
    sourceUrl: handle !== null ? `${KUHNS_STORE_BASE_URL}/products/${handle}` : null,
    weightGrams: readGrams(variant.grams),
    // The guard's review hold rides the record to persistence (null when
    // not held — the KuhnsParsedRecord shape requires the resolved
    // value, same pattern as weightGrams).
    reviewHoldReason: held ? NONALCOHOLIC_HOLD_REASON : null,
  };

  return { record, errors };
}

// ---------------------------------------------------------------------------
// Payload parse
// ---------------------------------------------------------------------------

/**
 * Parse the collected products.json rows — the array the shared walk
 * assembled across pages — into canonical records plus per-row
 * correction errors. Valid rows are never dropped for parse failures
 * they can survive (non-matching SKU, unparsed ABV/volume); rows are
 * skipped only for structural invalidity or a category contradiction,
 * always with an error naming them.
 */
export function parseKuhnsProducts(payload: unknown): {
  records: KuhnsParsedRecord[];
  errors: string[];
} {
  const records: KuhnsParsedRecord[] = [];
  const errors: string[] = [];

  if (!Array.isArray(payload)) {
    return {
      records,
      errors: ['kuhns payload is not a JSON array of Shopify products'],
    };
  }

  for (const row of payload) {
    const { record, errors: rowErrors } = parseKuhnsProduct(row);
    errors.push(...rowErrors);
    if (record !== null) records.push(record);
  }

  return { records, errors };
}
