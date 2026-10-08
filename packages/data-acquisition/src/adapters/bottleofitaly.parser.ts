/**
 * bottleofitaly.com Shopify products.json parser (task 3.1, change
 * onboard-shopify-lmdw-merchants; designs D2/D3).
 *
 * Pure function: no I/O, deterministic on its input. The shared walk
 * (`shopify-products.walk.ts`, task 2.1) owns fetching and pagination
 * and hands raw product rows through the `parseProducts` hook here.
 *
 * Extraction promoted from the 1.1 sweep prototype
 * (scripts/bottleofitaly-catalog-sweep.ts — 22,937-product census,
 * notes §1.1), so the parser is never the first time the extraction
 * runs. Contract, pinned by the golden fixture
 * (adapters/__fixtures__/bottleofitaly-products.fixture.ts):
 *
 * - ABV from the `custom-gradazione-XX-X` tag — the store admin's
 *   integer + decimal-halves form (`40-0` → 0.40, `41-5` → 0.415),
 *   matched as a substring exactly as the sweep matched it. A tag
 *   below the > 0 filter (0-0) is no honest ABV: null, like a missing
 *   tag. No tag on 7.3 % of the live catalog → null ABV via the
 *   keyed-uncertainty ESTIMATED path — never guessed, never dropped.
 * - Volume fallback chain (sweep-decided, design D2): title token
 *   first (`20cl`, `0,75 l` — comma decimals, case-insensitive,
 *   `l` → ×1000; the alks `parseVolume` convention, which also carries
 *   the `pack × unit` multipack reading), then the sweep-discovered
 *   whole-tag volume (a tag that IS a volume: `75cl`, `150cl` —
 *   anchored to the full tag so `custom-gradazione-40-0` never
 *   matches), then the honest `0 ml` + ESTIMATED path for the 54.6 %
 *   (mostly wine) with no volume token anywhere. Variant title and
 *   description are measured dead ends (0.0 % / 0.9 %) and are not
 *   consulted.
 * - Category from `product_type` through `mapSourceCategory`, fed the
 *   tag-parsed ABV fraction so the EU intermediate-products boundary
 *   and the non-alcoholic ingestion guard key exactly as the alks
 *   parser keys them (design D3). BOI's product_type covers 92.8 % of
 *   the catalog; the name-token second source is the kuhns-side
 *   mechanism (93.7 % of kuhns rows are untyped — BOI rows are not)
 *   and is deliberately absent here. Unmappable types (`Olio`, `Aceto`
 *   merch; `Altro`, `Gadget`, `Buoni regalo`; bare `Vino`; missing)
 *   drop the row with a per-row correction error naming the type —
 *   the mydrink/araxes correction-queue precedent, never a guessed
 *   tax key.
 * - EAN from the variant SKU through the shared accepted-forms reader
 *   (`readEanFromSku`): 99.8 % of BOI SKUs are internal codes, so rows
 *   ingest EAN-less with a per-row correction error, record KEPT
 *   (design D2 — never guessed around). The `barcode` field is unread:
 *   0 across the whole live catalog, and EAN provenance is the SKU
 *   forms only.
 * - Prices are Shopify decimal strings ("25.90", dot-decimal only —
 *   all 23,039 live variants parseable per the sweep) → integer EUR
 *   cents. EUR-native: `originalPriceCents` = `priceCents`,
 *   `originalCurrency: 'EUR'`, no `fxDatasetVersion` — absence marks
 *   the no-conversion path. `compare_at_price` is unread (design D2:
 *   marketing "was" price, not original-price provenance).
 * - `vendor` → both `manufacturer` and `brand` (design D2: BOI's
 *   vendor is the brand); `grams` → `weightGrams` (integer grams,
 *   unusable/absent → null without an error, design D7); the first
 *   variant's `available` flag → availability — one record per
 *   product row, first variant, deterministically (102 of 22,937
 *   products carry more than one variant; per-variant expansion is
 *   not this change's scope).
 * - `depositSystem: false` always — Italian deposits are not Finnish
 *   pantti. No container tokens are swept for Italian titles: the
 *   CHECK-safe 'other' default stands.
 *
 * @module BottleofItalyParser
 */

import {
  mapSourceCategory,
  NONALCOHOLIC_HOLD_REASON,
} from '@rajahinta/core-domain';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';
import { parseVolume, readEanFromSku } from './alks.parser';

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

