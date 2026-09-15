#!/usr/bin/env node
/**
 * kippis.net full-catalog read-only sweep (task 1.1, change
 * onboard-kippis-merchant; proposal risks "SKU pattern coverage" and
 * the multipack case-price skew; design D2/D3 scope this sweep
 * informs).
 *
 * Cloned from the longero sweep (scripts/longero-catalog-sweep.ts):
 * the same sequential, per_page-100, X-WP-TotalPages-bounded walk as
 * the alks adapter, pushing every raw row through the production
 * parser (`parseAlksStoreProducts`, reused unchanged), then reports:
 *
 *   1. SKU/EAN gap — the kippis SKU vocabulary the current parser
 *      rule (`^[a-z]{2}-\d{13}$`) rejects. Raw SKUs are classified
 *      into the design D2 candidate buckets: prefixed, bare 13-digit,
 *      GTIN-14 (`^0\d{13}$`), and "other" (12-digit numerics, internal
 *      codes) with samples, so task 2.1's shape scope is measured on
 *      the whole catalog instead of the 300-row probe.
 *   2. Multipack case-pricing behavior — names with case-style count
 *      tokens (`33cl x 24`, `24 x 33cl`, loose `x 24`). For rows with
 *      a trustworthy pack count, the price implied by per-container
 *      volume (what the parser keeps) is compared against non-multipack
 *      rows: a median implied €/l around the pack-count multiple of
 *      the singles' median says `prices.price` is the case price
 *      (the design's accepted skew, quantified here — no semantics
 *      change).
 *   3. ESTIMATED share — parsed records whose ABV (null) or volume
 *      (0 ml) could not be parsed from the name.
 *   4. Row-drop categories — the parser's correction-error taxonomy,
 *      plus the same errors attributed to the row's raw category
 *      terms (or 'uncategorized') so the Finnish categories driving
 *      drops are visible.
 *   5. Finnish category-vocabulary coverage — rows carrying each D3
 *      candidate term (substring and exact, case-insensitive) plus a
 *      census of the raw distinct category terms, so task 1.2 can
 *      trim/extend the additive key list from data.
 *
 * Probe facts this walk verifies at full scale (proposal): 677
 * products (X-WP-Total), ~25 on sale with the effective sale price
 * already in `prices.price`, all rows `type: simple`, EUR minor
 * units, Finnish comma decimals in names (`41,7% 70 cl`), 82% bare
 * 13-digit SKUs, 7% GTIN-14.
 *
 * Read-only: the script issues GET requests and nothing else — no
 * writes, no database, no state mutation anywhere.
 *
 * Usage (tsx from the data-platform workspace, per scripts/seed-d1.ts
 * convention — the path is relative to the package cwd):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/kippis-catalog-sweep.ts
 */

import {
  parseAlksStoreProducts,
  type AlksParsedRecord,
} from '../packages/data-acquisition/src/adapters/alks.parser';

/** The live collection the sweep audits — the same URL the kippis adapter will build from the registry feedUrl. */
const COLLECTION_URL = 'https://www.kippis.net/wp-json/wc/store/v1/products';

/** Store API page size maximum — also the walk's fixed page size (adapter parity). */
const PER_PAGE = 100;

/**
 * Design D2 SKU shapes, measured on the raw rows so rows the parser
 * keeps silently (missing/empty SKU, kept-without-EAN) stay visible
 * in the denominators. The current parser accepts only the prefixed
 * shape; the other two are the task-2.1 extension candidates.
 */
const SKU_PREFIXED_PATTERN = /^[a-z]{2}-\d{13}$/;
const SKU_BARE13_PATTERN = /^\d{13}$/;
const SKU_GTIN14_PATTERN = /^0\d{13}$/;

/**
 * 12-digit numeric SKUs — the design D2 open question ("whether
 * 12-digit rows are worth a ruling"): zero-padding UPC-A is rejected
 * as a guess, so the count decides if they matter. A subset of the
 * "other" bucket, reported separately.
 */
const SKU_TWELVE_DIGIT_PATTERN = /^\d{12}$/;

/**
 * Case-style count tokens in names. The structured forms yield a
 * trustworthy pack count for the price-skew arithmetic; the loose
 * `x N` form bounds the total share of case-style names (its count
 * can misread count-first names like `24 x 33cl`, so it never feeds
 * the skew math).
 */
