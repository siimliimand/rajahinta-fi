#!/usr/bin/env node
/**
 * lmdw (gateway.prod2.whisky.fr) full-catalog read-only sweep + the ABV/volume
 * spike (task 1.3 of onboard-shopify-lmdw-merchants — the decision task that
 * gates the LMDW adapter, design D5).
 *
 * Magento 2 GraphQL, not REST: the gateway rejects filter-less `products`
 * queries ("L'argument « rechercher » ou « filtrer » est obligatoire"), so the
 * walk is a sequential pageSize-100 pages over the mandatory
 * `filter: { category_id: { eq: "3" } }` (Nature de produit branch), bounded
 * by `total_count`/`page_info` plus a hard page cap, with `sku` dedupe for
 * multi-category rows. The probe (2026-10-07) measured 3,213 products and a
 * 60-page cap was expected to suffice; the live total_count at sweep time is
 * larger (the LMDW catalog was updated between probe and sweep), so the hard
 * cap is 75 pages — still a hard bound, never unbounded. Deviation flagged in
 * the change notes.
 *
 * The spike measures, over the deduped walk:
 *
 *   1. ABV share of `short_description.html` (tags stripped, entities
 *      unescaped, French `%` patterns incl. `45,8%` and `à 52%`), with the
 *      comma-vs-integer decimal split as the cross-check. This share decides
 *      whether an adapter lands a mostly-ESTIMATED (hygiene-held) catalog.
 *   2. The volume hunt, in the design's priority order:
 *        a. `lmdw_label` — type introspected first (`LmdwLabel`), 20-row
 *           sample printed, plus a volume-token scan over every label name;
 *        b. name suffixes (`70cl` / `70 cl` / `0,7`-style) in `name`;
 *        c. packaging-category membership (category 2841, "Type de
 *           conditionnement") — a cross-reference, not a per-row source;
 *        d. 10 sampled product pages from `url_key` reconstruction
 *           (www.whisky.fr first, www.lmdw.com fallback; GET only), looking
 *           for the page's embedded volume (`"volume"` state JSON or
 *           `data-lmdw-el="volume"` markup, cl/litre forms).
 *      The report names the source with the highest measured coverage.
 *   3. `m3_family` census (all distinct labels + counts — the FR vocabulary
 *      input for the source-category mapper), plus an `m3_division` census
 *      (the liquide/non-liquide merch split).
 *   4. Currency check — any non-EUR `final_price` across the walk.
 *   5. Anomalies — `gift_box` label census, `stock_status` census,
 *      non-liquide divisions, missing prices.
 *
 * `custom_attributesV2` is deliberately NOT queried — it returns internal
 * server errors on probed products (probe 2026-10-07, recorded in design D5).
 *
 * Read-only: the script issues GraphQL read queries and GET requests and
 * nothing else — no writes, no database, no state mutation anywhere.
 *
 * Usage (tsx from the data-platform workspace, per scripts/seed-d1.ts
 * convention — the path is relative to the package cwd):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/lmdw-catalog-sweep.ts
 */

/** The LMDW Magento GraphQL gateway — the same endpoint the adapter will use. */
const GRAPHQL_ENDPOINT = 'https://gateway.prod2.whisky.fr/graphql';

/** Walk page size maximum (adapter parity — the adapter walks the same way). */
const PAGE_SIZE = 100;

/**
 * Hard page cap. The probe's 3,213-product walk fit in 60 pages; the live
 * catalog measured 6,821 rows at sweep time (69 pages), so the cap is 75 —
 * a hard bound, never unbounded (the bottleofitaly 1.1 precedent for
 * raising a cap with a flagged deviation).
 */
const PAGE_HARD_CAP = 75;

/** ~3 s pacing between GraphQL calls and product-page GETs. */
const PACE_MS = 3_000;

/** The single-retry wait for 429/5xx/non-JSON responses before recording a page failure. */
const RETRY_WAIT_MS = 30_000;

/** Category ids from the probe: Nature de produit branch + Type de conditionnement. */
const NATURE_CATEGORY_ID = '3';
const PACKAGING_CATEGORY_ID = '2841';

/** Sample sizes mandated by the spike: 20 label rows, 10 product pages. */
const LABEL_SAMPLE_LIMIT = 20;
const PAGE_SAMPLE_LIMIT = 10;

/** Census/attribution rows printed per list — keeps the report readable. */
const TOP_TERMS_LIMIT = 40;
const SAMPLE_LIMIT = 5;

/**
 * The honest crawler UA the crawl sweeps already use — and what the Workers
 * egress will look like, so this doubles as an egress-behavior preview.
 */
const PRODUCT_PAGE_USER_AGENT = 'rajahinta-crawler/1.0 (+https://rajahinta.fi)';

/** Product-page hosts tried in order (url_key reconstruction). */
const PRODUCT_PAGE_HOSTS: ReadonlyArray<string> = [
  'https://www.whisky.fr',
  'https://www.lmdw.com',
];