/**
 * A parsed products.json row: the canonical feed record plus the
 * resolved optional fields, so the adapter can return parser output
 * unchanged — the `AlksParsedRecord` pattern.
 */
export interface BottleofItalyParsedRecord extends RawFeedRecord {
  readonly weightGrams: number | null;
  /** Units per multipack; null when the title carries no multipack token. */
  readonly packCount: number | null;
  /** The non-alcoholic guard's review hold; null when not held. */
  readonly reviewHoldReason: string | null;
}

/** Per-row parse outcome: the record and/or its correction errors. */
export interface BottleofItalyProductParseResult {
  readonly record: BottleofItalyParsedRecord | null;
  readonly errors: readonly string[];
}

// ---------------------------------------------------------------------------
// Payload shapes (only the fields the parser consumes)
// ---------------------------------------------------------------------------

interface BottleofItalyVariant {
  title: string | null;
  sku: string | null;
  grams: number | null;
  price: string | null;
  available: boolean | null;
}

interface BottleofItalyProductRow {
  id?: unknown;
  title?: unknown;
  handle?: unknown;
  productType: string | null;
  vendor: string | null;
  tags: readonly string[];
  variants: readonly BottleofItalyVariant[];
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
 * Shopify product tags: an array of strings in products.json. The
 * sweep also met a comma-joined string form and split it — promoted
 * verbatim so a platform format quirk cannot silently blind the tag
 * extraction.
 */
function readTags(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value
      .map(readNonEmptyString)
      .filter((tag): tag is string => tag !== null);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');
  }
  return [];
}

function readVariant(raw: unknown): BottleofItalyVariant {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    title: readNonEmptyString(record['title']),
    sku: readNonEmptyString(record['sku']),
    grams: typeof record['grams'] === 'number' && Number.isFinite(record['grams'])
      ? record['grams']
      : null,
    price: readNonEmptyString(record['price']),
    available: typeof record['available'] === 'boolean' ? record['available'] : null,
  };
}

function readProductRow(row: unknown): BottleofItalyProductRow {
  const record = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
  return {
    id: record['id'],
    title: record['title'],
    handle: record['handle'],
    productType: readNonEmptyString(record['product_type']),
    vendor: readNonEmptyString(record['vendor']),
    tags: readTags(record['tags']),
    variants: Array.isArray(record['variants'])
      ? record['variants'].map(readVariant)
      : [],
  };
}

function readAvailability(available: boolean | null): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (available === true) return 'in_stock';
  if (available === false) return 'out_of_stock';
  return 'unknown';
}

/** Integer grams straight from the variant (`grams` is already grams,
 *  unlike the Woo kg strings); unusable or zero → null, never an error. */
function readWeightGrams(grams: number | null): number | null {
  return grams !== null && grams > 0 ? grams : null;
}

// ---------------------------------------------------------------------------
// Extraction — promoted from the 1.1 sweep prototype
// ---------------------------------------------------------------------------

/**
 * The `custom-gradazione-XX-X` tag form, matched as a substring per the
 * sweep spec — the `custom-` prefix the store admin adds is not part of
 * the match. `40-0` → 40.0, `41-5` → 41.5 (integer + decimal-halves).
 */
const TAG_ABV_PATTERN = /gradazione-(\d+)-(\d+)/i;

/**
 * A tag that IS a volume: `75cl`, `150cl`, `0,75 l` — anchored to the
 * full tag so `custom-gradazione-40-0` and `cantine-riunite` never
 * match. Discovered in sweep run 1: BOI wine carries its bottle size
 * as a tag.
 */
const TAG_VOLUME_PATTERN = /^(\d+[.,]?\d*)\s*(cl|ml|l)$/i;

/** Shopify variant prices are decimal strings ("25.90"); dot-decimal only. */
const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

/** The registry storefront root (design D8) — product URLs build from handles. */
const STOREFRONT_BASE_URL = 'https://bottleofitaly.com';

function unitFactorMl(unit: string): number {
  const lowered = unit.toLowerCase();
  if (lowered === 'ml') return 1;
  if (lowered === 'cl') return 10;
  return 1000;
}