const MULTIPACK_VOLUME_X_COUNT_PATTERN = /(\d+(?:[.,]\d+)?)\s*(ml|cl|l)(?![a-z])\s*x\s*(\d{1,3})\b/i;
const MULTIPACK_COUNT_X_VOLUME_PATTERN = /(\d{1,3})\s*x\s*(\d+(?:[.,]\d+)?)\s*(ml|cl|l)(?![a-z])/i;
const MULTIPACK_ANY_X_COUNT_PATTERN = /\bx\s*(\d{1,3})\b/i;

/** Full error lines printed per drop category, for the change notes. */
const SAMPLE_ERRORS_LIMIT = 5;

/** Census/attribution rows printed per list — keeps the report readable on a 677-row catalog. */
const TOP_TERMS_LIMIT = 30;
const TOP_ERROR_TERMS_LIMIT = 20;

/**
 * Finnish category-vocabulary candidates for the additive
 * `mapSourceCategory` keys (design D3, task 1.2). Matched
 * case-insensitively — as a substring of the raw category terms (the
 * longero convention, tolerating compound/inflected store terms) and
 * as an exact term (what an additive exact-match key actually hits).
 * Read-only and deterministic: the same rows always yield the same
 * counts.
 */
const FINNISH_CATEGORY_TERMS: ReadonlyArray<string> = [
  'valkoviinit',
  'punaviinit',
  'kuohuviinit',
  'viskit',
  'rommit',
  'liköörit',
  'konjakit',
  'ginit',
  'aperitiivit',
  'vodkat ja viinat',
  'siiderit lonkerot ja seltzerit',
  'virvoitusjuomat ja mikserit',
  'energiajuomat',
];

// ---------------------------------------------------------------------------
// Shared helpers (kept local — the adapter/parser do not export them)
// ---------------------------------------------------------------------------

/** '29' → 29; anything else (missing, empty, non-numeric) → null. */
function parseWpHeaderNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

/** The row's trimmed SKU, or null when absent/empty (parser parity). */
function rawSkuOf(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null;
  const sku = (row as { sku?: unknown }).sku;
  if (typeof sku !== 'string') return null;
  const trimmed = sku.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The row's id exactly as the parser renders it in its error labels
 * (`String(id)` for finite numbers, `(unknown)` otherwise) — the join
 * key attributing parse errors back to the raw row's categories.
 */
function rawIdOf(row: unknown): string {
  if (typeof row !== 'object' || row === null) return '(unknown)';
  const id = (row as { id?: unknown }).id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return String(id ?? '(unknown)');
}

/**
 * The row's non-empty category terms, in payload order — the
 * classification data the parser's category source reads.
 */
function categoryNamesOf(row: unknown): string[] {
  if (typeof row !== 'object' || row === null) return [];
  const categories = (row as { categories?: unknown }).categories;
  if (!Array.isArray(categories)) return [];
  const names: string[] = [];
  for (const entry of categories) {
    if (typeof entry !== 'object' || entry === null) continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== 'string') continue;
    const trimmed = name.trim();
    if (trimmed !== '') names.push(trimmed);
  }
  return names;
}

/** The row's trimmed name, or null when absent/empty (parser parity). */
function rawNameOf(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null;
  const name = (row as { name?: unknown }).name;
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed === '' ? null : trimmed;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return 'n/a';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** Median of a numeric sample; null only for an empty sample. */
function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The product id a parser error line names. The parser's drop and
 * kept-without-EAN errors all start `Failed to map alks product
 * <id> (SKU <sku>): …` (the 'alks' label is the parser's hardcoded
 * merchant prefix); lines that name no id cannot be attributed to a
 * category and are counted as attribution misses instead.
 */
const ERROR_LABEL_PATTERN = /^Failed to map alks product (.+?)(?: \(SKU [^)]*\))?: /;

function errorProductIdOf(error: string): string | null {
  const match = ERROR_LABEL_PATTERN.exec(error);
  return match === null ? null : match[1];
}

/**
 * Pack count from a structured case-style name: `33cl x 24` (volume
 * then count) or `24 x 33cl` (count then volume); null when only the
 * loose form matched.
 */
