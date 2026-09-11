/**
 * alks.fi WooCommerce Store API product parser (task 1.1, change
 * alks-feed-and-import-vat; designs D1/D3/D4/D7).
 *
 * Pure function: no I/O, deterministic on its input. The adapter
 * (task 1.2) owns fetching and pagination and feeds Store API product
 * rows from `/wp-json/wc/store/v1/products` through here.
 *
 * Contract, pinned by the golden fixture
 * (adapters/__fixtures__/alks-store-products.fixture.ts):
 *
 * - EAN from the SKU: the raw SKU must match `^[a-z]{2}-\d{13}$`; the
 *   two-letter prefix is stripped and the remainder is the EAN. A
 *   non-matching SKU is never guessed around — the record is kept with
 *   a null EAN and a per-row correction error names the SKU (design D1).
 * - ABV and volume come from the product name by rule-based regex
 *   ("35%", "0,5 l" / "0.5 l" / "500 ml"); container type from name
 *   tokens (PET, pullo, tölkki) through `alksContainerType` into the
 *   product_master vocabulary.
 *   The beverage category comes from the row's categories through
 *   `mapSourceCategory`, with name tokens as the second source. When
 *   both sources yield a beverage type on different tax-rule keys, the
 *   row is a correction error — never a silent pick (design D3). A
 *   product whose name yields no ABV or volume still parses: the
 *   unparsed field is null (ABV) / 0 (volume), never dropped.
 * - Prices are WooCommerce minor-unit strings ("699"); the parser
 *   emits integer cents (699). EUR-only: the sampled catalog is EUR
 *   and a foreign-currency row is another contract, not a conversion
 *   opportunity (Posti precedent).
 * - The payload's plain-decimal kg weight ("0.53") maps to integer
 *   grams (530); absent or unusable → null, no error (design D7).
 * - Image fields are never read (design D4).
 *
 * @module AlksStoreParser
 */

import {
  mapSourceCategory,
} from '@rajahinta/core-domain';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

/**
 * A parsed Store API row: the canonical feed record plus the feed
 * weight. `RawFeedRecord` gains its optional `weightGrams` field in
 * task 1.2; this shape already requires the resolved value so the
 * adapter can return parser output unchanged.
 */
export interface AlksParsedRecord extends RawFeedRecord {
  readonly weightGrams: number | null;
}

/** Per-row parse outcome: the record and/or its correction errors. */
export interface AlksProductParseResult {
  readonly record: AlksParsedRecord | null;
  readonly errors: readonly string[];
}

// ---------------------------------------------------------------------------
// Payload shapes (only the fields the parser consumes)
// ---------------------------------------------------------------------------

interface StoreApiPrices {
  price?: unknown;
  currency_code?: unknown;
}

interface StoreApiTerm {
  name?: unknown;
}

