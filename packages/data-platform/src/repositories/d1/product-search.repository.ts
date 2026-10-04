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
 * `searchRanked` derives from scripts/spikes/cloudflare/search-parity/
 * src/query.ts: FTS5 MATCH with prefix expansion on the final token,
 * bm25 column weights 10/5/2 (name > brand > manufacturer), id ASC
 * tie-break, then a `LIKE '%q%'` merge that backfills mid-token substrings
 * a token-prefix match cannot express. Both orders are total, so repeated
 * calls return identical rows in identical order — the pagination
 * interplay (controller fetches up to MAX_PAGE_SIZE, then slices)
 * requires exactly that.
 *
 * Two Finnish-first refinements diverge from the spike (task 3.1, change
 * finnish-first-client-experience). Query tokens expand through the
 * curated {@link FINNISH_SYNONYM_GROUPS} into per-token OR-groups —
 * monotone by construction, since the un-expanded phrase always remains
 * a disjunct. And the LIKE merge is gated on scarcity: skipped when the
 * FTS token-match candidate count already reaches
 * {@link SEARCH_PAGE_SIZE} (a common word's head stays clean of
 * brand-substring noise — the live `olut` → Absolut incident), consulted
 * as before when matches are scarce (`arhu` → Karhu fragment recall).
 *
 * A zero-result query additionally carries a did-you-mean candidate
 * (task 3.2, change finnish-first-client-experience): bounded edit
 * distance (≤ 2) between diacritic-folded comparison keys of the query's
 * most significant token and the distinct brand vocabulary — advisory
 * only, exposed as the additive optional `suggestion` field; the
 * customer's query text is never rewritten (see
 * {@link D1ProductSearchRepository.searchRankedWithSuggestion}).
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
/**
 * `findOffers` row — the base offer plus the merchant registry's carrier
 * assignment (design D1, change transport-confidence-unlock). The column
 * is selected in every row of this query, so the field is required here:
 * an unassigned merchant reads as null, never as an absent key.
 */
type RetailOfferWithCarrierRecord = RetailOfferRecord & {
  readonly carrierId: string | null;
};

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
  /**
   * merchant_registry.carrier_id (design D1, change
   * transport-confidence-unlock) — present only in the `findOffers`
   * projection, which LEFT JOINs the registry; null when the merchant has
   * no assignment.
   */
  readonly carrier_id?: string | null;
}

/** Raw D1 catalog key row — the narrow (id, name) selection of the keys-then-page read. */
interface D1CatalogKeyRow {
  readonly id: number;
  readonly name: string;
}

/** Raw D1 per-product offer aggregate row (design D4 + honest-trust D1). */
interface D1OfferAggregateRow {
  readonly product_id: number;
  readonly min_price_cents: number;
  readonly merchant_count: number;
  /**
   * Reliability status of the cheapest current offer — the specific row
   * whose price `min_price_cents` reports. NOT NULL like the column.
   */
  readonly cheapest_reliability_status: string;
}

/**
 * Raw D1 ranking-candidate row (task 1.1, change
 * unitprice-ranking-scale-fix) — the flat JOIN projection: product fields
 * inline with the one current offer per (product, merchant).
 */
interface D1OfferCandidateRow {
  readonly product_id: number;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  readonly alcohol_by_volume: number | null;
  readonly unit_volume: number;
  readonly offer_id: number;
  readonly price_cents: number;
  readonly reliability_status: string;
}

// ---------------------------------------------------------------------------
// Spike-ported query helpers (search-parity reference implementation)
// ---------------------------------------------------------------------------

/** bm25 column weights: name weighted highest, then brand, then
 *  manufacturer — mirrors the pg GREATEST(per-field similarity) keeping a
 *  strong brand match on a weak name competitive but a name match ahead. */
const BM25_COLUMN_WEIGHTS = 'bm25(`product_master_fts`, 10.0, 5.0, 2.0)';

/**
 * The listing page size (SearchController's per-page slice) — the
 * LIKE-merge scarcity-gate threshold (task 3.1, change
 * finnish-first-client-experience): when the FTS token-match candidate
 * count reaches it, the page is already full of token matches and the
 * mid-token substring merge can only crowd the head with brand-substring
 * noise (the live `olut` → Absolut incident); below it, the merge runs
 * unchanged and keeps fragment recall (`arhu` → Karhu).
 */