function structuredPackCountOf(name: string): number | null {
  const volumeFirst = MULTIPACK_VOLUME_X_COUNT_PATTERN.exec(name);
  if (volumeFirst !== null) return Number.parseInt(volumeFirst[3], 10);
  const countFirst = MULTIPACK_COUNT_X_VOLUME_PATTERN.exec(name);
  if (countFirst !== null) return Number.parseInt(countFirst[1], 10);
  return null;
}

/**
 * Row-drop categories, matched on the parser's correction-error
 * strings. Order matters only for presentation: the first five are
 * adapter-level drops (the row is gone); the last is a record the
 * parser KEPT without an EAN — the bucket task 2.1 shrinks.
 */
const ERROR_CATEGORIES: ReadonlyArray<{
  readonly label: string;
  readonly dropped: boolean;
  readonly match: (error: string) => boolean;
}> = [
  {
    label: 'category disagreement (name vs categories)',
    dropped: true,
    match: (e) => e.includes('disagreeing sources'),
  },
  {
    label: 'no canonical beverage category',
    dropped: true,
    match: (e) => e.includes('no canonical beverage category'),
  },
  {
    label: 'non-EUR price',
    dropped: true,
    match: (e) => e.includes('is not EUR'),
  },
  {
    label: 'invalid minor-unit price',
    dropped: true,
    match: (e) => e.includes('minor-unit price'),
  },
  {
    label: 'missing product name',
    dropped: true,
    match: (e) => e.includes('empty product name'),
  },
  {
    label: 'non-matching SKU (record kept, no EAN)',
    dropped: false,
    match: (e) => e.includes('does not match'),
  },
];