/**
 * ABV percentage from the gradazione tag, 41.5-form included; null
 * when no tag matches or the value fails the plausibility window —
 * the sweep's > 0 honesty filter (a `0-0` tag is no parseable alcohol
 * content) capped at 100 like the alks `parseAbvPercent` bound, so a
 * fat-fingered tag can never reach the mapper as an out-of-scale
 * fraction (it throws RangeError outside 0–1). The caller scales to
 * the 0–1 fraction the mapper and record require.
 */
export function tagAbvPercent(tags: readonly string[]): number | null {
  for (const tag of tags) {
    const match = TAG_ABV_PATTERN.exec(tag);
    if (match === null) continue;
    const abv = Number(match[1]) + Number(match[2]) / 10;
    if (Number.isFinite(abv) && abv > 0 && abv <= 100) return abv;
  }
  return null;
}

/**
 * Millilitres from a whole-tag volume token (`75cl` → 750, `0,75 l` →
 * 750); null when no tag is a volume. The second link of the fallback
 * chain — title first, this second, honest 0 ml last.
 */
export function tagVolumeMl(tags: readonly string[]): number | null {
  for (const tag of tags) {
    const match = TAG_VOLUME_PATTERN.exec(tag);
    if (match === null) continue;
    const value = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) continue;
    const ml = value * unitFactorMl(match[2]);
    if (Number.isFinite(ml) && ml > 0) return ml;
  }
  return null;
}

/** "25.90" → 2590 integer cents; any other shape is drift → null. */
function readPriceCents(price: string | null): number | null {
  if (price === null || !PRICE_PATTERN.test(price)) return null;
  return Math.round(Number.parseFloat(price) * 100);
}

// ---------------------------------------------------------------------------
// Per-row parse
// ---------------------------------------------------------------------------

/**
 * Parse a single Shopify products.json product row.
 *
 * Structural failures (no title, no variant to price, unusable price,
 * unmappable product_type) drop the row with a per-row error — the
 * correction-queue surface shared with the alks parser. A
 * non-matching SKU, an unparseable ABV (null) and an unparsed volume
 * (0 ml) keep the record by design (D2/D3) — the keyed-uncertainty
 * ESTIMATED path; weight never errors (D7).
 */