/**
 * French ABV pattern from the task text (`45,8%`, `45.6 %`, `à 52%` —
 * one-or-two-digit integer or comma/dot decimal, optional whitespace incl.
 * no-break spaces, then `%`), with a leading-digit guard: unguarded, the
 * pattern clips the tail off larger numbers — `100% agave` matches as
 * `00%` — which the first run measured at 276 phantom rows. The unguarded
 * form is kept as ABV_RAW_PATTERN purely for the artifact cross-check.
 */
const ABV_PATTERN = /(?<!\d)(\d{1,2}[.,]\d{1,2}|\d{1,2})\s*%/g;
const ABV_RAW_PATTERN = /(\d{1,2}[.,]\d{1,2}|\d{1,2})\s*%/g;

/**
 * Volume-in-name forms, from the spike's `70cl`/`70 cl`/`0,7` examples.
 * Explicit cl/ml tokens, dot/comma litre decimals with a unit or the word
 * litre, and unitless sub-litre decimals (`0,7`) as the weakest form.
 */
const NAME_EXPLICIT_VOLUME_PATTERN = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:cl|ml)\b/i;
const NAME_LITRE_VOLUME_PATTERN = /(\d+[.,]\d+)\s*(?:l\b|litres?\b)/i;
const NAME_UNITLESS_LITRE_PATTERN = /\b0[.,]\d{1,2}\b/;

/** The same volume-token question applied to label names (priority-1 source). */
const LABEL_VOLUME_PATTERN = NAME_EXPLICIT_VOLUME_PATTERN;

// ---------------------------------------------------------------------------
// Shared helpers (kept local — the adapter does not exist yet)
// ---------------------------------------------------------------------------

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pct(part: number, whole: number): string {
  if (whole === 0) return 'n/a';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/**
 * `short_description.html` → plain text: tags replaced by spaces (so
 * `<br>`-separated lines cannot fuse digits into `%` signs), then the HTML
 * entities the copy actually uses decoded (named French set + numeric
 * decimal/hex), then whitespace collapsed. Unknown entities decode to a
 * space — a missed entity can only lose a match, never invent one.
 */
function htmlToText(html: string): string {
  const stripped = html.replace(/<[^>]*>/g, ' ');
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    raquo: '»',
    laquo: '«',
    eacute: 'é',
    egrave: 'è',
    ecirc: 'ê',
    agrave: 'à',
    ccedil: 'ç',
    ucirc: 'û',
    ugrave: 'ù',
    ocirc: 'ô',
    icirc: 'î',
    hellip: '…',
    middot: '·',
    deg: '°',
    euro: '€',
    szlig: 'ß',
    auml: 'ä',
    ouml: 'ö',
    uuml: 'ü',
  };
  const decoded = stripped.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (ent, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return named[body.toLowerCase()] ?? ' ';
  });
  return decoded.replace(/\s+/g, ' ').trim();
}

/**
 * One GraphQL read call with the sweep's bounded retry: on fetch failure,
 * HTTP 429/5xx, non-JSON body, or a 200-with-errors payload, wait once for
 * RETRY_WAIT_MS and retry; a second failure is returned as an error for the
 * caller to record. Never loops unbounded — at most two attempts per call.
 */
async function graphqlPost(
  query: string,
  label: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      console.log(`[lmdw-sweep] ${label}: first attempt failed — retrying once after ${RETRY_WAIT_MS / 1000}s`);
      await sleep(RETRY_WAIT_MS);
    }
    let response: Response;
    try {
      response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
    } catch (err) {
      if (attempt === 2) return { ok: false, error: `${label}: fetch failed: ${errorOf(err)}` };
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 2) {
        return { ok: false, error: `${label}: HTTP ${response.status} ${response.statusText} on both attempts` };
      }
      continue;
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      if (attempt === 2) return { ok: false, error: `${label}: non-JSON body: ${errorOf(err)}` };
      continue;
    }
    if (typeof payload !== 'object' || payload === null) {
      if (attempt === 2) return { ok: false, error: `${label}: JSON payload is not an object` };
      continue;
    }
    const record = payload as { data?: unknown; errors?: unknown };
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      const message = (record.errors[0] as { message?: unknown }).message;
      const first = typeof message === 'string' ? message : 'unknown GraphQL error';
      if (attempt === 2) return { ok: false, error: `${label}: GraphQL errors: ${first}` };
      continue;
    }
    if (typeof record.data !== 'object' || record.data === null) {
      if (attempt === 2) return { ok: false, error: `${label}: GraphQL payload has no data object` };
      continue;
    }
    return { ok: true, data: record.data as Record<string, unknown> };
  }
  return { ok: false, error: `${label}: unreachable retry state` };
}

// ---------------------------------------------------------------------------
// Walk row shape + extraction
// ---------------------------------------------------------------------------