export const SEARCH_PAGE_SIZE = 20;

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
 * Curated Finnish↔English synonym groups (task 3.1, change
 * finnish-first-client-experience) — category/term-level equivalence sets
 * the query builder expands into OR-groups inside the FTS5 MATCH
 * expression. Intentionally closed and category-flavored (design D5):
 * brand-level misspellings are did-you-mean territory, not synonyms.
 * Members are lowercase (query tokens are lowercased by {@link tokenize},
 * ä/ö/å preserved) and each term belongs to exactly one group, keeping
 * the lookup unambiguous. A member may be a multi-word phrase
 * ('red wine'), quoted as a single FTS5 phrase during expansion.
 */
export const FINNISH_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['viski', 'whisky'],
  ['olut', 'beer', 'oluet'],
  ['viini', 'wine'],
  ['punaviini', 'red wine'],
  ['valkoviini', 'white wine'],
  ['kuohuviini', 'sparkling wine'],
  ['siideri', 'cider'],
  ['likööri', 'liqueur'],
  ['konjakki', 'cognac', 'brandy'],
  ['shampanja', 'champagne'],
  ['vodka', 'viina'],
];

/**
 * Upper bound of OR-arms in one MATCH expression — the group-product of a
 * many-token query is capped so a pathological query cannot blow the
 * expression up (design D5: "keep the expression bounded"). Combinations
 * enumerate with every original token first, so the all-original phrase
 * is always the FIRST arm: even a truncated expression retains the
 * un-expanded query's disjunct, keeping expansion monotone (it can never
 * narrow a result set).
 */
export const MAX_MATCH_PHRASES = 32;

/**
 * The synonym group of one query token — the token itself first, then the
 * rest of its curated group; a singleton when the token is in no group
 * (group-less tokens therefore build exactly the legacy expression).
 */
function synonymGroupFor(token: string): readonly string[] {
  for (const group of FINNISH_SYNONYM_GROUPS) {
    if (group.includes(token)) {
      return [token, ...group.filter((member) => member !== token)];
    }
  }
  return [token];
}

/** Quote one FTS5 term/phrase, doubling embedded quotes. */
function ftsQuote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * Build the FTS5 MATCH expression (task 3.1, change
 * finnish-first-client-experience):
 *
 * - each token expands to the OR-group of its synonym group, e.g.
 *   `viski` → `"viski" * OR "whisky" *`;
 * - the prefix expansion on the final token — the analogue of the pg
 *   ILIKE '%q%' recall filter — applies to EVERY member of the final
 *   token's group;
 * - multi-token queries keep adjacency across groups: FTS5 has no
 *   phrase-across-OR-groups construct, so the expression enumerates the
 *   group-product of phrase combinations (`"karhu olut" * OR
 *   "karhu beer" * OR "karhu oluet" *`), bounded by
 *   {@link MAX_MATCH_PHRASES};
 * - tokens in no group yield exactly the legacy phrase-plus-prefix form
 *   (`"karhu" *`, `"le coq" *`) — group-less queries behave as before.
 *
 * Monotone by construction: every original token is the first member of
 * its position group, so the all-original phrase is the first OR arm and
 * expansion is a pure disjunction-widening of the legacy expression.
 */
export function buildMatchExpression(tokens: string[]): string {
  if (tokens.length === 0) return '';
  const positionGroups = tokens.map(synonymGroupFor);
  const phrases: string[] = [];
  const enumerate = (position: number, prefix: readonly string[]): void => {
    if (phrases.length >= MAX_MATCH_PHRASES) return;
    if (position === positionGroups.length) {
      phrases.push(ftsQuote(prefix.join(' ')));
      return;
    }
    for (const member of positionGroups[position]) {
      enumerate(position + 1, [...prefix, member]);
      if (phrases.length >= MAX_MATCH_PHRASES) return;
    }
  };
  enumerate(0, []);
  return phrases.map((phrase) => `${phrase} *`).join(' OR ');
}

/** SQL LIKE pattern with escaping of the LIKE wildcards inside user input. */
function likePattern(query: string): string {
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

// ---------------------------------------------------------------------------
// Zero-result did-you-mean primitives (task 3.2, change
// finnish-first-client-experience)
// ---------------------------------------------------------------------------

/**
 * Upper bound of the did-you-mean edit distance (spec product-search:
 * "bounded edit distance (≤ 2)"). Deliberately small: the suggestion is
 * advisory, and a loose bound would guess rather than correct.
 */
export const SUGGESTION_MAX_EDIT_DISTANCE = 2;

/**
 * The did-you-mean comparison key of one token: lowercased with the
 * Finnish diacritics folded away (ä→a, ö→o, å→a). Keys exist for
 * comparison only — a returned suggestion is always an original-cased
 * vocabulary value, never this folded form. Folding both sides is what
 * lets `likoori` reach `likööri` and a diacritic-less keyboard reach
 * `Skål Brännvin` (design Q5).
 */
export function foldComparisonKey(token: string): string {
  return token.toLowerCase().replace(/[äöå]/g, (c) =>
    c === 'ä' ? 'a' : c === 'ö' ? 'o' : 'a',
  );
}

/**
 * Classic Levenshtein distance (insert/delete/substitute — no
 * transposition shortcut, so `koskenkrova` → `koskenkorva` costs 2),
 * computed only while the distance can still stay within `bound`: the
 * two-row DP bails out with `bound + 1` as soon as a row's minimum
 * exceeds it, and the length-difference guard rejects early. The result
 * therefore saturates at `bound + 1` — callers must compare against
 * `bound`, not against an exact figure beyond it.
 */
export function boundedEditDistance(a: string, b: string, bound: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > bound) return bound + 1;
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      const d = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
      current.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > bound) return bound + 1;
    previous = current;
  }
  return previous[b.length];
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

