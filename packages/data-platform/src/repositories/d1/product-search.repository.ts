/**
 * D1 ProductSearchRepository — the Cloudflare-side implementation of the
 * abstract {@link ProductRepository} contract (task 2.2, change
 * migrate-to-cloudflare). Method signatures and result shapes match the
 * pg {@link DrizzleProductRepository} exactly; the deterministic
 * ordering and pagination interplay are preserved so the SearchController
 * filter → sort → paginate flow works unchanged on D1.
 *
 * ## Search translation (design D3, G2-spike-validated)
 *
 * The FTS5 external-content virtual table `product_master_fts` is created
 * by migration 0001_product_search_fts.sql and kept in sync by triggers —
 * it deliberately has no drizzle schema declaration, so this repository
 * executes raw SQL through the {@link D1DatabaseLike} executor instead of
 * drizzle builders.
 *
 * `searchRanked` ports scripts/spikes/cloudflare/search-parity/src/query.ts
 * verbatim: FTS5 MATCH phrase with prefix expansion on the final token,
 * bm25 column weights 10/5/2 (name > brand > manufacturer), id ASC
 * tie-break, then a `LIKE '%q%'` merge that backfills mid-token substrings
 * a token-prefix match cannot express. Both orders are total, so repeated
 * calls return identical rows in identical order — the pagination
 * interplay (controller fetches up to MAX_PAGE_SIZE, then slices)
 * requires exactly that.
 *
 * `searchByName` / blank-query listing: SQLite and D1 ship no Finnish
 * collation and D1 has no custom collations, so the final ordering stays
 * in application code — fetch, sort with `localeCompare(name, 'fi')`,
 * then apply the limit (spike `listAlphabetical`).
 *
 * ## Row-shape mapping
 *
 * The shared abstract contract is typed against the canonical pg schema
 * (`numeric` as string, `timestamp` as Date). The D1 driver returns raw
 * REAL numbers and ISO-8601 TEXT, so this repository performs the
 * boundary translation the pg driver did implicitly — REAL → fixed-scale
 * decimal text (alcohol_by_volume numeric(5,3), unit_volume
 * numeric(10,4)), TEXT → Date — keeping the contract identical across
 * both implementations (design D2 keeps money as INTEGER cents; only the
 * two REAL product columns and timestamps are translated here).
 *
 * @module D1ProductSearchRepository
 */
import { Injectable } from '@nestjs/common';
import { ProductRepository } from '../../abstracts';
import { productMaster, retailOffers } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

/** Contract row types (canonical pg shapes — see the module header). */
type ProductRecord = typeof productMaster.$inferSelect;
type ProductInsert = typeof productMaster.$inferInsert;
type RetailOfferRecord = typeof retailOffers.$inferSelect;

/** Column projection shared by every product_master SELECT. */
const PRODUCT_COLUMNS = `
  id, name, manufacturer, brand, category, alcohol_by_volume, unit_volume,
  container_type, regulatory_classification, deposit_system_status, ean,
  weight_grams, created_at, updated_at`;