interface WalkRow {
  readonly sku: string;
  readonly name: string;
  readonly urlKey: string | null;
  readonly stockStatus: string;
  readonly shortDescriptionHtml: string;
  readonly m3Families: readonly string[];
  readonly m3Divisions: readonly string[];
  readonly giftBoxes: readonly string[];
  readonly currency: string | null;
  readonly priceValue: number | null;
  readonly labelNames: readonly string[];
}

function stringListOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const label = (entry as { label?: unknown }).label;
    if (typeof label === 'string' && label.trim() !== '') out.push(label.trim());
  }
  return out;
}

function parseWalkItem(item: unknown): WalkRow | null {
  if (typeof item !== 'object' || item === null) return null;
  const row = item as Record<string, unknown>;
  const sku = typeof row.sku === 'string' ? row.sku.trim() : '';
  if (sku === '') return null;
  const priceRange = row.price_range as { minimum_price?: { final_price?: { currency?: unknown; value?: unknown } } } | undefined;
  const finalPrice = priceRange?.minimum_price?.final_price;
  return {
    sku,
    name: typeof row.name === 'string' ? row.name : '',
    urlKey: typeof row.url_key === 'string' && row.url_key !== '' ? row.url_key : null,
    stockStatus: typeof row.stock_status === 'string' ? row.stock_status : '(missing)',
    shortDescriptionHtml: typeof row.short_description === 'object' && row.short_description !== null
      && typeof (row.short_description as { html?: unknown }).html === 'string'
      ? (row.short_description as { html: string }).html
      : '',
    m3Families: stringListOf(row.m3_family),
    m3Divisions: stringListOf(row.m3_division),
    giftBoxes: stringListOf(row.gift_box),
    currency: typeof finalPrice?.currency === 'string' ? finalPrice.currency : null,
    priceValue: typeof finalPrice?.value === 'number' && Number.isFinite(finalPrice.value) ? finalPrice.value : null,
    labelNames: stringListOf(row.lmdw_label),
  };
}

/**
 * The per-page products query. Field selection per the spike evidence:
 * `m3_*`/`gift_box` need `{ label }` subselections ([LmdwProductSelect]);
 * `lmdw_label` needs the mandatory `mode: PRODUCT` argument ([LmdwLabel]);
 * `custom_attributesV2` deliberately absent (internal server errors).
 */
function walkPageQuery(page: number): string {
  return `{
  products(filter: { category_id: { eq: "${NATURE_CATEGORY_ID}" } }, pageSize: ${PAGE_SIZE}, currentPage: ${page}) {
    total_count
    page_info { page_size current_page total_pages }
    items {
      sku
      name
      url_key
      stock_status
      short_description { html }
      m3_family { label }
      m3_division { label }
      gift_box { label }
      price_range { minimum_price { final_price { currency value } } }
      lmdw_label(mode: PRODUCT) { id name priority }
    }
  }
}`;
}

interface PageInfo {
  readonly totalCount: number;
  readonly totalPages: number | null;
}

function parsePageInfo(data: Record<string, unknown>): PageInfo | null {
  const products = data.products as { total_count?: unknown; page_info?: { total_pages?: unknown } } | undefined;
  if (typeof products !== 'object' || products === null) return null;
  const totalCount = products.total_count;
  if (typeof totalCount !== 'number' || !Number.isFinite(totalCount)) return null;
  const totalPages = products.page_info?.total_pages;
  return {
    totalCount,
    totalPages: typeof totalPages === 'number' && Number.isFinite(totalPages) ? totalPages : null,
  };
}

// ---------------------------------------------------------------------------
// Phase 0 — introspection (field lists for the notes; LmdwLabel subselection)
// ---------------------------------------------------------------------------

interface IntrospectionResult {
  readonly productInterfaceFields: readonly string[];
  readonly lmdwLabelFields: readonly string[];
}

async function introspectTypes(): Promise<IntrospectionResult> {
  const productResult = await graphqlPost(
    '{ __type(name: "ProductInterface") { fields { name } } }',
    'introspect ProductInterface',
  );
  const labelResult = await graphqlPost(
    '{ __type(name: "LmdwLabel") { fields { name type { name kind } } } }',
    'introspect LmdwLabel',
  );
  const fieldNamesOf = (result: { ok: true; data: Record<string, unknown> } | { ok: false; error: string }): string[] => {
    if (!result.ok) return [];
    const type = result.data.__type as { fields?: Array<{ name?: unknown }> } | null;
    if (type === null || !Array.isArray(type.fields)) return [];
    return type.fields
      .map((f) => (typeof f.name === 'string' ? f.name : ''))
      .filter((name) => name !== '');
  };
  return {
    productInterfaceFields: fieldNamesOf(productResult),
    lmdwLabelFields: fieldNamesOf(labelResult),
  };
}

// ---------------------------------------------------------------------------
// Phase 1 — the deduped catalog walk
// ---------------------------------------------------------------------------

