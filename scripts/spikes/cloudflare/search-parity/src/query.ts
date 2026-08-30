/**
 * G2 search parity spike — the candidate query under test.
 *
 * Translates DrizzleProductRepository.searchRanked
 * (packages/data-platform/src/repositories/product.repository.ts) to
 * SQLite/D1:
 *
 *   pg original                                  | this translation
 *   ---------------------------------------------+--------------------------------
 *   recall: ILIKE %q% over name/brand/mfr        | FTS5 MATCH phrase w/ prefix
 *                (gin_trgm_ops accelerated)      | expansion + LIKE %q% merge
 *   rank: GREATEST(similarity(name, q),          | bm25 with column weights
 *         similarity(brand, q),                  | (name > brand > manufacturer),
 *         similarity(manufacturer, q)) DESC      | id ASC tie-break (same)
 *   tie: product id ASC                          | id ASC
 *   limit: caller-supplied (100 = MAX_PAGE_SIZE) | same
 *
 * Determinism: both orders are total (bm25 breaks ties via id ASC), so
 * repeated calls return identical order — the pg_trgm contract's
 * "similarity is a pure function + id tiebreak" guarantee.
 *
 * Blank/absent queries never reach this function in the controller —
 * SearchController passes them to the unfiltered alphabetical listing
 * (searchByName(null)); the listing order is produced app-side with
 * `localeCompare(name, 'fi')` exactly like SearchController.compareByName
 * (SQLite ships no Finnish collation, and D1 has no custom collations —
 * the final ordering must stay in application code).
 *
 * @module G2SpikeQuery
 */

/** bm25 column weights: name weighted highest, then brand, then
 *  manufacturer — mirrors GREATEST(per-field similarity) keeping a strong
 *  brand match on a weak name competitive but a name match ahead. */
const BM25_COLUMN_WEIGHTS = 'bm25(product_fts, 10.0, 5.0, 2.0)';

/** Extract unicode-letter tokens (Finnish/Swedish ä/ö/å included),
 *  lowercased — the tokens FTS5's unicode61 tokenizer also produces. */
export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/** Build the FTS5 MATCH expression: the full query as a phrase with
 *  prefix expansion on the final token ('"karhu" *' / '"le coq" *').
 *  This is the closest FTS5 analogue of the pg ILIKE '%q%' recall
 *  filter (adjacent phrase, mid-token impossible — that is what the
 *  LIKE merge below backfills). */
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

/** A product_master row (snake_case as SQLite returns it). */
export interface ProductRow {
  id: number;
  name: string;
  manufacturer: string;
  brand: string;
  category: string;
  alcohol_by_volume: string | null;
  unit_volume: string;
  container_type: string;
  regulatory_classification: string;
  deposit_system_status: number | null;
  ean: string | null;
  created_at: string;
  updated_at: string;
}

/** Minimal database surface the query uses (better-sqlite3 shape). */
export interface SqliteDb {
  prepare(sql: string): {
    all(...params: string[]): unknown[];
  };
}

/**
 * Ranked search over name, brand, and manufacturer — FTS5 MATCH with
 * prefix expansion first, LIKE '%q%' fallback/merge second, deterministic
 * tie-break ordering. Mirrors `searchRanked(query, limit)`.
 */
export function searchRanked(
  db: SqliteDb,
  query: string,
  limit: number,
): ProductRow[] {
  const trimmed = query.trim();
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    // Defensive: the controller routes blank queries to the unfiltered
    // listing, but the ranked function still total-orders instead of
    // throwing if ever called with whitespace.
    return listAlphabetical(db, limit);
  }

  // 1) FTS5 candidates — prefix-expanded phrase, bm25-ranked, id ASC tie.
  const ftsRows = db
    .prepare(
      `SELECT p.*
         FROM product_fts f
         JOIN product p ON p.id = f.rowid
        WHERE product_fts MATCH ?
        ORDER BY ${BM25_COLUMN_WEIGHTS} ASC, p.id ASC
        LIMIT ?`,
    )
    .all(buildMatchExpression(tokens), String(limit)) as ProductRow[];

  // 2) LIKE candidates — the ILIKE recall analogue; catches mid-token
  //    substrings ('arhu') the token-prefix match cannot express.
  //    LIKE is case-insensitive for ASCII in SQLite; non-ASCII case
  //    folding is already covered by the unicode61 FTS path above.
  const pattern = likePattern(trimmed);
  const likeRows = db
    .prepare(
      `SELECT * FROM product
        WHERE name LIKE ? ESCAPE '\\'
           OR brand LIKE ? ESCAPE '\\'
           OR manufacturer LIKE ? ESCAPE '\\'
        ORDER BY id ASC
        LIMIT ?`,
    )
    .all(pattern, pattern, pattern, String(limit)) as ProductRow[];

  // 3) Merge: FTS relevance order first, LIKE-only rows appended in id
  //    order — a total, deterministic order capped at the caller's limit.
  const seen = new Set<number>();
  const merged: ProductRow[] = [];
  for (const row of [...ftsRows, ...likeRows]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
    if (merged.length >= limit) break;
  }
  return merged;
}

/**
 * Unfiltered alphabetical listing — the repository `searchByName(null)`
 * path. Fetch-all + JS `localeCompare(…, 'fi')` mirrors
 * SearchController.compareByName; SQLite/D1 cannot provide the Finnish
 * collation server-side.
 */
export function listAlphabetical(db: SqliteDb, limit: number): ProductRow[] {
  const rows = db.prepare('SELECT * FROM product LIMIT ?').all(
    String(limit),
  ) as ProductRow[];
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'fi'));
}