export function parseBottleofItalyProduct(row: unknown): BottleofItalyProductParseResult {
  const errors: string[] = [];

  if (typeof row !== 'object' || row === null) {
    return { record: null, errors: ['bottleofitaly product row is not a JSON object'] };
  }
  const product = readProductRow(row);

  const id = String(product.id ?? '(unknown)');
  const label = `bottleofitaly product ${id}`;

  const title = readNonEmptyString(product.title);
  if (title === null) {
    return {
      record: null,
      errors: [`Failed to map ${label}: missing or empty product title`],
    };
  }

  // One record per product row, first variant (the Shopify default
  // order) — price, SKU, weight and availability all read from it.
  const variant = product.variants[0] ?? null;
  if (variant === null) {
    return {
      record: null,
      errors: [`Failed to map ${label}: product has no variants — nothing to price`],
    };
  }

  const priceCents = readPriceCents(variant.price);
  if (priceCents === null) {
    return {
      record: null,
      errors: [
        `Failed to map ${label}: missing or invalid decimal price "${String(variant.price)}"`,
      ],
    };
  }

  // D2: a non-matching SKU is never guessed around — the record is
  // kept without an EAN and the correction error names the SKU. The
  // `barcode` field is unread (0 across the live catalog; EAN
  // provenance is the accepted SKU forms only).
  const ean = readEanFromSku(variant.sku);
  if (variant.sku !== null && ean === null) {
    errors.push(
      `Failed to map ${label}: SKU "${variant.sku}" does not match any accepted ` +
        'EAN SKU form (^[a-z]{2}-\\d{13}$, ^\\d{13}$, ^0\\d{13}$) — ' +
        'record kept without an EAN, flagged for the correction queue',
    );
  }

  // D3: product_type is BOI's only category input (92.8 % coverage);
  // it resolves through the ABV-guarded mapper exactly as the alks
  // sources do — the tag-parsed fraction keys the EU intermediate-
  // products boundary and the non-alcoholic ingestion guard. An
  // unparseable ABV passes null — the guard is not silently skipped.
  // tagAbvPercent is bounded 0–100, so the fraction is always 0–1:
  // the scale the mapper requires.
  const abvPercent = tagAbvPercent(product.tags);
  const mapperAbv = abvPercent !== null ? abvPercent / 100 : null;

  const mapping = product.productType === null
    ? null
    : mapSourceCategory(product.productType, mapperAbv);
  if (mapping === null) {
    return {
      record: null,
      errors: [
        ...errors,
        product.productType === null
          ? `Failed to map ${label}: product_type is missing — no canonical beverage category, ` +
            'flagged for the correction queue'
          : `Failed to map ${label}: product_type "${product.productType}" maps to no canonical ` +
            'beverage category (merch and non-beverage product types stay unmapped by design) — ' +
            'flagged for the correction queue',
      ],
    };
  }

  // Non-alcoholic ingestion guard (change nonalcoholic-catalog-hygiene,
  // design D3): the mapper re-keyed a typed alcohol outcome to
  // non-alcoholic because the ABV is unparseable — the row STILL
  // ingests (the ESTIMATED-status contract for unparseable fields is
  // untouched) but carries the correction error and the machine-
  // readable review hold the persistence layer stamps onto
  // review_hold_reason.
  const held = mapping.nonAlcoholicHold === true;
  if (held) {
    errors.push(
      `Held for review ${label}: ABV is unparseable (no positive gradazione tag) but the ` +
        'product_type resolves to an alcohol category — non-alcoholic rows are barred from ' +
        'alcohol categories, ingested as non-alcoholic with hold reason ' +
        `${NONALCOHOLIC_HOLD_REASON}, flagged for the correction queue`,
    );
  }

  // Volume fallback chain (design D2, sweep-decided): title token →
  // whole-tag volume token → honest 0 ml. Variant title and description
  // are measured dead ends (notes §1.1) and are not consulted. The
  // title parse rides the alks convention, multipack-aware: a
  // `pack × unit` token resolves to the per-unit volume plus
  // `packCount`.
  const titleVolume = parseVolume(title);
  const volumeMl = titleVolume?.volumeMl ?? tagVolumeMl(product.tags) ?? 0;
  const packCount = titleVolume?.packCount ?? null;

  const vendor = product.vendor ?? '';

  const handle = readNonEmptyString(product.handle);

  const record: BottleofItalyParsedRecord = {
    productId: variant.sku ?? id,
    productName: title,
    manufacturer: vendor,
    brand: vendor,
    category: mapping.taxCategory,
    alcoholByVolume: mapperAbv,
    volumeMl,
    packCount,
    // product_master vocabulary (the schema CHECK's value set). No
    // container tokens are swept for Italian titles — 'other', never
    // 'unknown' (outside the CHECK); same default as the alks parser.
    containerType: 'other',
    regulatoryClassification: mapping.taxCategory,
    // Cross-border container: Finnish pantti membership is unknown at
    // the feed level, never assumed true for a foreign merchant.
    depositSystem: false,
    ean,
    priceCents,
    currency: 'EUR',
    // EUR-native: canonical and original amounts are the same cents;
    // no fxDatasetVersion — absence marks the no-conversion path.
    // `compare_at_price` is unread (design D2).
    originalPriceCents: priceCents,
    originalCurrency: 'EUR',
    availability: readAvailability(variant.available),
    sourceUrl: handle !== null ? `${STOREFRONT_BASE_URL}/products/${handle}` : null,
    weightGrams: readWeightGrams(variant.grams),
    reviewHoldReason: held ? NONALCOHOLIC_HOLD_REASON : null,
  };

  return { record, errors };
}

// ---------------------------------------------------------------------------
// Rows parse
// ---------------------------------------------------------------------------

/**
 * Parse the collected products.json rows into canonical records plus
 * per-row correction errors — the walk's `parseProducts` hook body.
 * Valid rows are never dropped for parse failures (design D2); rows
 * are skipped only for structural invalidity or an unmappable
 * product_type, always with an error naming them.
 */
export function parseBottleofItalyProducts(rows: readonly unknown[]): {
  records: BottleofItalyParsedRecord[];
  errors: string[];
} {
  const records: BottleofItalyParsedRecord[] = [];
  const errors: string[] = [];

  if (!Array.isArray(rows)) {
    return {
      records,
      errors: ['bottleofitaly payload is not a JSON array of products.json products'],
    };
  }

  for (const row of rows) {
    const { record, errors: rowErrors } = parseBottleofItalyProduct(row);
    errors.push(...rowErrors);
    if (record !== null) records.push(record);
  }

  return { records, errors };
}