interface WalkResult {
  readonly totalCount: number | null;
  readonly totalPagesDeclared: number | null;
  readonly pagesFetched: number;
  readonly pagesOk: number;
  readonly pageFailures: readonly string[];
  /** total_count vs delivered-rows deltas — drift warnings, not failures (mydrink X-WP-Total precedent). */
  readonly driftWarnings: readonly string[];
  readonly rawRows: number;
  readonly rows: readonly WalkRow[];
  readonly duplicateSkus: number;
  readonly rowsWithoutSku: number;
}

async function walkCatalog(): Promise<WalkResult> {
  const bySku = new Map<string, WalkRow>();
  const pageFailures: string[] = [];
  const driftWarnings: string[] = [];
  let totalCount: number | null = null;
  let totalPagesDeclared: number | null = null;
  let pagesFetched = 0;
  let pagesOk = 0;
  let rawRows = 0;
  let duplicateSkus = 0;
  let rowsWithoutSku = 0;

  for (let page = 1; page <= PAGE_HARD_CAP; page++) {
    if (totalCount !== null && bySku.size >= totalCount) break;
    if (totalPagesDeclared !== null && page > totalPagesDeclared) break;
    if (page > 1) await sleep(PACE_MS);

    pagesFetched++;
    const result = await graphqlPost(walkPageQuery(page), `walk page ${page}`);
    if (!result.ok) {
      pageFailures.push(result.error);
      if (totalCount === null) {
        pageFailures.push('walk aborted: page 1 never succeeded, total_count unknown');
        break;
      }
      continue;
    }

    const info = parsePageInfo(result.data);
    if (info === null) {
      pageFailures.push(`walk page ${page}: no products/total_count in payload`);
      continue;
    }
    if (totalCount === null) {
      totalCount = info.totalCount;
      totalPagesDeclared = info.totalPages;
      console.log(
        `[lmdw-sweep] total_count=${info.totalCount}` +
          `, pages declared=${info.totalPages ?? 'unknown'}` +
          `, hard cap=${PAGE_HARD_CAP} pages`,
      );
    }

    const products = result.data.products as { items?: unknown } | undefined;
    const items = Array.isArray(products?.items) ? products.items : [];
    if (items.length === 0) {
      // A zero-item page before the expected end means pagination drift —
      // stop here rather than spin.
      break;
    }
    pagesOk++;
    rawRows += items.length;

    for (const item of items) {
      const row = parseWalkItem(item);
      if (row === null) {
        rowsWithoutSku++;
        continue;
      }
      if (bySku.has(row.sku)) {
        duplicateSkus++;
        continue;
      }
      bySku.set(row.sku, row);
    }

    console.log(
      `[lmdw-sweep] page ${page}: ${items.length} rows, distinct skus ${bySku.size}` +
        `${totalCount !== null ? `/${totalCount}` : ''}, dupes so far ${duplicateSkus}`,
    );
  }

  if (totalCount !== null && bySku.size < totalCount) {
    // The gateway's total_count drifted from what pagination actually
    // delivered (rows added/removed mid-walk or counted-but-filtered).
    // Every declared page was still fetched — a warning, not a failure.
    driftWarnings.push(
      `delivered ${bySku.size} distinct skus of total_count ${totalCount} ` +
        `(delta ${totalCount - bySku.size}; all ${pagesOk} declared pages fetched ok)`,
    );
  }

  return {
    totalCount,
    totalPagesDeclared,
    pagesFetched,
    pagesOk,
    pageFailures,
    driftWarnings,
    rawRows,
    rows: [...bySku.values()],
    duplicateSkus,
    rowsWithoutSku,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — packaging category cross-reference (category 2841)
// ---------------------------------------------------------------------------

async function collectPackagingSkus(): Promise<{
  readonly totalCount: number | null;
  readonly skus: ReadonlySet<string>;
  readonly failures: readonly string[];
}> {
  const skus = new Set<string>();
  const failures: string[] = [];
  let totalCount: number | null = null;
  // The probe measured 76 rows; the category is small either way — a 3-page
  // bounded read is generous and stays far below any unbounded loop.
  for (let page = 1; page <= 3; page++) {
    if (totalCount !== null && skus.size >= totalCount) break;
    if (page > 1) await sleep(PACE_MS);
    const result = await graphqlPost(
      `{
  products(filter: { category_id: { eq: "${PACKAGING_CATEGORY_ID}" } }, pageSize: ${PAGE_SIZE}, currentPage: ${page}) {
    total_count
    items { sku }
  }
}`,
      `packaging page ${page}`,
    );
    if (!result.ok) {
      failures.push(result.error);
      break;
    }
    const products = result.data.products as { total_count?: unknown; items?: unknown } | undefined;
    if (typeof products?.total_count === 'number' && Number.isFinite(products.total_count)) {
      totalCount = products.total_count;
    }
    const items = Array.isArray(products?.items) ? products.items : [];
    if (items.length === 0) break;
    for (const item of items) {
      const sku = (item as { sku?: unknown }).sku;
      if (typeof sku === 'string' && sku.trim() !== '') skus.add(sku.trim());
    }
  }
  return { totalCount, skus, failures };
}

// ---------------------------------------------------------------------------
// Phase 3 — product-page sampling (volume hunt, priority 4)
// ---------------------------------------------------------------------------

interface PageSampleOutcome {
  readonly sku: string;
  readonly urlKey: string;
  readonly host: string | null;
  readonly httpStatus: number | null;
  readonly volume: string | null;
  readonly volumeSource: string | null;
  readonly strength: string | null;
}

/**
 * Volume extraction from a product page's HTML. The pages embed a state
 * payload with `"volume":"0.7"` (litres, dot decimal) and render
 * `data-lmdw-el="volume">70cL`; the i18n dictionary also contains
 * `"volume":"Volume : "` — so the JSON form must require a numeric value.
 */
function extractVolumeFromPage(html: string): { volume: string; source: string } | null {
  const stateMatch = /"volume"\s*:\s*"(\d+(?:\.\d+)?)"[,}]/.exec(html)
    ?? /"volume"\s*:\s*(\d+(?:\.\d+)?)[,}\s]/.exec(html);
  if (stateMatch !== null) {
    return { volume: `${stateMatch[1]} L`, source: 'embedded state JSON "volume"' };
  }
  const markupMatch = /data-lmdw-el="volume"[^>]*>([^<]+)</.exec(html);
  if (markupMatch !== null) {
    const unitMatch = /(\d+(?:[.,]\d+)?)\s*(cl|ml|l)\b/i.exec(markupMatch[1]);
    if (unitMatch !== null) {
      return { volume: `${unitMatch[1]} ${unitMatch[2].toUpperCase()}`, source: 'data-lmdw-el="volume" markup' };
    }
  }
  return null;
}