function errorCategoryLabelOf(error: string): string {
  const category = ERROR_CATEGORIES.find((c) => c.match(error));
  return category === undefined ? 'unclassified' : category.label;
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

interface WalkResult {
  readonly wpTotal: number | null;
  readonly totalPages: number | null;
  readonly pagesFetched: number;
  readonly pagesOk: number;
  readonly pageFailures: readonly string[];
  readonly rawRows: number;
  readonly skuPresent: number;
  readonly skuMissing: number;
  readonly skuPrefixed: number;
  readonly skuBare13: number;
  readonly skuGtin14: number;
  readonly skuOther: number;
  readonly skuTwelveDigit: number;
  readonly otherSkuSamples: readonly string[];
  readonly multipackAnyRows: number;
  readonly multipackStructuredRows: number;
  readonly records: readonly AlksParsedRecord[];
  readonly parseErrors: readonly string[];
  /** Raw category term → row count (a multi-term row counts once per term). */
  readonly categoryCensus: ReadonlyMap<string, number>;
  /** Parser error lines attributed per raw category term ('uncategorized' when the row has no terms). */
  readonly errorsByTerm: ReadonlyMap<string, Map<string, number>>;
  readonly attributionMisses: number;
}

async function walkCatalog(): Promise<WalkResult> {
  const records: AlksParsedRecord[] = [];
  const parseErrors: string[] = [];
  const pageFailures: string[] = [];
  const categoryCensus = new Map<string, number>();
  const errorsByTerm = new Map<string, Map<string, number>>();
  const categoriesById = new Map<string, string[]>();
  const otherSkuSamples: string[] = [];

  let wpTotal: number | null = null;
  let totalPages: number | null = null;
  let pagesFetched = 0;
  let pagesOk = 0;
  let rawRows = 0;
  let skuPresent = 0;
  let skuMissing = 0;
  let skuPrefixed = 0;
  let skuBare13 = 0;
  let skuGtin14 = 0;
  let skuOther = 0;
  let skuTwelveDigit = 0;
  let multipackAnyRows = 0;
  let multipackStructuredRows = 0;
  let attributionMisses = 0;

  // Adapter D2 discipline: sequential pages, capped by the first usable
  // X-WP-TotalPages; a missing/malformed header stops after the current
  // page instead of looping unbounded.
  for (let page = 1; totalPages === null || page <= totalPages; page++) {
    let response: Response;
    try {
      response = await fetch(`${COLLECTION_URL}?per_page=${PER_PAGE}&page=${page}`);
    } catch (err) {
      pageFailures.push(`kippis page ${page} fetch failed: ${errorOf(err)}`);
      if (totalPages === null) break;
      continue;
    }

    if (totalPages === null) {
      totalPages = parseWpHeaderNumber(response.headers.get('X-WP-TotalPages'));
      if (totalPages === null) {
        pageFailures.push(
          `kippis page ${page} response has no usable X-WP-TotalPages header — stopping after this page`,
        );
        totalPages = page;
      }
      wpTotal = parseWpHeaderNumber(response.headers.get('X-WP-Total'));
    }

    if (!response.ok) {
      pageFailures.push(
        `kippis page ${page} returned HTTP ${response.status}: ${response.statusText}`,
      );
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      pageFailures.push(`kippis page ${page} returned invalid JSON: ${errorOf(err)}`);
      continue;
    }

    pagesFetched++;
    if (!Array.isArray(payload)) {
      pageFailures.push(`kippis page ${page} payload is not a JSON array`);
      continue;
    }
    pagesOk++;
    rawRows += payload.length;

    for (const row of payload) {
      // SKU buckets (mutually exclusive by length/shape; priority order
      // prefixed → GTIN-14 → bare-13 → other).
      const sku = rawSkuOf(row);
      if (sku === null) {
        skuMissing++;
      } else if (SKU_PREFIXED_PATTERN.test(sku)) {
        skuPresent++;
        skuPrefixed++;
      } else if (SKU_GTIN14_PATTERN.test(sku)) {
        skuPresent++;
        skuGtin14++;
      } else if (SKU_BARE13_PATTERN.test(sku)) {
        skuPresent++;
        skuBare13++;
      } else {
        skuPresent++;
        skuOther++;
        if (SKU_TWELVE_DIGIT_PATTERN.test(sku)) skuTwelveDigit++;
        if (otherSkuSamples.length < SAMPLE_ERRORS_LIMIT) otherSkuSamples.push(sku);
      }

      // Multipack name tokens, on raw rows so rows dropped elsewhere
      // still count in the denominator.
      const name = rawNameOf(row);
      if (name !== null) {
        const structured = structuredPackCountOf(name);
        if (structured !== null) {
          multipackStructuredRows++;
          multipackAnyRows++;
        } else if (MULTIPACK_ANY_X_COUNT_PATTERN.test(name)) {
          multipackAnyRows++;
        }
      }

      // Category census + the id → categories map the error
      // attribution reads.
      const categoryNames = categoryNamesOf(row);
      for (const term of new Set(categoryNames)) {
        categoryCensus.set(term, (categoryCensus.get(term) ?? 0) + 1);
      }
      categoriesById.set(rawIdOf(row), categoryNames);
    }

    const { records: pageRecords, errors: pageErrors } =
      parseAlksStoreProducts(payload);
    records.push(...pageRecords);
    parseErrors.push(...pageErrors);

    console.log(
      `[kippis-sweep] page ${page}/${totalPages} — ${payload.length} rows, ` +
        `${pageRecords.length} records, ${pageErrors.length} errors`,
    );
  }

  // Attribute every parse error line to the raw row's category terms
  // (each term of a multi-term row receives the line; rows without
  // terms land on 'uncategorized').
  for (const error of parseErrors) {
    const id = errorProductIdOf(error);
    const terms = id !== null ? categoriesById.get(id) : undefined;
    if (terms === undefined) {
      attributionMisses++;
      continue;
    }
    const label = errorCategoryLabelOf(error);
    const bucketKeys = terms.length > 0 ? [...new Set(terms)] : ['uncategorized'];
    for (const term of bucketKeys) {
      const breakdown = errorsByTerm.get(term) ?? new Map<string, number>();
      breakdown.set(label, (breakdown.get(label) ?? 0) + 1);
      errorsByTerm.set(term, breakdown);
    }
  }

  return {
    wpTotal,
    totalPages,
    pagesFetched,
    pagesOk,
    pageFailures,
    rawRows,
    skuPresent,
    skuMissing,
    skuPrefixed,
    skuBare13,
    skuGtin14,
    skuOther,
    skuTwelveDigit,
    otherSkuSamples,
    multipackAnyRows,
    multipackStructuredRows,
    records,
    parseErrors,
    categoryCensus,
    errorsByTerm,
    attributionMisses,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function samplesOf(errors: readonly string[], match: (e: string) => boolean): string[] {
  return errors.filter(match).slice(0, SAMPLE_ERRORS_LIMIT);
}

/** Total error lines attributed to one raw category term. */
function errorTermTotal(entry: readonly [string, Map<string, number>]): number {
  return [...entry[1].values()].reduce((sum, value) => sum + value, 0);
}

/** Implied €/l of a record at its kept (per-container) volume; null when volume is 0. */
function impliedEurPerLitreOf(record: AlksParsedRecord): number | null {
  if (record.volumeMl <= 0) return null;
  return record.priceCents / 100 / (record.volumeMl / 1000);
}

function printReport(walk: WalkResult): void {
  const { records } = walk;

  console.log('');
  console.log('=== kippis.net full-catalog sweep (task 1.1, change onboard-kippis-merchant) ===');
  console.log(`collection: ${COLLECTION_URL} (per_page=${PER_PAGE}, sequential, read-only)`);
  console.log('');

  console.log('-- Catalog walk --');
  console.log(
    `X-WP-Total (page 1): ${walk.wpTotal === null ? '(no header)' : walk.wpTotal}` +
      ` | pages declared: ${walk.totalPages === null ? '(unbounded)' : walk.totalPages}` +
      ` | pages fetched ok: ${walk.pagesOk}/${walk.pagesFetched}` +
      ` | page failures: ${walk.pageFailures.length}`,
  );
  console.log(`raw rows seen: ${walk.rawRows}`);
  if (walk.wpTotal !== null && walk.wpTotal !== walk.rawRows) {
    console.log(
      `WARNING: rows seen (${walk.rawRows}) differ from X-WP-Total (${walk.wpTotal}) — ` +
        'pagination drift or catalog change mid-walk',
    );
  }
  for (const failure of walk.pageFailures) {
    console.log(`page failure: ${failure}`);
  }
  console.log('');

  // 1. SKU/EAN gap — the D2 buckets, measured on raw rows.
  console.log('-- 1. SKU/EAN gap (design D2 buckets, raw rows) --');
  console.log(`rows with a SKU: ${walk.skuPresent} | rows with no/empty SKU: ${walk.skuMissing}`);
  console.log(
    `prefixed ^[a-z]{2}-\\d{13}$ (accepted today): ${walk.skuPrefixed} ` +
      `(${pct(walk.skuPrefixed, walk.skuPresent)} of SKUs present)`,
  );
  console.log(
    `bare 13-digit ^\\d{13}$ (task 2.1 candidate): ${walk.skuBare13} ` +
      `(${pct(walk.skuBare13, walk.skuPresent)})`,
  );
  console.log(
    `GTIN-14 ^0\\d{13}$ (task 2.1 candidate): ${walk.skuGtin14} ` +
      `(${pct(walk.skuGtin14, walk.skuPresent)})`,
  );
  console.log(
    `other (stays EAN-less): ${walk.skuOther} (${pct(walk.skuOther, walk.skuPresent)})` +
      ` — of which 12-digit numeric: ${walk.skuTwelveDigit}`,
  );
  for (const sample of walk.otherSkuSamples) {
    console.log(`  sample "other" SKU: ${sample}`);
  }
  const d2Covered = walk.skuPrefixed + walk.skuBare13 + walk.skuGtin14;
  console.log(
    `D2 accepted shapes cover: ${d2Covered} SKUs (${pct(d2Covered, walk.skuPresent)} of SKUs present, ` +
      `${pct(d2Covered, walk.rawRows)} of all rows)`,
  );
  console.log('');
  // 2. Multipack case-pricing behavior — descriptive only.
  console.log('-- 2. Multipack case-style names (`33cl x 24` case pricing) --');
  console.log(
    `rows with a structured volume/count case name (33cl x 24 / 24 x 33cl): ${walk.multipackStructuredRows} ` +
      `(${pct(walk.multipackStructuredRows, walk.rawRows)} of raw rows)`,
  );
  console.log(
    `rows with any loose "x N" count token (superset): ${walk.multipackAnyRows} ` +
      `(${pct(walk.multipackAnyRows, walk.rawRows)} of raw rows)`,
  );

  const multipackRecords = records.filter((r) => structuredPackCountOf(r.productName) !== null);
  const withCountAndVolume = multipackRecords.filter(
    (r) => r.volumeMl > 0 && (structuredPackCountOf(r.productName) ?? 0) > 1,
  );
  const multipackImplied = withCountAndVolume
    .map((r) => impliedEurPerLitreOf(r))
    .filter((v): v is number => v !== null);
  const multipackAdjusted = withCountAndVolume
    .map((r) => {
      const perLitre = impliedEurPerLitreOf(r);
      const count = structuredPackCountOf(r.productName) ?? 0;
      return perLitre === null || count === 0 ? null : perLitre / count;
    })
    .filter((v): v is number => v !== null);
  const singlesImplied = records
    .filter((r) => structuredPackCountOf(r.productName) === null)
    .map((r) => impliedEurPerLitreOf(r))
    .filter((v): v is number => v !== null);

  const singlesMedian = medianOf(singlesImplied);
  const multipackMedian = medianOf(multipackImplied);
  const adjustedMedian = medianOf(multipackAdjusted);
  console.log(
    `parsed multipack records with count+volume: ${withCountAndVolume.length} of ${records.length} records`,
  );
  if (singlesMedian !== null) {
    let mediansLine =
      `median implied €/l at kept volume — non-multipack records: ${singlesMedian.toFixed(2)}`;
    if (multipackMedian !== null) {
      mediansLine += ` | multipack (per-container volume, full price): ${multipackMedian.toFixed(2)}`;
    }
    if (adjustedMedian !== null) {
      mediansLine += ` | multipack case-adjusted (÷ pack count): ${adjustedMedian.toFixed(2)}`;
    }
    console.log(mediansLine);
    if (multipackMedian !== null) {
      const skew = multipackMedian / singlesMedian;
      const likelyCasePriced = withCountAndVolume.filter((r) => {
        const perLitre = impliedEurPerLitreOf(r);
        return perLitre !== null && perLitre > 2 * singlesMedian;
      }).length;
      console.log(
        `case-price skew (multipack median ÷ singles median): ${skew.toFixed(1)}× — ` +
          `${likelyCasePriced} multipack record(s) imply >2× the singles median at per-container volume` +
          ' (heuristic: such rows carry the CASE price while the parser keeps per-container volume)',
      );
    }
  }
  for (const record of multipackRecords.slice(0, SAMPLE_ERRORS_LIMIT)) {
    const count = structuredPackCountOf(record.productName);
    const perLitre = impliedEurPerLitreOf(record);
    const adjusted =
      perLitre !== null && count !== null && count > 0 ? ` → ${(perLitre / count).toFixed(2)} €/l if case price` : '';
    console.log(
      `  sample: ${record.productName} — ${(record.priceCents / 100).toFixed(2)} EUR, ` +
        `${count ?? '?'}×${record.volumeMl} ml` +
        (perLitre !== null ? `, ${perLitre.toFixed(2)} €/l at kept volume${adjusted}` : ''),
    );
  }
  console.log('');

  // 3. ESTIMATED share — unparsed ABV (null) or volume (0).
  const abvNull = records.filter((r) => r.alcoholByVolume === null).length;
  const volumeZero = records.filter((r) => r.volumeMl === 0).length;
  const estimated = records.filter(
    (r) => r.alcoholByVolume === null || r.volumeMl === 0,
  ).length;
  const bothMissing = records.filter(
    (r) => r.alcoholByVolume === null && r.volumeMl === 0,
  ).length;

  console.log('-- 3. ESTIMATED share (unparsed ABV or volume) --');
  console.log(`records parsed: ${records.length} of ${walk.rawRows} raw rows`);
  console.log(`ABV unparsed (null): ${abvNull} (${pct(abvNull, records.length)} of records)`);
  console.log(`volume unparsed (0 ml): ${volumeZero} (${pct(volumeZero, records.length)})`);
  console.log(`both unparsed: ${bothMissing} (${pct(bothMissing, records.length)})`);
  console.log(
    `ESTIMATED (either unparsed): ${estimated} ` +
      `(${pct(estimated, records.length)} of records, ${pct(estimated, walk.rawRows)} of raw rows)`,
  );
  for (const record of records
    .filter((r) => r.alcoholByVolume === null || r.volumeMl === 0)
    .slice(0, SAMPLE_ERRORS_LIMIT)) {
    const missing =
      record.alcoholByVolume === null && record.volumeMl === 0
        ? 'ABV+volume'
        : record.alcoholByVolume === null
          ? 'ABV'
          : 'volume';
    console.log(`  sample (missing ${missing}): ${record.productName}`);
  }
  console.log('');

  // 4. Row-drop categories, then the same errors attributed to raw
  // category terms — the Finnish categories driving drops.
  console.log('-- 4. Row-drop categories --');
  let droppedTotal = 0;
  for (const category of ERROR_CATEGORIES) {
    const count = walk.parseErrors.filter(category.match).length;
    if (category.dropped) droppedTotal += count;
    console.log(
      `${category.dropped ? 'DROP  ' : 'KEPT  '}${category.label}: ${count}` +
        (category.dropped ? ` (${pct(count, walk.rawRows)} of rows)` : ''),
    );
    for (const sample of samplesOf(walk.parseErrors, category.match)) {
      console.log(`  sample: ${sample}`);
    }
  }
  console.log(`records parsed: ${records.length} + rows dropped: ${droppedTotal} = ${records.length + droppedTotal} of ${walk.rawRows} raw rows`);
  console.log('');

  console.log('-- 4b. Parse-error distribution by raw category term --');
  console.log('a multi-term row attributes each of its error lines to every term it carries');
  const errorTerms = [...walk.errorsByTerm.entries()]
    .sort((a, b) => errorTermTotal(b) - errorTermTotal(a))
    .slice(0, TOP_ERROR_TERMS_LIMIT);
  if (errorTerms.length === 0) {
    console.log('(no parse errors to attribute)');
  }
  for (const [term, breakdown] of errorTerms) {
    const total = [...breakdown.values()].reduce((sum, value) => sum + value, 0);
    const parts = [...breakdown.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => `${label}: ${count}`)
      .join('; ');
    console.log(`term "${term}": ${total} error line(s) — ${parts}`);
  }
  if (walk.attributionMisses > 0) {
    console.log(
      `error lines not attributable to a raw row (page-level or id-less): ${walk.attributionMisses}`,
    );
  }
  console.log('');

  // 5. Finnish category-vocabulary coverage + raw term census — the
  // task 1.2 gate, measured before any mapping change.
  console.log('-- 5. Finnish category-vocabulary coverage (design D3 candidates) --');
  for (const term of FINNISH_CATEGORY_TERMS) {
    const needle = term.toLowerCase();
    let substringRows = 0;
    let exactRows = 0;
    for (const [rawTerm, count] of walk.categoryCensus) {
      const lowered = rawTerm.toLowerCase();
      if (lowered.includes(needle)) substringRows += count;
      if (lowered === needle) exactRows += count;
    }
    console.log(
      `term "${term}": ${substringRows} rows by substring (${pct(substringRows, walk.rawRows)})` +
        ` / ${exactRows} rows by exact term match`,
    );
  }
  console.log('');
  console.log(`-- 5b. Raw distinct category terms (top ${TOP_TERMS_LIMIT} by rows carrying the term) --`);
  const census = [...walk.categoryCensus.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`distinct raw category terms: ${census.length}`);
  for (const [term, count] of census.slice(0, TOP_TERMS_LIMIT)) {
    console.log(`  "${term}": ${count} rows (${pct(count, walk.rawRows)})`);
  }
  console.log('');

  const ok = walk.pageFailures.length === 0 && walk.rawRows > 0;
  console.log(
    ok
      ? '=== sweep COMPLETE — numbers above are the 1.1 report ==='
      : '=== sweep INCOMPLETE — page failures or an empty walk; do not trust the shares above ===',
  );
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[kippis-sweep] kippis.net full-catalog sweep — read-only GETs, sequential pages');
  const walk = await walkCatalog();
  printReport(walk);
}

main().catch((err: unknown) => {
  console.error(`[kippis-sweep] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