interface AlksProductRow {
  id?: unknown;
  name?: unknown;
  sku?: unknown;
  permalink?: unknown;
  prices?: unknown;
  categories?: unknown;
  brands?: unknown;
  weight?: unknown;
  is_in_stock?: unknown;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Minor-unit price strings are integers ("699"); anything else is drift. */
function readMinorUnitCents(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

/** Plain-decimal kg string ("0.53") → integer grams (530); never an error. */
function readWeightGrams(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const kg = Number.parseFloat(trimmed);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return Math.round(kg * 1000);
}

function readAvailability(value: unknown): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (value === true) return 'in_stock';
  if (value === false) return 'out_of_stock';
  return 'unknown';
}

function readBrandName(brands: unknown): string {
  if (!Array.isArray(brands)) return '';
  for (const entry of brands) {
    if (typeof entry !== 'object' || entry === null) continue;
    const name = readNonEmptyString((entry as StoreApiTerm).name);
    if (name !== null) return name;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Name parsing — ABV, volume, container tokens
// ---------------------------------------------------------------------------

/** "35%", "4,8 %" — first percentage in the name wins. */
const ABV_PATTERN = /(\d+(?:[.,]\d+)?)\s*%/;

/** "0,5 l", "0.5 l", "500 ml", "50 cl" — unit must end the token. */
const VOLUME_PATTERN = /(\d+(?:[.,]\d+)?)\s*(ml|cl|l)(?![a-z])/;

const VOLUME_TO_ML: Record<string, number> = { ml: 1, cl: 10, l: 1000 };

/** Percentage ABV from the name, 0–100; null when absent or implausible. */
function parseAbvPercent(name: string): number | null {
  const match = ABV_PATTERN.exec(name.toLowerCase());
  if (match === null) return null;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

/** Millilitres from the name; null when no plausible volume token exists. */
function parseVolumeMl(name: string): number | null {
  const match = VOLUME_PATTERN.exec(name.toLowerCase());
  if (match === null) return null;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  const factor = VOLUME_TO_ML[match[2]];
  if (!Number.isFinite(value) || value <= 0 || factor === undefined) return null;
  return Math.round(value * factor);
}

/**
 * Packaging tokens the store uses in names, checked word-bounded in
 * priority order (muovi/pet before pullo so "muovipullo" stays
 * plastic). Tokens are resolved to the product_master vocabulary by
 * {@link alksContainerType}.
 */
const CONTAINER_TOKENS = [
  'pet',
  'muovi',
  'tölkki',
  'pullo',
  'lasi',
  'kartonki',
  'tynnyri',
  'plastic',
  'bottle',
  'can',
  'glass',
  'keg',
] as const;

/**
 * Beverage-type words that may appear in names, each resolved through
 * `mapSourceCategory` — the same mapping authority as the categories,
 * so both sources are comparable. Checked word-bounded in list order;
 * the first token with a canonical mapping wins.
 */
const NAME_BEVERAGE_TOKENS = [
  'beer',
  'olut',
  'lager',
  'pilsner',
  'cider',
  'siideri',
  'wine',
  'viini',
  'kuohuviini',
  'champagne',
  'prosecco',
  'sparkling wine',
  'liqueur',
  'likööri',
  'long drink',
  'lonkero',
  'sake',
  'vodka',
  'viina',
  'whisky',
  'whiskey',
  'gin',
  'rum',
  'brandy',
  'cognac',
  'tequila',
  'vermouth',
  'sherry',
] as const;

/** Word-bounded contains: "gift" must not match "gin", "classic" not "cl". */
function wordBoundedPattern(token: string): RegExp {
  return new RegExp(`(?<![a-z])${token}(?![a-z])`);
}

const CONTAINER_PATTERNS = CONTAINER_TOKENS.map((token) => ({
  token,
  pattern: wordBoundedPattern(token),
}));

const BEVERAGE_PATTERNS = NAME_BEVERAGE_TOKENS.map((token) => ({
  token,
  pattern: wordBoundedPattern(token),
}));

function findContainerToken(name: string): string | null {
  const lowered = name.toLowerCase();
  for (const { token, pattern } of CONTAINER_PATTERNS) {
    if (pattern.test(lowered)) return token;
  }
  return null;
}

/**
 * Token → product_master `container_type` value — the exact set the
 * schema CHECK pins (migration 0002: 'glass', 'plastic', 'metal',
 * 'carton', 'other', 'can', 'bottle'). This is deliberately NOT
 * core-domain's `standardizeContainerType`: its kebab-case canonicals
 * ('plastic-bottle', 'metal-can', …) violate the CHECK and bounce every
 * INSERT (staging incident 2026-09-11). Finnish tokens mirror the
 * standardize rules (pet/muovi → plastic, pullo/lasi → bottle, tölkki →
 * can, kartonki → carton, tynnyri/keg → metal).
 */
function alksContainerType(token: string): string {
  switch (token) {
    case 'pet':
    case 'muovi':
    case 'plastic':
      return 'plastic';
    case 'pullo':
    case 'lasi':
    case 'glass':
    case 'bottle':
      return 'bottle';
    case 'tölkki':
    case 'can':
      return 'can';
    case 'kartonki':
    case 'carton':
      return 'carton';
    case 'tynnyri':
    case 'keg':
      return 'metal';
    default:
      return 'other';
  }
}

// ---------------------------------------------------------------------------
// Category resolution — categories first, name tokens second
// ---------------------------------------------------------------------------

type SourceCategoryMapping = NonNullable<ReturnType<typeof mapSourceCategory>>;

/** First category term with a canonical mapping, in payload order. */
function categoryImpliedMapping(categories: unknown): SourceCategoryMapping | null {
  if (!Array.isArray(categories)) return null;
  for (const entry of categories) {
    if (typeof entry !== 'object' || entry === null) continue;
    const name = readNonEmptyString((entry as StoreApiTerm).name);
    if (name === null) continue;
    const mapping = mapSourceCategory(name);
    if (mapping !== null) return mapping;
  }
  return null;
}

/** First name token with a canonical beverage mapping, in token order. */
function nameImpliedMapping(name: string): SourceCategoryMapping | null {
  const lowered = name.toLowerCase();
  for (const { token, pattern } of BEVERAGE_PATTERNS) {
    if (!pattern.test(lowered)) continue;
    const mapping = mapSourceCategory(token);
    if (mapping !== null) return mapping;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-row parse
// ---------------------------------------------------------------------------

/** Raw SKU shape: two-letter country prefix + the 13-digit EAN. */
const SKU_PATTERN = /^[a-z]{2}-\d{13}$/;

/** 'de-4740077005916' → '4740077005916'; null for any non-matching SKU. */
function readEanFromSku(sku: string | null): string | null {
  if (sku === null || !SKU_PATTERN.test(sku)) return null;
  return sku.slice(3);
}

/**
 * Parse a single WooCommerce Store API product row.
 *
 * Structural failures (no name, non-EUR price, unusable price) and the
 * category contradiction drop the row with a per-row error — the
 * correction-queue surface shared with the Alko adapter. A non-matching
 * SKU and unparsable ABV/volume keep the record by design (D1/D3);
 * weight never errors (D7).
 */
export function parseAlksStoreProduct(row: unknown): AlksProductParseResult {
  const errors: string[] = [];

  if (typeof row !== 'object' || row === null) {
    return { record: null, errors: ['alks product row is not a JSON object'] };
  }
  const product = row as AlksProductRow;

  const id = typeof product.id === 'number' && Number.isFinite(product.id)
    ? String(product.id)
    : String(product.id ?? '(unknown)');
  const sku = readNonEmptyString(product.sku);
  const label = `alks product ${id}${sku !== null ? ` (SKU ${sku})` : ''}`;

  const name = readNonEmptyString(product.name);
  if (name === null) {
    return {
      record: null,
      errors: [`Failed to map ${label}: missing or empty product name`],
    };
  }

  const prices = typeof product.prices === 'object' && product.prices !== null
    ? (product.prices as StoreApiPrices)
    : null;
  const currency = readNonEmptyString(prices?.currency_code);
  if (currency === null || currency.toUpperCase() !== 'EUR') {
    return {
      record: null,
      errors: [
        `Failed to map ${label}: price currency "${String(prices?.currency_code)}" is not EUR — ` +
          'non-EUR rows require FX conversion at ingestion and are rejected here',
      ],
    };
  }

  const priceCents = readMinorUnitCents(prices?.price);
  if (priceCents === null) {
    return {
      record: null,
      errors: [
        `Failed to map ${label}: missing or invalid minor-unit price "${String(prices?.price)}"`,
      ],
    };
  }

  // D1: a non-matching SKU is never guessed around — the record is
  // kept without an EAN and the correction error names the SKU.
  const ean = readEanFromSku(sku);
  if (sku !== null && ean === null) {
    errors.push(
      `Failed to map ${label}: SKU "${sku}" does not match ^[a-z]{2}-\\d{13}$ — ` +
        'record kept without an EAN, flagged for the correction queue',
    );
  }

  // D3: categories are the beverage-type source; name tokens are the
  // second source. Both present must agree — on the tax-rule key the
  // record actually carries (liqueur and spirits share it; a canonical
  // difference with identical tax treatment is not a contradiction).
  const fromCategories = categoryImpliedMapping(product.categories);
  const fromName = nameImpliedMapping(name);

  let mapping: SourceCategoryMapping | null;
  if (fromCategories !== null && fromName !== null) {
    if (fromCategories.taxCategory !== fromName.taxCategory) {
      return {
        record: null,
        errors: [
          ...errors,
          `Failed to map ${label}: name implies ${fromName.taxCategory} but categories imply ` +
            `${fromCategories.taxCategory} — disagreeing sources are never silently resolved, ` +
            'flagged for the correction queue',
        ],
      };
    }
    mapping = fromCategories;
  } else {
    mapping = fromCategories ?? fromName;
  }

  if (mapping === null) {
    return {
      record: null,
      errors: [
        ...errors,
        `Failed to map ${label}: categories and name yield no canonical beverage category — ` +
          'flagged for the correction queue',
      ],
    };
  }

  const abvPercent = parseAbvPercent(name);
  const volumeMl = parseVolumeMl(name);
  const containerToken = findContainerToken(name);
  const brand = readBrandName(product.brands);

  const record: AlksParsedRecord = {
    productId: sku ?? id,
    productName: name,
    manufacturer: brand,
    brand,
    category: mapping.taxCategory,
    alcoholByVolume: abvPercent !== null ? abvPercent / 100 : null,
    volumeMl: volumeMl ?? 0,
    // product_master vocabulary (the schema CHECK's value set), NOT the
    // core-domain kebab-case canonicals — migration 0002 pins
    // ('glass','plastic','metal','carton','other','can','bottle'), and a
    // kebab-case value bounces every INSERT of the run
    // (product_master_container_type_check). No name token → 'other',
    // never 'unknown' (also outside the CHECK).
    containerType:
      containerToken !== null
        ? alksContainerType(containerToken)
        : 'other',
    regulatoryClassification: mapping.taxCategory,
    // Cross-border container: Finnish pantti membership is unknown at
    // the feed level, never assumed true for a foreign merchant.
    depositSystem: false,
    ean,
    priceCents,
    currency: 'EUR',
    // EUR-native: canonical and original amounts are the same cents;
    // no fxDatasetVersion — absence marks the no-conversion path.
    originalPriceCents: priceCents,
    originalCurrency: 'EUR',
    availability: readAvailability(product.is_in_stock),
    sourceUrl: readNonEmptyString(product.permalink),
    weightGrams: readWeightGrams(product.weight),
  };

  return { record, errors };
}

// ---------------------------------------------------------------------------
// Payload parse
// ---------------------------------------------------------------------------

/**
 * Parse a Store API collection page — a top-level JSON array of
 * products — into canonical records plus per-row correction errors.
 * Valid rows are never dropped for parse failures (design D3); rows
 * are skipped only for structural invalidity or a category
 * contradiction, always with an error naming them.
 */
export function parseAlksStoreProducts(payload: unknown): {
  records: AlksParsedRecord[];
  errors: string[];
} {
  const records: AlksParsedRecord[] = [];
  const errors: string[] = [];

  if (!Array.isArray(payload)) {
    return {
      records,
      errors: ['alks payload is not a JSON array of Store API products'],
    };
  }

  for (const row of payload) {
    const { record, errors: rowErrors } = parseAlksStoreProduct(row);
    errors.push(...rowErrors);
    if (record !== null) records.push(record);
  }

  return { records, errors };
}
