#!/usr/bin/env node
/**
 * alks.fi full-catalog read-only sweep (task 7.1, change
 * alks-feed-and-import-vat; design risks "SKU pattern coverage" and
 * "Name parser recall").
 *
 * Walks the live WooCommerce Store API collection page by page — the
 * same sequential, per_page-100, X-WP-TotalPages-bounded discipline as
 * the AlksFeedAdapter — and pushes every raw row through the
 * production parser (`parseAlksStoreProducts`), then reports:
 *
 *   1. EAN pattern coverage — share of SKUs matching `^[a-z]{2}-\d{13}$`,
 *      measured on the raw rows so rows the parser keeps silently (a
 *      missing or empty SKU) stay visible in the denominators.
 *   2. ESTIMATED share — parsed records whose ABV (null) or volume
 *      (0 ml) could not be parsed from the name; the rows the
 *      landed-cost estimate would carry as ESTIMATED.
 *   3. Category disagreements — name vs category beverage-type
 *      contradictions the parser drops to the correction queue.
 *
 * Plus the catalog total (X-WP-Total vs rows seen) and the
 * adapter-level row-drop categories with counts.
 *
 * Read-only: the script issues GET requests and nothing else — no
 * writes, no database, no state mutation anywhere.
 *
 * Usage (tsx from the data-platform workspace, per scripts/seed-d1.ts
 * convention — the path is relative to the package cwd):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/alks-catalog-sweep.ts
 */

import {
  parseAlksStoreProducts,
  type AlksParsedRecord,
} from '../packages/data-acquisition/src/adapters/alks.parser';

/** The live collection the sweep audits — the same URL the adapter builds from the registry feedUrl. */
const COLLECTION_URL = 'https://alks.fi/wp-json/wc/store/v1/products';

/** Store API page size maximum — also the walk's fixed page size (adapter parity). */
const PER_PAGE = 100;

/**
 * The raw-SKU rule the parser enforces. Duplicated deliberately: the
 * sweep measures the rule's reach on raw rows, including rows the
 * parser keeps without any error (missing/empty SKU), which the
 * parser's error stream alone cannot enumerate.
 */
const SKU_PATTERN = /^[a-z]{2}-\d{13}$/;

/** Full error lines printed per drop category, for the change notes. */
const SAMPLE_ERRORS_LIMIT = 5;

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