/** Raw D1 product_master row (snake_case, REAL numbers, ISO-8601 TEXT). */
interface D1ProductRow {
  readonly id: number;
  readonly name: string;
  readonly manufacturer: string;
  readonly brand: string;
  readonly category: string;
  readonly alcohol_by_volume: number | null;
  readonly unit_volume: number;
  readonly container_type: string;
  readonly regulatory_classification: string;
  readonly deposit_system_status: number | null;
  readonly ean: string | null;
  readonly weight_grams: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Raw D1 retail_offers row. */
interface D1RetailOfferRow {
  readonly id: number;
  readonly merchant: string;
  readonly country: string;
  readonly product_id: number;
  readonly price_cents: number;
  readonly currency: string;
  readonly availability: string;
  readonly source_url: string | null;
  readonly observed_at: string;
  readonly reliability_status: string;
}

/** Raw D1 catalog key row — the narrow (id, name) selection of the keys-then-page read. */
interface D1CatalogKeyRow {
  readonly id: number;
  readonly name: string;
}

/** Raw D1 per-product offer aggregate row (design D4). */
interface D1OfferAggregateRow {
  readonly product_id: number;
  readonly min_price_cents: number;
  readonly merchant_count: number;
}

// ---------------------------------------------------------------------------
// Spike-ported query helpers (search-parity reference implementation)
// ---------------------------------------------------------------------------

/** bm25 column weights: name weighted highest, then brand, then
 *  manufacturer — mirrors the pg GREATEST(per-field similarity) keeping a
 *  strong brand match on a weak name competitive but a name match ahead. */
const BM25_COLUMN_WEIGHTS = 'bm25(`product_master_fts`, 10.0, 5.0, 2.0)';

/**
 * Extract unicode-letter tokens (Finnish/Swedish ä/ö/å included),
 * lowercased — the tokens FTS5's unicode61 tokenizer also produces.
 */
export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Build the FTS5 MATCH expression: the full query as a phrase with
 * prefix expansion on the final token ('"karhu" *' / '"le coq" *') —
 * the closest FTS5 analogue of the pg ILIKE '%q%' recall filter
 * (adjacent phrase; mid-token is impossible — that is what the LIKE
 * merge backfills).
 */
export function buildMatchExpression(tokens: string[]): string {
  const phrase = tokens
    .map((t) => t.replace(/"/g, '""'))
    .join('" "');
  return `"${phrase}" *`;
}

/** SQL LIKE pattern with escaping of the LIKE wildcards inside user input. */
function likePattern(query: string): string {
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

// ---------------------------------------------------------------------------
// Row mapping — D1 raw shapes → canonical pg contract shapes
// ---------------------------------------------------------------------------

/** pg column scales: alcohol_by_volume numeric(5,3), unit_volume numeric(10,4). */
const ALCOHOL_BY_VOLUME_SCALE = 3;
const UNIT_VOLUME_SCALE = 4;

/** REAL → the fixed-scale decimal text pg renders for its numeric columns. */
function realToNumericText(value: number | null, scale: number): string | null {
  return value === null ? null : value.toFixed(scale);
}

/** pg numeric text → REAL (SQLite stores NaN as NULL, so reject up front). */
function numericTextToReal(value: string | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Invalid decimal value: ${JSON.stringify(value)}`);
  }
  return parsed;
}

/** Tri-state INTEGER 0/1/null → boolean/null (the drizzle `mode: 'boolean'` mapping). */
function intToBoolean(value: number | null): boolean | null {
  return value === null ? null : value !== 0;
}

function booleanToInt(value: boolean | null | undefined): number | null {
  return value == null ? null : value ? 1 : 0;
}

function toContractProduct(row: D1ProductRow): ProductRecord {
  const unitVolume = realToNumericText(row.unit_volume, UNIT_VOLUME_SCALE);
  return {
    id: row.id,
    name: row.name,
    manufacturer: row.manufacturer,
    brand: row.brand,
    category: row.category,
    alcoholByVolume: realToNumericText(row.alcohol_by_volume, ALCOHOL_BY_VOLUME_SCALE),
    unitVolume: unitVolume as string,
    containerType: row.container_type,
    regulatoryClassification: row.regulatory_classification,
    depositSystemStatus: intToBoolean(row.deposit_system_status),
    ean: row.ean,
    weightGrams: row.weight_grams,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toContractOffer(row: D1RetailOfferRow): RetailOfferRecord {
  return {
    id: row.id,
    merchant: row.merchant,
    country: row.country,
    productId: row.product_id,
    priceCents: row.price_cents,
    currency: row.currency,
    availability: row.availability,
    sourceUrl: row.source_url,
    observedAt: new Date(row.observed_at),
    reliabilityStatus: row.reliability_status,
  };
}

/** Insert parameters in PRODUCT_INSERT_SQL column order (id omitted). */
function insertParams(record: ProductInsert): unknown[] {
  const unitVolume = numericTextToReal(record.unitVolume);
  if (unitVolume == null) {
    throw new TypeError('unitVolume is required');
  }
  return [
    record.name,
    record.manufacturer,
    record.brand,
    record.category,
    numericTextToReal(record.alcoholByVolume) ?? null,
    unitVolume,
    record.containerType,
    record.regulatoryClassification,
    booleanToInt(record.depositSystemStatus),
    record.ean ?? null,
    // Feed weight (design D7, change alks-feed-and-import-vat): absent
    // → null column, never an error.
    record.weightGrams ?? null,
    record.createdAt?.toISOString() ?? new Date().toISOString(),
    record.updatedAt?.toISOString() ?? new Date().toISOString(),
  ];
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/** FTS5 candidates — prefix-expanded phrase, bm25-ranked, id ASC tie. */
const FTS_SEARCH_SQL = `
  SELECT p.id, p.name, p.manufacturer, p.brand, p.category,
         p.alcohol_by_volume, p.unit_volume, p.container_type,
         p.regulatory_classification, p.deposit_system_status, p.ean,
         p.weight_grams, p.created_at, p.updated_at
    FROM product_master_fts f
    JOIN product_master p ON p.id = f.rowid
   WHERE product_master_fts MATCH ?
   ORDER BY ${BM25_COLUMN_WEIGHTS} ASC, p.id ASC
   LIMIT ?`;

/** LIKE candidates — the ILIKE recall analogue; catches mid-token
 *  substrings ('arhu') the token-prefix match cannot express. LIKE is
 *  case-insensitive for ASCII in SQLite; non-ASCII case folding is
 *  covered by the unicode61 FTS path above. */
const RANKED_LIKE_SQL = `
  SELECT ${PRODUCT_COLUMNS}
    FROM product_master
   WHERE name LIKE ? ESCAPE '\\'
      OR brand LIKE ? ESCAPE '\\'
      OR manufacturer LIKE ? ESCAPE '\\'
   ORDER BY id ASC
   LIMIT ?`;

/** searchByName recall — name only, matching the pg ILIKE(name) contract. */
const NAME_LIKE_SQL = `
  SELECT ${PRODUCT_COLUMNS}
    FROM product_master
   WHERE name LIKE ? ESCAPE '\\'
   ORDER BY id ASC`;

/**
 * Catalog key read (design D1) — deliberately narrow: only the columns
 * the app-side FI sort needs. Category filtering (exact equality) is
 * appended by {@link D1ProductSearchRepository.listCatalogPage}.
 */
const CATALOG_KEYS_SQL = `
  SELECT id, name
    FROM product_master`;

const INSERT_SQL = `
  INSERT INTO product_master (
    name, manufacturer, brand, category, alcohol_by_volume, unit_volume,
    container_type, regulatory_classification, deposit_system_status, ean,
    weight_grams, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING ${PRODUCT_COLUMNS}`;

const INSERT_WITH_ID_SQL = `
  INSERT INTO product_master (
    id, name, manufacturer, brand, category, alcohol_by_volume, unit_volume,
    container_type, regulatory_classification, deposit_system_status, ean,
    weight_grams, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING ${PRODUCT_COLUMNS}`;

/** Upsert-by-Ean update — preserves id and createdAt, exactly like pg. */
const UPDATE_BY_EAN_SQL = `
  UPDATE product_master SET
    name = ?, manufacturer = ?, brand = ?, category = ?, alcohol_by_volume = ?,
    unit_volume = ?, container_type = ?, regulatory_classification = ?,
    deposit_system_status = ?, weight_grams = ?, updated_at = ?
  WHERE ean = ?
  RETURNING ${PRODUCT_COLUMNS}`;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * One catalog listing item: the full contract product plus the offer
 * aggregates of its page (design D4, change product-catalog).
 */
export interface CatalogProductListItem {
  /** Full product row in the canonical contract shape (see the module header). */
  readonly product: ProductRecord;
  /**
   * Lowest observed offer price in EUR cents — null when the product has
   * no offers. Honest absence, never a guessed price.
   */
  readonly lowestPriceCents: number | null;
  /** Distinct merchants with an observed offer — 0 when the product has no offers. */
  readonly merchantCount: number;
}

/**
 * One page of the catalog listing — exact totals, Finnish-collation order
 * (design D1).
 */
export interface CatalogProductListPage {
  readonly items: readonly CatalogProductListItem[];
  /** Exact size of the filtered catalog — never a fetch-capped subset. */
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

@Injectable()
export class D1ProductSearchRepository extends ProductRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /**
   * Substring listing over product names, or the unfiltered alphabetical
   * listing when the query is null/blank — the pg contract. The LIKE
   * pre-filter narrows in SQL; Unicode case folding and the Finnish
   * collation are applied app-side (D1 has no custom collations).
   */
  async searchByName(
    query: string | null,
    limit: number,
  ): Promise<ProductRecord[]> {
    if (query === null || query.trim().length === 0) {
      return this.listAlphabetical(limit);
    }
    const trimmed = query.trim();
    const rows = (
      await this.d1
        .prepare(NAME_LIKE_SQL)
        .bind(likePattern(trimmed))
        .all<D1ProductRow>()
    ).results;
    // SQL LIKE folds ASCII case only — re-filter app-side so 'ÖLT'
    // matches 'Öltermanni' the way pg ILIKE (Unicode case-folding) does.
    const needle = trimmed.toLowerCase();
    const matched = rows.filter((row) =>
      row.name.toLowerCase().includes(needle),
    );
    return sortAlphabetical(matched)
      .slice(0, limit)
      .map(toContractProduct);
  }

  /**
   * Ranked search over name, brand, and manufacturer — FTS5 MATCH with
   * prefix expansion first, LIKE '%q%' fallback/merge second,
   * deterministic tie-break ordering. Mirrors `searchRanked(query, limit)`
   * of the pg repository; blank/whitespace queries fall through to the
   * unfiltered alphabetical listing (defensive total-order parity with
   * the spike, which never throws on whitespace).
   */
  override async searchRanked(
    query: string,
    limit: number,
  ): Promise<ProductRecord[]> {
    const trimmed = query.trim();
    const tokens = tokenize(trimmed);
    if (tokens.length === 0) {
      return this.listAlphabetical(limit);
    }

    // 1) FTS5 candidates.
    const ftsRows = (
      await this.d1
        .prepare(FTS_SEARCH_SQL)
        .bind(buildMatchExpression(tokens), limit)
        .all<D1ProductRow>()
    ).results;

    // 2) LIKE candidates.
    const pattern = likePattern(trimmed);
    const likeRows = (
      await this.d1
        .prepare(RANKED_LIKE_SQL)
        .bind(pattern, pattern, pattern, limit)
        .all<D1ProductRow>()
    ).results;

    // 3) Merge: FTS relevance order first, LIKE-only rows appended in id
    //    order — a total, deterministic order capped at the caller's limit.
    const seen = new Set<number>();
    const merged: D1ProductRow[] = [];
    for (const row of [...ftsRows, ...likeRows]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
      if (merged.length >= limit) break;
    }
    return merged.map(toContractProduct);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<ProductRecord | null> {
    const row = await this.d1
      .prepare(`SELECT ${PRODUCT_COLUMNS} FROM product_master WHERE id = ?`)
      .bind(id)
      .first<D1ProductRow>();
    return row ? toContractProduct(row) : null;
  }

  /** @inheritdoc */
  async findOffers(productId: number): Promise<RetailOfferRecord[]> {
    const rows = (
      await this.d1
        .prepare(
          `SELECT id, merchant, country, product_id, price_cents, currency,
                  availability, source_url, observed_at, reliability_status
             FROM retail_offers
            WHERE product_id = ?
            ORDER BY id ASC`,
        )
        .bind(productId)
        .all<D1RetailOfferRow>()
    ).results;
    return rows.map(toContractOffer);
  }

  /** @inheritdoc */
  async findRetailOfferById(id: number): Promise<RetailOfferRecord | null> {
    const row = await this.d1
      .prepare(
        `SELECT id, merchant, country, product_id, price_cents, currency,
                availability, source_url, observed_at, reliability_status
           FROM retail_offers WHERE id = ?`,
      )
      .bind(id)
      .first<D1RetailOfferRow>();
    return row ? toContractOffer(row) : null;
  }

  /**
   * Catalog listing page — category-filtered, exact-total,
   * Finnish-collation pagination (design D1 "keys-then-page", change
   * product-catalog). D1 ships no Finnish collation and no custom
   * collations, so:
   *
   * 1. SELECT only `(id, name)` — optionally category-filtered;
   * 2. sort app-side with the same `localeCompare(…, 'fi') || id`
   *    comparator as the existing contract ({@link sortAlphabetical});
   * 3. slice the page — `total` is the exact key-list length, uncapped by
   *    any fetch limit;
   * 4. fetch full rows for the page's ids only, re-ordered to the sorted
   *    key order;
   * 5. fill the per-page offer aggregates with one grouped query over the
   *    page's ids (design D4) — bounded by pageSize regardless of catalog
   *    size. Offer-less products keep `lowestPriceCents: null` and
   *    `merchantCount: 0`; no availability filtering in v1 (documented
   *    deferral — the aggregate reflects observed offers).
   *
   * `category` must be validated against `PRODUCT_CATEGORIES` by the
   * caller (design D2: the API route 400s unknown values). Any
   * non-undefined value filters by exact equality — an unknown value
   * yields zero rows, never a silent fallback to the unfiltered listing.
   *
   * Kept on the D1 concrete class only (no abstract counterpart yet):
   * the route binds the concrete type (the D1-only repository precedent).
   */
  async listCatalogPage(
    page: number,
    pageSize: number,
    category?: string,
  ): Promise<CatalogProductListPage> {
    // A negative/zero page would slice from the list's tail (negative
    // offset) — silently wrong content instead of an error.
    if (!Number.isInteger(page) || page < 1) {
      throw new TypeError(`page must be a positive integer, got ${page}`);
    }
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw new TypeError(
        `pageSize must be a positive integer, got ${pageSize}`,
      );
    }

    const filtered = category !== undefined;
    const keys = (
      await this.d1
        .prepare(
          filtered
            ? `${CATALOG_KEYS_SQL} WHERE category = ?`
            : CATALOG_KEYS_SQL,
        )
        .bind(...(filtered ? [category] : []))
        .all<D1CatalogKeyRow>()
    ).results;

    // Exact total — the full filtered key list, before slicing (design D1).
    const total = keys.length;
    const pageKeys = sortAlphabetical(keys).slice(
      (page - 1) * pageSize,
      page * pageSize,
    );
    if (pageKeys.length === 0) {
      return { items: [], total, page, pageSize };
    }

    const inList = Array.from({ length: pageKeys.length }, () => '?').join(
      ', ',
    );
    const pageIds = pageKeys.map((key) => key.id);

    const rows = (
      await this.d1
        .prepare(
          `SELECT ${PRODUCT_COLUMNS} FROM product_master WHERE id IN (${inList})`,
        )
        .bind(...pageIds)
        .all<D1ProductRow>()
    ).results;
    const productById = new Map(
      rows.map((row) => [row.id, toContractProduct(row)]),
    );

    const aggregates = (
      await this.d1
        .prepare(
          `SELECT product_id,
                  MIN(price_cents) AS min_price_cents,
                  COUNT(DISTINCT merchant) AS merchant_count
             FROM retail_offers
            WHERE product_id IN (${inList})
            GROUP BY product_id`,
        )
        .bind(...pageIds)
        .all<D1OfferAggregateRow>()
    ).results;
    const aggregateByProductId = new Map(
      aggregates.map((aggregate) => [aggregate.product_id, aggregate]),
    );

    // Re-order to the sorted key order — the IN reads carry no order.
    const items = pageKeys.map((key) => {
      const product = productById.get(key.id);
      if (!product) {
        // Keys are authoritative for identity: a row vanishing between
        // the key read and the row read is a data bug, not a skippable
        // page item.
        throw new Error(
          `product_master row ${key.id} vanished between key and row reads`,
        );
      }
      const aggregate = aggregateByProductId.get(key.id);
      return {
        product,
        lowestPriceCents: aggregate ? aggregate.min_price_cents : null,
        merchantCount: aggregate ? aggregate.merchant_count : 0,
      };
    });

    return { items, total, page, pageSize };
  }

  /** @inheritdoc */
  async create(record: ProductInsert): Promise<ProductRecord> {
    const row =
      record.id === undefined
        ? await this.d1
            .prepare(INSERT_SQL)
            .bind(...insertParams(record))
            .first<D1ProductRow>()
        : await this.d1
            .prepare(INSERT_WITH_ID_SQL)
            .bind(record.id, ...insertParams(record))
            .first<D1ProductRow>();
    if (!row) {
      throw new Error('product_master INSERT .. RETURNING returned no row');
    }
    return toContractProduct(row);
  }

  /** @inheritdoc */
  async upsertByEan(record: ProductInsert): Promise<ProductRecord> {
    if (!record.ean) {
      // No EAN — simple insert (cannot upsert without a key).
      return this.create(record);
    }

    // Check for existing record with the same EAN. The read-then-write
    // shape mirrors the pg repository one-to-one (ean carries no unique
    // constraint on either side), including its concurrency envelope.
    const existing = await this.d1
      .prepare('SELECT id FROM product_master WHERE ean = ?')
      .bind(record.ean)
      .first<{ id: number }>();

    if (existing) {
      const row = await this.d1
        .prepare(UPDATE_BY_EAN_SQL)
        .bind(
          record.name,
          record.manufacturer,
          record.brand,
          record.category,
          numericTextToReal(record.alcoholByVolume) ?? null,
          numericTextToReal(record.unitVolume),
          record.containerType,
          record.regulatoryClassification,
          booleanToInt(record.depositSystemStatus),
          // Feed weight refreshes with the other mutable fields; a
          // weight-less feed persists null (design D7).
          record.weightGrams ?? null,
          record.updatedAt?.toISOString() ?? new Date().toISOString(),
          record.ean,
        )
        .first<D1ProductRow>();
      if (!row) {
        throw new Error('product_master UPDATE .. RETURNING returned no row');
      }
      return toContractProduct(row);
    }

    return this.create(record);
  }

  /**
   * Unfiltered alphabetical listing — the repository `searchByName(null)`
   * path. Fetch + JS `localeCompare(…, 'fi')` mirrors the
   * SearchController compareByName contract; SQLite/D1 cannot provide the
   * Finnish collation server-side, so the ordering must stay in
   * application code. The product set is small (~10⁴ rows, design D3),
   * making the fetch-then-sort-then-limit shape safe.
   */
  private async listAlphabetical(limit: number): Promise<ProductRecord[]> {
    const rows = (
      await this.d1
        .prepare(`SELECT ${PRODUCT_COLUMNS} FROM product_master`)
        .all<D1ProductRow>()
    ).results;
    return sortAlphabetical(rows)
      .slice(0, limit)
      .map(toContractProduct);
  }
}

/**
 * Total, deterministic Finnish collation order: name, then id ASC. Shared
 * by the full-row listing and the catalog key list (design D1) — one
 * comparator, one contract.
 */
function sortAlphabetical<
  T extends { readonly id: number; readonly name: string },
>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => a.name.localeCompare(b.name, 'fi') || a.id - b.id,
  );
}