function extractStrengthFromPage(html: string): string | null {
  const match = /"strength"\s*:\s*(\d+(?:\.\d+)?)/.exec(html);
  return match === null ? null : match[1];
}

async function sampleProductPages(rows: readonly WalkRow[]): Promise<PageSampleOutcome[]> {
  const outcomes: PageSampleOutcome[] = [];
  const count = Math.min(PAGE_SAMPLE_LIMIT, rows.length);
  for (let i = 0; i < count; i++) {
    const row = rows[Math.floor((i * rows.length) / count)];
    if (row.urlKey === null) {
      outcomes.push({ sku: row.sku, urlKey: '(no url_key)', host: null, httpStatus: null, volume: null, volumeSource: null, strength: null });
      continue;
    }
    let recorded = false;
    for (const host of PRODUCT_PAGE_HOSTS) {
      if (outcomes.some((o) => o.sku === row.sku)) break;
      const url = `${host}/${row.urlKey}.html`;
      if (i > 0 || outcomes.length > 0) await sleep(PACE_MS);
      let response: Response;
      try {
        response = await fetch(url, { headers: { 'user-agent': PRODUCT_PAGE_USER_AGENT } });
      } catch (err) {
        console.log(`[lmdw-sweep] page sample ${url}: fetch failed: ${errorOf(err)}`);
        continue;
      }
      if (!response.ok) {
        console.log(`[lmdw-sweep] page sample ${url}: HTTP ${response.status}`);
        continue;
      }
      const html = await response.text();
      const volume = extractVolumeFromPage(html);
      const strength = extractStrengthFromPage(html);
      outcomes.push({
        sku: row.sku,
        urlKey: row.urlKey,
        host,
        httpStatus: response.status,
        volume: volume?.volume ?? null,
        volumeSource: volume?.source ?? null,
        strength,
      });
      recorded = true;
      break;
    }
    if (!recorded && !outcomes.some((o) => o.sku === row.sku)) {
      outcomes.push({ sku: row.sku, urlKey: row.urlKey, host: null, httpStatus: null, volume: null, volumeSource: null, strength: null });
    }
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface SpikeMeasures {
  readonly abvMatched: number;
  readonly abvRawUnguarded: number;
  readonly abvCommaDecimal: number;
  readonly abvIntegerDecimal: number;
  readonly abvDotDecimal: number;
  readonly abvValueCensus: ReadonlyMap<string, number>;
  readonly abvUnmatchedSamples: readonly string[];
  readonly shortDescriptionEmpty: number;
  readonly labelVolumeRows: number;
  readonly labelSamples: ReadonlyArray<{ sku: string; labels: string }>;
  readonly nameExplicitVolume: number;
  readonly nameLitreVolume: number;
  readonly nameUnitlessVolume: number;
  readonly nameAnyVolume: number;
  readonly nameVolumeSamples: readonly string[];
  readonly nameNoVolumeSamples: readonly string[];
  readonly familyCensus: ReadonlyMap<string, number>;
  readonly divisionCensus: ReadonlyMap<string, number>;
  readonly giftBoxCensus: ReadonlyMap<string, number>;
  readonly stockStatusCensus: ReadonlyMap<string, number>;
  readonly currencyCensus: ReadonlyMap<string, number>;
  readonly rowsWithoutPrice: number;
}

function measureSpike(walk: WalkResult): SpikeMeasures {
  const rows = walk.rows;
  const abvValueCensus = new Map<string, number>();
  const abvUnmatchedSamples: string[] = [];
  const nameVolumeSamples: string[] = [];
  const nameNoVolumeSamples: string[] = [];
  const familyCensus = new Map<string, number>();
  const divisionCensus = new Map<string, number>();
  const giftBoxCensus = new Map<string, number>();
  const stockStatusCensus = new Map<string, number>();
  const currencyCensus = new Map<string, number>();
  const labelSamples = rows.slice(0, LABEL_SAMPLE_LIMIT).map((row) => ({
    sku: row.sku,
    labels: row.labelNames.length > 0 ? row.labelNames.join(' | ') : '(none)',
  }));

  let abvMatched = 0;
  let abvRawUnguarded = 0;
  let abvCommaDecimal = 0;
  let abvIntegerDecimal = 0;
  let abvDotDecimal = 0;
  let shortDescriptionEmpty = 0;
  let labelVolumeRows = 0;
  let nameExplicitVolume = 0;
  let nameLitreVolume = 0;
  let nameUnitlessVolume = 0;
  let nameAnyVolume = 0;
  let rowsWithoutPrice = 0;

  for (const row of rows) {
    // (a) ABV share over the tag-stripped, entity-unescaped description text.
    if (row.shortDescriptionHtml.trim() === '') shortDescriptionEmpty++;
    const text = htmlToText(row.shortDescriptionHtml);
    ABV_PATTERN.lastIndex = 0;
    const match = ABV_PATTERN.exec(text);
    ABV_RAW_PATTERN.lastIndex = 0;
    if (ABV_RAW_PATTERN.exec(text) !== null) abvRawUnguarded++;
    if (match === null) {
      if (abvUnmatchedSamples.length < SAMPLE_LIMIT && text !== '') abvUnmatchedSamples.push(`${row.sku}: ${text.slice(0, 140)}`);
    } else {
      abvMatched++;
      const token = match[1];
      if (token.includes(',')) abvCommaDecimal++;
      else if (token.includes('.')) abvDotDecimal++;
      else abvIntegerDecimal++;
      const value = token.replace(',', '.');
      abvValueCensus.set(value, (abvValueCensus.get(value) ?? 0) + 1);
    }

    // (b-1) volume tokens in label names (priority 1).
    if (row.labelNames.some((label) => LABEL_VOLUME_PATTERN.test(label))) labelVolumeRows++;

    // (b-2) volume in `name` (priority 2), weakest form first.
    const explicit = NAME_EXPLICIT_VOLUME_PATTERN.test(row.name);
    const litre = NAME_LITRE_VOLUME_PATTERN.test(row.name);
    const unitless = NAME_UNITLESS_LITRE_PATTERN.test(row.name);
    if (explicit) nameExplicitVolume++;
    if (litre) nameLitreVolume++;
    if (unitless) nameUnitlessVolume++;
    if (explicit || litre || unitless) {
      nameAnyVolume++;
      if (nameVolumeSamples.length < SAMPLE_LIMIT) nameVolumeSamples.push(`${row.sku}: ${row.name}`);
    } else if (nameNoVolumeSamples.length < SAMPLE_LIMIT) {
      nameNoVolumeSamples.push(`${row.sku}: ${row.name}`);
    }

    // (c) m3 censuses.
    for (const family of row.m3Families) familyCensus.set(family, (familyCensus.get(family) ?? 0) + 1);
    for (const division of row.m3Divisions) divisionCensus.set(division, (divisionCensus.get(division) ?? 0) + 1);
    for (const giftBox of row.giftBoxes) giftBoxCensus.set(giftBox, (giftBoxCensus.get(giftBox) ?? 0) + 1);
    stockStatusCensus.set(row.stockStatus, (stockStatusCensus.get(row.stockStatus) ?? 0) + 1);

    // (d) currency check.
    currencyCensus.set(row.currency ?? '(missing)', (currencyCensus.get(row.currency ?? '(missing)') ?? 0) + 1);
    if (row.currency === null || row.priceValue === null) rowsWithoutPrice++;
  }

  return {
    abvMatched,
    abvRawUnguarded,
    abvCommaDecimal,
    abvDotDecimal,
    abvIntegerDecimal,
    abvValueCensus,
    abvUnmatchedSamples,
    shortDescriptionEmpty,
    labelVolumeRows,
    labelSamples,
    nameExplicitVolume,
    nameLitreVolume,
    nameUnitlessVolume,
    nameAnyVolume,
    nameVolumeSamples,
    nameNoVolumeSamples,
    familyCensus,
    divisionCensus,
    giftBoxCensus,
    stockStatusCensus,
    currencyCensus,
    rowsWithoutPrice,
  };
}

async function main(): Promise<void> {
  console.log('[lmdw-sweep] lmdw (gateway.prod2.whisky.fr) catalog sweep + ABV/volume spike — read-only GraphQL/GETs');
  console.log(`[lmdw-sweep] user-agent for page GETs: ${PRODUCT_PAGE_USER_AGENT}`);

  // Phase 0 — introspection.
  const intro = await introspectTypes();
  console.log(
    `[lmdw-sweep] ProductInterface fields: ${intro.productInterfaceFields.length}` +
      `${intro.productInterfaceFields.length === 0 ? ' (introspection failed)' : ''}`,
  );
  const volumeishFields = intro.productInterfaceFields.filter((f) => /vol|capac|size|content|format/i.test(f));
  console.log(`[lmdw-sweep] volume-ish field names on ProductInterface: ${volumeishFields.length === 0 ? '(none)' : volumeishFields.join(', ')}`);
  console.log(`[lmdw-sweep] LmdwLabel fields: ${intro.lmdwLabelFields.length > 0 ? intro.lmdwLabelFields.join(', ') : '(introspection failed)'}`);

  // Phase 1 — the walk.
  const walk = await walkCatalog();

  // Phase 2/3 + measures (only meaningful on a non-empty walk, but always computed).
  await sleep(PACE_MS);
  const packaging = await collectPackagingSkus();
  const measures = measureSpike(walk);
  const walkSkus = new Set(walk.rows.map((row) => row.sku));
  let packagingOverlap = 0;
  for (const sku of packaging.skus) {
    if (walkSkus.has(sku)) packagingOverlap++;
  }
  const pageSamples = await sampleProductPages(walk.rows);

  printReport(walk, measures, intro, packaging, packagingOverlap, pageSamples);
}

function printReport(
  walk: WalkResult,
  m: SpikeMeasures,
  intro: IntrospectionResult,
  packaging: Awaited<ReturnType<typeof collectPackagingSkus>>,
  packagingOverlap: number,
  pageSamples: readonly PageSampleOutcome[],
): void {
  const rows = walk.rows;
  console.log('');
  console.log('=== lmdw (gateway.prod2.whisky.fr) full-catalog sweep + ABV/volume spike (pre-onboarding audit) ===');
  console.log(`gateway: ${GRAPHQL_ENDPOINT} (pageSize=${PAGE_SIZE}, sequential, category_id=${NATURE_CATEGORY_ID}, read-only)`);
  console.log('');

  console.log('-- 0. Introspection --');
  const volumeishFields = intro.productInterfaceFields.filter((f) => /vol|capac|size|content|format/i.test(f));
  console.log(`ProductInterface fields: ${intro.productInterfaceFields.length} (volume-ish names: ${volumeishFields.join(', ') || 'none'})`);
  console.log(`LmdwLabel fields: ${intro.lmdwLabelFields.join(', ') || '(unavailable)'}`);
  console.log('');

  console.log('-- 1. Catalog walk --');
  console.log(
    `total_count: ${walk.totalCount ?? '(unknown)'}` +
      ` | pages declared: ${walk.totalPagesDeclared ?? '(unknown)'}` +
      ` | pages fetched ok: ${walk.pagesOk}/${walk.pagesFetched}` +
      ` | page failures: ${walk.pageFailures.length}` +
      ` | hard cap: ${PAGE_HARD_CAP}`,
  );
  console.log(`raw rows seen: ${walk.rawRows} | distinct skus kept: ${rows.length} | duplicate-sku rows dropped: ${walk.duplicateSkus} | rows without sku: ${walk.rowsWithoutSku}`);
  for (const warning of walk.driftWarnings) {
    console.log(`WARNING: total_count drift — ${warning} (sweep proceeds; the walk covered every declared page)`);
  }
  for (const failure of walk.pageFailures) {
    console.log(`walk failure: ${failure}`);
  }
  console.log('');

  // (a) ABV share — the hold-rule gate.
  console.log('-- 2. ABV share of short_description.html (French % patterns) --');
  console.log(`rows matching ${ABV_PATTERN}: ${m.abvMatched} of ${rows.length} (${pct(m.abvMatched, rows.length)})`);
  console.log(`unguarded cross-check ${ABV_RAW_PATTERN}: ${m.abvRawUnguarded} rows — delta ${m.abvRawUnguarded - m.abvMatched} are tail-of-larger-number artifacts (e.g. "100% agave" → "00%")`);
  console.log(`decimal split (guarded): comma ${m.abvCommaDecimal} | dot ${m.abvDotDecimal} | integer ${m.abvIntegerDecimal}`);
  console.log(`rows with an empty short_description: ${m.shortDescriptionEmpty} (${pct(m.shortDescriptionEmpty, rows.length)})`);
  const topValues = [...m.abvValueCensus.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`top matched values: ${topValues.map(([value, count]) => `${value}%×${count}`).join(', ')}`);
  for (const sample of m.abvUnmatchedSamples) {
    console.log(`  sample non-match: ${sample}`);
  }
  console.log('');

  // (b) Volume hunt, priority order — the 3.3 extraction decision input.
  console.log('-- 3. Volume hunt (design D5 priority order) --');
  console.log(`(1) lmdw_label — volume-token rows: ${m.labelVolumeRows} (${pct(m.labelVolumeRows, rows.length)}); ${LABEL_SAMPLE_LIMIT}-row sample:`);
  for (const sample of m.labelSamples) {
    console.log(`  ${sample.sku}: labels = ${sample.labels}`);
  }
  console.log('');
  console.log(`(2) name suffixes — explicit cl/ml: ${m.nameExplicitVolume} (${pct(m.nameExplicitVolume, rows.length)}) | litre decimal: ${m.nameLitreVolume} | unitless 0,x: ${m.nameUnitlessVolume} | any: ${m.nameAnyVolume} (${pct(m.nameAnyVolume, rows.length)})`);
  for (const sample of [...m.nameVolumeSamples, ...m.nameNoVolumeSamples].slice(0, SAMPLE_LIMIT * 2)) {
    console.log(`  sample name: ${sample}`);
  }
  console.log('');
  console.log(`(3) packaging category ${PACKAGING_CATEGORY_ID} — total_count: ${packaging.totalCount ?? '(unknown)'}, skus collected: ${packaging.skus.size}, overlap with walk: ${packagingOverlap} (${pct(packagingOverlap, rows.length)} of walk) — cross-reference only, not a per-row source`);
  for (const failure of packaging.failures) {
    console.log(`  packaging failure: ${failure}`);
  }
  console.log('');
  const pagesWithVolume = pageSamples.filter((sample) => sample.volume !== null);
  const pagesWithStrength = pageSamples.filter((sample) => sample.strength !== null);
  console.log(`(4) product pages — sampled: ${pageSamples.length}, volume extracted: ${pagesWithVolume.length} (${pct(pagesWithVolume.length, pageSamples.length)}), strength also present: ${pagesWithStrength.length}`);
  for (const sample of pageSamples) {
    console.log(
      `  ${sample.sku} ${sample.urlKey}` +
        ` → ${sample.host ?? '(all hosts failed)'}` +
        `${sample.httpStatus !== null ? ` HTTP ${sample.httpStatus}` : ''}` +
        `${sample.volume !== null ? ` volume=${sample.volume} (${sample.volumeSource})` : ' volume=MISS'}` +
        `${sample.strength !== null ? ` strength=${sample.strength}` : ''}`,
    );
  }
  console.log('');

  // (c) m3_family census — the FR mapper vocabulary input.
  console.log('-- 4. m3_family census (distinct labels) --');
  const families = [...m.familyCensus.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`distinct m3_family labels: ${families.length}`);
  for (const [family, count] of families.slice(0, TOP_TERMS_LIMIT)) {
    console.log(`  "${family}": ${count} rows (${pct(count, rows.length)})`);
  }
  console.log('');
  console.log('-- 4b. m3_division census (merch split) --');
  for (const [division, count] of [...m.divisionCensus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  "${division}": ${count} rows (${pct(count, rows.length)})`);
  }
  console.log('');

  // (d) Currency check.
  console.log('-- 5. Currency check (final_price.currency) --');
  const nonEur = [...m.currencyCensus.entries()].filter(([currency]) => currency !== 'EUR');
  console.log(`currencies: ${[...m.currencyCensus.entries()].sort((a, b) => b[1] - a[1]).map(([currency, count]) => `${currency}×${count}`).join(', ')}`);
  console.log(`non-EUR rows: ${nonEur.reduce((sum, [, count]) => sum + count, 0)} | rows without a parseable price: ${m.rowsWithoutPrice}`);
  console.log('');

  // (e) Anomalies.
  console.log('-- 6. Anomalies (gift_box / stock / non-liquide) --');
  for (const [giftBox, count] of [...m.giftBoxCensus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  gift_box "${giftBox}": ${count} rows (${pct(count, rows.length)})`);
  }
  for (const [status, count] of [...m.stockStatusCensus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  stock_status ${status}: ${count} rows (${pct(count, rows.length)})`);
  }
  const nonLiquide = [...m.divisionCensus.entries()].filter(([division]) => division.toLowerCase() !== 'liquide');
  console.log(`non-liquide divisions: ${nonLiquide.map(([division, count]) => `${division}×${count}`).join(', ') || '(none)'}`);
  console.log('');

  const ok = walk.pageFailures.length === 0 && rows.length > 0 && packaging.failures.length === 0;
  console.log(
    ok
      ? '=== sweep COMPLETE — numbers above are the pre-onboarding report ==='
      : '=== sweep INCOMPLETE — page/walk failures or an empty walk; do not trust the shares above ===',
  );
  if (!ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`[lmdw-sweep] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