function pct(part: number, whole: number): string {
  if (whole === 0) return 'n/a';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/**
 * Row-drop categories, matched on the parser's correction-error
 * strings. Order matters only for presentation: the first five are
 * adapter-level drops (the row is gone); the last is a record the
 * parser KEPT without an EAN.
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
  readonly skuMatched: number;
  readonly skuMissing: number;
  readonly records: readonly AlksParsedRecord[];
  readonly parseErrors: readonly string[];
}

async function walkCatalog(): Promise<WalkResult> {
  const records: AlksParsedRecord[] = [];
  const parseErrors: string[] = [];
  const pageFailures: string[] = [];

  let wpTotal: number | null = null;
  let totalPages: number | null = null;
  let pagesFetched = 0;
  let pagesOk = 0;
  let rawRows = 0;
  let skuPresent = 0;
  let skuMatched = 0;
  let skuMissing = 0;

  // Adapter D2 discipline: sequential pages, capped by the first usable
  // X-WP-TotalPages; a missing/malformed header stops after the current
  // page instead of looping unbounded.
  for (let page = 1; totalPages === null || page <= totalPages; page++) {
    let response: Response;
    try {
      response = await fetch(`${COLLECTION_URL}?per_page=${PER_PAGE}&page=${page}`);
    } catch (err) {
      pageFailures.push(`alks page ${page} fetch failed: ${errorOf(err)}`);
      if (totalPages === null) break;
      continue;
    }

    if (totalPages === null) {
      totalPages = parseWpHeaderNumber(response.headers.get('X-WP-TotalPages'));
      if (totalPages === null) {
        pageFailures.push(
          `alks page ${page} response has no usable X-WP-TotalPages header — stopping after this page`,
        );
        totalPages = page;
      }
      wpTotal = parseWpHeaderNumber(response.headers.get('X-WP-Total'));
    }

    if (!response.ok) {
      pageFailures.push(
        `alks page ${page} returned HTTP ${response.status}: ${response.statusText}`,
      );
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      pageFailures.push(`alks page ${page} returned invalid JSON: ${errorOf(err)}`);
      continue;
    }

    pagesFetched++;
    if (!Array.isArray(payload)) {
      pageFailures.push(`alks page ${page} payload is not a JSON array`);
      continue;
    }
    pagesOk++;
    rawRows += payload.length;

    for (const row of payload) {
      const sku = rawSkuOf(row);
      if (sku === null) {
        skuMissing++;
      } else {
        skuPresent++;
        if (SKU_PATTERN.test(sku)) skuMatched++;
      }
    }

    const { records: pageRecords, errors: pageErrors } =
      parseAlksStoreProducts(payload);
    records.push(...pageRecords);
    parseErrors.push(...pageErrors);

    console.log(
      `[alks-sweep] page ${page}/${totalPages} — ${payload.length} rows, ` +
        `${pageRecords.length} records, ${pageErrors.length} errors`,
    );
  }

  return {
    wpTotal,
    totalPages,
    pagesFetched,
    pagesOk,
    pageFailures,
    rawRows,
    skuPresent,
    skuMatched,
    skuMissing,
    records,
    parseErrors,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function samplesOf(errors: readonly string[], match: (e: string) => boolean): string[] {
  return errors.filter(match).slice(0, SAMPLE_ERRORS_LIMIT);
}

function printReport(walk: WalkResult): void {
  const { records } = walk;

  console.log('');
  console.log('=== alks.fi full-catalog sweep (task 7.1, alks-feed-and-import-vat) ===');
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

  // 1. EAN pattern coverage — measured on raw rows.
  console.log('-- 1. EAN pattern coverage (SKU ^[a-z]{2}-\\d{13}$) --');
  console.log(`rows with a SKU: ${walk.skuPresent}`);
  console.log(`rows with no/empty SKU: ${walk.skuMissing}`);
  console.log(
    `SKUs matching the rule: ${walk.skuMatched} ` +
      `(${pct(walk.skuMatched, walk.skuPresent)} of SKUs present, ` +
      `${pct(walk.skuMatched, walk.rawRows)} of all rows)`,
  );
  console.log(
    `SKUs NOT matching (kept without EAN, correction queue): ${walk.skuPresent - walk.skuMatched}`,
  );
  console.log('');

  // 2. ESTIMATED share — unparsed ABV (null) or volume (0).
  const abvNull = records.filter((r) => r.alcoholByVolume === null).length;
  const volumeZero = records.filter((r) => r.volumeMl === 0).length;
  const estimated = records.filter(
    (r) => r.alcoholByVolume === null || r.volumeMl === 0,
  ).length;
  const bothMissing = records.filter(
    (r) => r.alcoholByVolume === null && r.volumeMl === 0,
  ).length;

  console.log('-- 2. ESTIMATED share (unparsed ABV or volume) --');
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

  // 3. Category disagreements + all other drop categories.
  console.log('-- 3. Category disagreements and row-drop categories --');
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

  // Unmatched error lines mean the classification table drifted from
  // the parser's wording — say so instead of silently absorbing them.
  const unclassified = walk.parseErrors.filter(
    (e) => !ERROR_CATEGORIES.some((c) => c.match(e)),
  ).length;
  if (unclassified > 0) {
    console.log(`WARNING: ${unclassified} parse error(s) matched no known category:`);
    for (const sample of samplesOf(
      walk.parseErrors,
      (e) => !ERROR_CATEGORIES.some((c) => c.match(e)),
    )) {
      console.log(`  unclassified: ${sample}`);
    }
    console.log('');
  }

  const ok = walk.pageFailures.length === 0 && walk.rawRows > 0;
  console.log(
    ok
      ? '=== sweep COMPLETE — numbers above are the 7.1 report ==='
      : '=== sweep INCOMPLETE — page failures or an empty walk; do not trust the shares above ===',
  );
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[alks-sweep] alks.fi full-catalog sweep — read-only GETs, sequential pages');
  const walk = await walkCatalog();
  printReport(walk);
}

main().catch((err: unknown) => {
  console.error(`[alks-sweep] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