/**
 * {@link toContractOffer} plus the registry join's carrier assignment —
 * always present on this projection: an unassigned merchant maps to a
 * null field, never an absent key (design D1).
 */
function toContractOfferWithCarrier(
  row: D1RetailOfferRow,
): RetailOfferWithCarrierRecord {
  return {
    ...toContractOffer(row),
    carrierId: row.carrier_id ?? null,
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

/**
 * FTS candidates narrowed by a category filter (task 2.1, change
 * client-experience-improvement) — the combined q+category path. The
 * category predicate lives INSIDE the candidate query, before LIMIT, so
 * the ranked fetch can never evict an in-category match in favor of an
 * out-of-category one; the limit applies to the combined result set.
 */
const FTS_SEARCH_IN_CATEGORY_SQL = `
  SELECT p.id, p.name, p.manufacturer, p.brand, p.category,
         p.alcohol_by_volume, p.unit_volume, p.container_type,
         p.regulatory_classification, p.deposit_system_status, p.ean,
         p.weight_grams, p.created_at, p.updated_at
    FROM product_master_fts f
    JOIN product_master p ON p.id = f.rowid
   WHERE product_master_fts MATCH ? AND p.category = ?
   ORDER BY ${BM25_COLUMN_WEIGHTS} ASC, p.id ASC
   LIMIT ?`;

/**
 * Cheap unbounded candidate count for the LIKE-merge scarcity gate
 * (task 3.1, change finnish-first-client-experience) — the same MATCH
 * expression the ranked fetch runs, counted without the LIMIT so the
 * gate reads the true candidate count, not the fetched window.
 */
const FTS_COUNT_SQL = `
  SELECT count(*) AS n
    FROM product_master_fts
   WHERE product_master_fts MATCH ?`;

/** Category-narrowed candidate count (the combined q+category path). */
const FTS_COUNT_IN_CATEGORY_SQL = `
  SELECT count(*) AS n
    FROM product_master_fts f
    JOIN product_master p ON p.id = f.rowid
   WHERE product_master_fts MATCH ? AND p.category = ?`;

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

/**
 * LIKE candidates narrowed by a category filter (task 2.1) — the
 * combined q+category recall path; the OR group is parenthesized so the
 * category predicate conjoins the whole group, not the last arm.
 */
const RANKED_LIKE_IN_CATEGORY_SQL = `
  SELECT ${PRODUCT_COLUMNS}
    FROM product_master
   WHERE (name LIKE ? ESCAPE '\\'
       OR brand LIKE ? ESCAPE '\\'
       OR manufacturer LIKE ? ESCAPE '\\')
     AND category = ?
   ORDER BY id ASC
   LIMIT ?`;

/** searchByName recall — name only, matching the pg ILIKE(name) contract. */
const NAME_LIKE_SQL = `
  SELECT ${PRODUCT_COLUMNS}
    FROM product_master
   WHERE name LIKE ? ESCAPE '\\'
   ORDER BY id ASC`;

/**
 * The did-you-mean brand vocabulary (task 3.2, change
 * finnish-first-client-experience): every distinct non-blank brand value.
 * The brand column is small (design D3's ~10⁴-row catalog), so the
 * per-request DISTINCT read stays bounded — no cache infrastructure
 * (design Q5). Comparison keys and selection happen app-side in
 * {@link D1ProductSearchRepository.suggestBrand}.
 */
const BRAND_VOCABULARY_SQL = `
  SELECT DISTINCT brand FROM product_master WHERE brand <> ''`;

/**
 * Catalog key read (design D1) — deliberately narrow: only the columns
 * the app-side FI sort needs. Category filtering (exact equality) is
 * appended by {@link D1ProductSearchRepository.listCatalogPage}.
 */
const CATALOG_KEYS_SQL = `
  SELECT id, name
    FROM product_master`;

/**
 * Price-ordered catalog keys (task 1.2): ascending by the product's
 * lowest observed offer price — the same latest-observation MIN the page
 * renders (design D4), so the sort key IS the displayed price.
 * LEFT JOIN keeps offer-less products in the listing; the `(… IS NULL)`
 * term sends them last, and the id ASC tie makes the order total and
 * deterministic (spec product-search: "Price sort orders by observed
 * lowest price").
 *
 * The offer set is the latest observation per (product, merchant) —
 * retail_offers is append-per-scrape, so without this filter a
 * SUPERSEDED cheaper scrape drags the minimum below what the detail page
 * and the search route list (2026-10-01: pre-price-floor zero-price rows
 * crowned the LOWEST_PRICE catalog even after the source recovered).
 */
const LATEST_OFFER_PER_MERCHANT_SQL = `
  (SELECT product_id, merchant, MAX(id) AS id
     FROM retail_offers
 GROUP BY product_id, merchant)`;

/**
 * Correlated provenance of the CHEAPEST CURRENT offer (design D1, change
 * honest-trust-surfaces): the reliability status of the one latest-
 * observation row whose `price_cents` equals the aggregate's
 * `MIN(o.price_cents)`. The listing embed derives its €/g metric from
 * THAT offer — the minimum over current offers is one specific offer,
 * and its price provenance must travel with the price.
 *
 * The pick is deterministic and detail-parity: rows are ordered
 * `price_cents ASC, id ASC`, which is exactly the row the detail
 * endpoint's own derivation lands on (`findOffers` returns the
 * latest-observation rows in `id ASC` order and the shared
 * lowest-current-offer rule keeps the FIRST strictly-smaller price —
 * the minimum-price row with the lowest id). A superseded cheaper
 * scrape can never leak its price or its status: the inner latest-per-
 * (product, merchant) collapse is the same one
 * {@link LATEST_OFFER_PER_MERCHANT_SQL} applies to the outer aggregate.
 *
 * Written as a correlated scalar subquery so the grouped aggregate keeps
 * its shape (one statement, one round trip — no per-row N+1); SQLite
 * resolves the outer `o.product_id` grouping column at each group.
 * Exported because the search route's ids/ranked-q aggregate
 * (offerAggregatesByProductId) must resolve the identical provenance —
 * one SQL fragment, two aggregate sites, zero drift.
 */
export const CHEAPEST_CURRENT_OFFER_PROVENANCE_SQL = `
  (SELECT o2.reliability_status
     FROM retail_offers o2
     JOIN (SELECT product_id, merchant, MAX(id) AS id
             FROM retail_offers
            WHERE product_id = o.product_id
         GROUP BY product_id, merchant) latest
       ON latest.id = o2.id
    WHERE o2.product_id = o.product_id
    ORDER BY o2.price_cents ASC, o2.id ASC
    LIMIT 1)`;

const CATALOG_KEYS_BY_PRICE_SQL = `
  SELECT p.id AS id, p.name AS name
    FROM product_master p
    LEFT JOIN (SELECT o.product_id AS product_id,
                      MIN(o.price_cents) AS min_price_cents
                 FROM retail_offers o
                 JOIN ${LATEST_OFFER_PER_MERCHANT_SQL} m
                   ON m.id = o.id
             GROUP BY o.product_id) a
      ON a.product_id = p.id`;

/**
 * Defensive cap on ranking candidate rows (task 1.1, change
 * unitprice-ranking-scale-fix, design D3) — NOT a pagination contract.
 * Candidates are latest-per-merchant offers (~1.04 per product today, the
 * largest category ~3.5k rows), so the cap sits far above observed need.
 * If it ever binds, ranking COMPLETENESS (which products appear) degrades
 * — never correctness: the pure ranking policy still orders whatever it
 * receives.
 */
export const CATEGORY_OFFER_CANDIDATES_LIMIT = 20_000;

/**
 * One category's ranking candidates in a single statement (task 1.1,
 * change unitprice-ranking-scale-fix, design D2): the category's products
 * joined to their CURRENT offers — the latest observation per (product,
 * merchant), the exact MAX(id)-per-group recency rule `findOffers`
 * documents (retail_offers is append-per-scrape), moved into this one
 * query. The dedup aggregate is scoped to the category's product ids, so
 * it seeks the category's slice of the (product_id, merchant, id) index
 * instead of scanning the whole scrape history.
 *
 * Products without offers produce no rows — the same omission the
 * per-product sweep produced. The projection is deliberately minimal:
 * exactly the fields the ranking route's pure mapping consumes (no
 * merchant, country, availability, or timestamps). The deterministic
 * ORDER BY makes the defensive cap's truncation stable across calls —
 * without it, which rows survive a binding LIMIT would be SQLite-
 * undefined. The category must be validated against PRODUCT_CATEGORIES
 * by the caller (the API route 400s unknown values); like
 * {@link D1ProductSearchRepository.listCatalogPage}, an unknown value
 * filters strictly and yields zero rows.
 */
const CATEGORY_OFFER_CANDIDATES_SQL = `
  SELECT p.id AS product_id, p.name, p.brand, p.category,
         p.alcohol_by_volume, p.unit_volume,
         o.id AS offer_id, o.price_cents, o.reliability_status
    FROM retail_offers o
    JOIN (SELECT product_id, merchant, MAX(id) AS id
            FROM retail_offers
           WHERE product_id IN (SELECT id FROM product_master
                                 WHERE category = ?)
        GROUP BY product_id, merchant) latest
      ON latest.id = o.id
    JOIN product_master p
      ON p.id = o.product_id
   ORDER BY p.id ASC, o.id ASC
   LIMIT ${CATEGORY_OFFER_CANDIDATES_LIMIT}`;

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
 * Catalog sort orders (task 1.2, change client-experience-improvement) —
 * the one shared value set for {@link D1ProductSearchRepository.listCatalogPage}
 * and the API route's `sort` validation. Every order keys on objective
 * product/offer fields only; no commercial or promotional signal can enter
 * an ordering (proposal decision D3).
 */
export const CATALOG_SORT_ORDERS = [
  'ALPHABETICAL',
  'LOWEST_PRICE',
  'ALCOHOL_PERCENTAGE',
] as const;

export type CatalogSortOrder = (typeof CATALOG_SORT_ORDERS)[number];

/**
 * One catalog listing item: the full contract product plus the offer
 * aggregates of its page (design D4, change product-catalog) and the
 * provenance of the cheapest current offer (design D1, change
 * honest-trust-surfaces).
 */
export interface CatalogProductListItem {
  /** Full product row in the canonical contract shape (see the module header). */
  readonly product: ProductRecord;
  /**
   * Lowest observed offer price in EUR cents — null when the product has
   * no offers. Honest absence, never a guessed price. This IS the price
   * of one specific offer: the cheapest row of the latest-observation
   * set (see {@link CHEAPEST_CURRENT_OFFER_PROVENANCE_SQL}), which is
   * what makes the listing €/g embed's derivation honest.
   */
  readonly lowestPriceCents: number | null;
  /** Distinct merchants with an observed offer — 0 when the product has no offers. */
  readonly merchantCount: number;
  /**
   * Reliability status of the cheapest current offer — the offer whose
   * price {@link CatalogProductListItem.lowestPriceCents} reports. Null
   * exactly when the product has no current offer; a superseded scrape
   * never supplies a price or a provenance.
   */
  readonly cheapestOfferReliabilityStatus: string | null;
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

/**
 * One ranking candidate (task 1.1, change unitprice-ranking-scale-fix) —
 * the flat row the unit-price route maps into `UnitPriceRankingEntry`s:
 * product identity and physical inputs with the one current offer's price
 * facts. Minimal projection by design — merchant, country, availability,
 * and timestamps are deliberately absent. A product offered by several
 * merchants yields one row per merchant; a product without offers yields
 * no row at all.
 */
export interface CategoryOfferCandidate {
  readonly productId: number;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  /** numeric(5,3) text — the pg contract rendering; null when unknown. */
  readonly alcoholByVolume: string | null;
  /** numeric(10,4) text — the pg contract rendering. */
  readonly unitVolume: string;
  /** The latest-observation offer row the price facts report. */
  readonly offerId: number;
  readonly priceCents: number;
  readonly reliabilityStatus: string;
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
   * synonym-expanded OR-groups and final-token prefix expansion first,
   * LIKE '%q%' merge second under the scarcity gate, deterministic
   * tie-break ordering. Mirrors `searchRanked(query, limit)` of the pg
   * repository; blank/whitespace queries fall through to the unfiltered
   * alphabetical listing (defensive total-order parity with the spike,
   * which never throws on whitespace).
   *
   * Finnish synonym expansion (task 3.1, change
   * finnish-first-client-experience) widens the MATCH expression
   * per-token through {@link FINNISH_SYNONYM_GROUPS} — monotone, since
   * the un-expanded phrase remains a disjunct (see
   * {@link buildMatchExpression}).
   *
   * The LIKE merge is consulted only when the FTS token-match candidate
   * count is below {@link SEARCH_PAGE_SIZE}; at or above it the merge is
   * skipped entirely, so a common word's result head contains token
   * matches only — brand names merely containing the letters (Abs(olut)
   * for `olut`) cannot crowd the page. Below the threshold the merge
   * runs exactly as before, preserving mid-token fragment recall
   * (`arhu` → Karhu). The gate changes no ranking semantics of the paths
   * it runs: FTS relevance order first, LIKE-only rows appended in id
   * order, capped at the caller's limit — the skipped branch is the only
   * difference.
   *
   * `category` (task 2.1, change client-experience-improvement) narrows
   * BOTH candidate paths (the gate's candidate count included) with an
   * exact-equality predicate, so the result contains only keyword
   * matches whose category equals the value — the category is never
   * silently ignored because a keyword is present (spec product-search).
   * The value must be validated against PRODUCT_CATEGORIES by the caller
   * (the API route 400s unknown values); like
   * {@link D1ProductSearchRepository.listCatalogPage}, an unvalidated
   * value filters strictly and yields zero rows. The limit applies to
   * the combined result set: the candidate queries carry the category
   * predicate before their LIMIT.
   */
  override async searchRanked(
    query: string,
    limit: number,
    category?: string,
  ): Promise<ProductRecord[]> {
    const trimmed = query.trim();
    const tokens = tokenize(trimmed);
    if (tokens.length === 0) {
      // Blank-query defensive path only — the route sends non-blank
      // queries here and blanks to listCatalogPage, which owns category
      // filtering for the browse shape.
      return this.listAlphabetical(limit);
    }

    const filtered = category !== undefined;

    // 1) FTS candidates (synonym-expanded MATCH — task 3.1).
    const matchExpression = buildMatchExpression(tokens);
    const ftsRows = (
      await this.d1
        .prepare(filtered ? FTS_SEARCH_IN_CATEGORY_SQL : FTS_SEARCH_SQL)
        .bind(
          matchExpression,
          ...(filtered ? [category] : []),
          limit,
        )
        .all<D1ProductRow>()
    ).results;

    // 2) LIKE candidates — the ILIKE recall analogue — gated on FTS
    //    scarcity: consulted only when the token-match candidate count
    //    (the same MATCH expression, unbounded count) is below the page
    //    size. At or above it the head is already full of token matches
    //    and the merge's brand-substring rows can only add noise; below
    //    it the merge backfills mid-token fragments exactly as before.
    const ftsCount =
      (
        await this.d1
          .prepare(filtered ? FTS_COUNT_IN_CATEGORY_SQL : FTS_COUNT_SQL)
          .bind(matchExpression, ...(filtered ? [category] : []))
          .first<{ n: number }>()
      )?.n ?? 0;
    const pattern = likePattern(trimmed);
    const likeRows =
      ftsCount >= SEARCH_PAGE_SIZE
        ? []
        : (
            await this.d1
              .prepare(
                filtered ? RANKED_LIKE_IN_CATEGORY_SQL : RANKED_LIKE_SQL,
              )
              .bind(
                pattern,
                pattern,
                pattern,
                ...(filtered ? [category] : []),
                limit,
              )
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

  /**
   * The zero-result did-you-mean candidate for `query` (task 3.2, change
   * finnish-first-client-experience), or null.
   *
   * Vocabulary: one comparison entry per distinct non-blank brand value
   * (the {@link BRAND_VOCABULARY_SQL} read — design Q5's brand-token
   * vocabulary). The comparison key JOINS the brand's {@link tokenize}
   * tokens, so word boundaries and punctuation inside a brand never have
   * to be typed back: `Jack Daniel's` stores the key `jackdaniels` and
   * stays reachable from `jackdanels`, while a single-token brand's key
   * IS its token (`Koskenkorva`). Keys fold through
   * {@link foldComparisonKey}; the returned VALUE is always the original
   * brand string, never the folded key.
   *
   * Target: the query's most significant token — the longest
   * {@link tokenize} token, first occurrence on ties (a total function of
   * the query string, so repeated calls agree). The brand-side join pairs
   * with it naturally: users who misspell a brand omit its separators
   * (`jackdanels`, `koskenkrova`) far more often than they split one
   * brand token in two.
   *
   * Selection: {@link boundedEditDistance} between the folded target and
   * each folded key, kept while ≤ {@link SUGGESTION_MAX_EDIT_DISTANCE};
   * the best candidate wins by (distance, then the alphabetical order of
   * the ORIGINAL value under the same Finnish collation the module
   * already orders by) — total and stable, so equal candidates across
   * repeated calls return the identical string. A distance-0 candidate is
   * kept deliberately: with folded keys it is the common Finnish-keyboard
   * case (`likoori` → Likööri), not a rewrite — the response's query
   * fields are never touched either way (advisory trust posture).
   */
  async suggestBrand(query: string): Promise<string | null> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return null;
    const target = tokens.reduce((longest, token) =>
      token.length > longest.length ? token : longest,
    );
    const targetKey = foldComparisonKey(target);
    const brands = (
      await this.d1.prepare(BRAND_VOCABULARY_SQL).all<{ brand: string }>()
    ).results;
    let best: {
      readonly value: string;
      readonly distance: number;
    } | null = null;
    for (const { brand } of brands) {
      const brandTokens = tokenize(brand);
      if (brandTokens.length === 0) continue; // punctuation-only value
      const distance = boundedEditDistance(
        targetKey,
        foldComparisonKey(brandTokens.join('')),
        SUGGESTION_MAX_EDIT_DISTANCE,
      );
      if (distance > SUGGESTION_MAX_EDIT_DISTANCE) continue;
      if (
        best === null ||
        distance < best.distance ||
        (distance === best.distance &&
          brand.localeCompare(best.value, 'fi') < 0)
      ) {
        best = { value: brand, distance };
      }
    }
    return best === null ? null : best.value;
  }

  /**
   * {@link D1ProductSearchRepository.searchRanked} plus the zero-result
   * did-you-mean (task 3.2): an EMPTY ranked result computes
   * {@link D1ProductSearchRepository.suggestBrand} for the same query;
   * any non-empty result set leaves `suggestion` null (spec
   * product-search: no suggestion when the query has results). The route
   * attaches the field only when non-null — the customer's original
   * query text stays the response's query, and the suggestion is never
   * applied implicitly.
   */
  async searchRankedWithSuggestion(
    query: string,
    limit: number,
    category?: string,
  ): Promise<{ items: ProductRecord[]; suggestion: string | null }> {
    const items = await this.searchRanked(query, limit, category);
    const suggestion =
      items.length === 0 ? await this.suggestBrand(query) : null;
    return { items, suggestion };
  }

  /** @inheritdoc */
  async findById(id: number): Promise<ProductRecord | null> {
    const row = await this.d1
      .prepare(`SELECT ${PRODUCT_COLUMNS} FROM product_master WHERE id = ?`)
      .bind(id)
      .first<D1ProductRow>();
    return row ? toContractProduct(row) : null;
  }

  /**
   * @inheritdoc
   *
   * The latest-observation offer set enriched with the merchant
   * registry's carrier assignment (design D1, change
   * transport-confidence-unlock): one LEFT JOIN on the offer's merchant
   * — no per-offer follow-up reads. The join is LEFT so an offer whose
   * merchant is missing from the registry survives with
   * `carrierId: null`, the honest unknown that degrades to the
   * merchant-name fallback downstream.
   */
  async findOffers(productId: number): Promise<RetailOfferWithCarrierRecord[]> {
    // retail_offers is append-per-scrape: upsertOffer inserts a new row per
    // run and rows are never updated, so the latest observation for a
    // (product, merchant) pair is the max id — the same recency the
    // upsertOffer change detection resolves via (observed_at, id)
    // descending, collapsed to the monotonic surrogate key.
    const rows = (
      await this.d1
        .prepare(
          `SELECT o.id, o.merchant, o.country, o.product_id, o.price_cents,
                  o.currency, o.availability, o.source_url, o.observed_at,
                  o.reliability_status, reg.carrier_id AS carrier_id
             FROM retail_offers o
             JOIN (SELECT merchant, MAX(id) AS id
                     FROM retail_offers
                    WHERE product_id = ?
                 GROUP BY merchant) m
               ON m.id = o.id
             LEFT JOIN merchant_registry reg ON reg.merchant_id = o.merchant
            ORDER BY o.id ASC`,
        )
        .bind(productId)
        .all<D1RetailOfferRow>()
    ).results;
    return rows.map(toContractOfferWithCarrier);
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
   * One category's ranking candidates (task 1.1, change
   * unitprice-ranking-scale-fix) — {@link CategoryOfferCandidate} rows
   * straight from {@link CATEGORY_OFFER_CANDIDATES_SQL}: the whole
   * candidate set in one round trip, the exact `findOffers` recency rule
   * inline. Replaces the ranking route's per-product `findOffers` sweep
   * (design D1: acquisition collapses to one repository call; the pure
   * ranking pipeline is untouched).
   *
   * Kept on the D1 concrete class only (no abstract counterpart): the
   * route binds the concrete type, the catalog-listing precedent.
   */
  async listCategoryOfferCandidates(
    category: string,
  ): Promise<CategoryOfferCandidate[]> {
    const rows = (
      await this.d1
        .prepare(CATEGORY_OFFER_CANDIDATES_SQL)
        .bind(category)
        .all<D1OfferCandidateRow>()
    ).results;
    return rows.map((row) => ({
      productId: row.product_id,
      name: row.name,
      brand: row.brand,
      category: row.category,
      alcoholByVolume: realToNumericText(
        row.alcohol_by_volume,
        ALCOHOL_BY_VOLUME_SCALE,
      ),
      unitVolume: realToNumericText(
        row.unit_volume,
        UNIT_VOLUME_SCALE,
      ) as string,
      offerId: row.offer_id,
      priceCents: row.price_cents,
      reliabilityStatus: row.reliability_status,
    }));
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
   *    deferral — the aggregate reflects observed offers, the SAME
   *    latest-observation set the detail endpoint lists). Each aggregate
   *    also resolves the cheapest current offer's reliability status
   *    (design D1, change honest-trust-surfaces) so the route can label
   *    the listing €/g embed with that offer's provenance.
   *
   * `category` must be validated against `PRODUCT_CATEGORIES` by the
   * caller (design D2: the API route 400s unknown values). Any
   * non-undefined value filters by exact equality — an unknown value
   * yields zero rows, never a silent fallback to the unfiltered listing.
   *
   * `sort` (task 1.2, change client-experience-improvement) orders the
   * keys before pagination, so every page slices the SAME total order:
   * ALPHABETICAL keeps the app-side FI collation; LOWEST_PRICE and
   * ALCOHOL_PERCENTAGE order in SQL (numeric keys, id tie — total order,
   * no collation needed) with offer-less / unknown-ABV products last.
   * The default is LOWEST_PRICE (task 1.3, change first-impression-pass):
   * the leading `(min_price_cents IS NULL) ASC` term makes the
   * offer-less-last placement explicit against SQLite's NULLs-first
   * ascending order — a bare `min_price ASC` would silently render
   * offer-less rows first — and the id tie keeps the order total, so
   * every page and every run slice the identical sequence. The value
   * set is {@link CATALOG_SORT_ORDERS}; the route validates it.
   *
   * Kept on the D1 concrete class only (no abstract counterpart yet):
   * the route binds the concrete type (the D1-only repository precedent).
   */
  async listCatalogPage(
    page: number,
    pageSize: number,
    category?: string,
    sort: CatalogSortOrder = 'LOWEST_PRICE',
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
    let keysSql: string;
    const keyParams: string[] = [];
    if (sort === 'LOWEST_PRICE') {
      keysSql = `${CATALOG_KEYS_BY_PRICE_SQL}${
        filtered ? ' WHERE p.category = ?' : ''
      }
   ORDER BY (a.min_price_cents IS NULL) ASC, a.min_price_cents ASC, p.id ASC`;
      if (filtered) keyParams.push(category);
    } else if (sort === 'ALCOHOL_PERCENTAGE') {
      keysSql = `SELECT id, name FROM product_master${
        filtered ? ' WHERE category = ?' : ''
      }
   ORDER BY (alcohol_by_volume IS NULL) ASC, alcohol_by_volume DESC, id ASC`;
      if (filtered) keyParams.push(category);
    } else {
      keysSql = `${CATALOG_KEYS_SQL}${filtered ? ' WHERE category = ?' : ''}`;
      if (filtered) keyParams.push(category);
    }
    const keys = (
      await this.d1
        .prepare(keysSql)
        .bind(...keyParams)
        .all<D1CatalogKeyRow>()
    ).results;

    // Exact total — the full filtered key list, before slicing (design D1).
    const total = keys.length;
    // The alphabetical contract sorts app-side (FI collation); the
    // SQL-ordered sorts are already total — re-sorting would destroy them.
    const orderedKeys =
      sort === 'ALPHABETICAL' ? sortAlphabetical(keys) : keys;
    const pageKeys = orderedKeys.slice(
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
          `SELECT o.product_id,
                  MIN(o.price_cents) AS min_price_cents,
                  COUNT(DISTINCT o.merchant) AS merchant_count,
                  ${CHEAPEST_CURRENT_OFFER_PROVENANCE_SQL} AS cheapest_reliability_status
             FROM retail_offers o
             JOIN ${LATEST_OFFER_PER_MERCHANT_SQL} m
               ON m.id = o.id
            WHERE o.product_id IN (${inList})
         GROUP BY o.product_id`,
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
        cheapestOfferReliabilityStatus: aggregate
          ? aggregate.cheapest_reliability_status
          : null,
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
