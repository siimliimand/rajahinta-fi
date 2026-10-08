#!/usr/bin/env node
/**
 * www.whisky.fr crawl probe — read-only (task 1.1 of
 * onboard-lmdw-crawl-merchant, design D1: the URL-source decision).
 *
 * The archived change `onboard-shopify-lmdw-merchants` NO-GO'd a GraphQL
 * products adapter (feed-side ABV 10.3 %, volume absent) while the product
 * pages' embedded state JSON carries `"volume"` + `"strength"` on 10/10
 * spike pages. This probe measures, for real, whether LMDW onboards through
 * the proven `SitemapCrawlFeedAdapter` pattern and what the page normalizer
 * (design D2) and the FR category vocabulary (design D3) are built on:
 *
 *   1. Sitemap discovery — robots.txt `Sitemap:` directives plus the bare
 *      `/sitemap.xml`, walked through sitemap indexes (bounded), every
 *      urlset parsed with the production parser (`parseSitemapXml`, so the
 *      CDATA/namespace tolerances are the ones the adapter will get).
 *      Product-shaped URLs (`https://www.whisky.fr/<url_key>.html`,
 *      single path segment) are counted with lastmod coverage.
 *   2. GraphQL url_key cross-walk — `products(filter: { category_id:
 *      { eq: "3" } })` → `sku` + `url_key` ONLY (URL-list use; the
 *      spike's NO-GO on reading product data from GraphQL stands). It
 *      measures sitemap-vs-catalog coverage (recall/precision of the
 *      product-URL predicate) and doubles as the D1 fallback URL source.
 *   3. Page sampling — ~300 URLs by even stride over the product-shaped
 *      sitemap entries (or the url_key set if the sitemap has none),
 *      sequential, ≥ 1.1 s spacing, 20 s timeout, one bounded retry, every
 *      failure collected. Per page:
 *        - state-JSON extraction — numeric `"volume"` (litres) and
 *          `"strength"` (ABV %), guarded-parsed (comma/dot decimals,
 *          plausibility windows litres < 100 / abv ≤ 100), the value form
 *          census (string vs number, comma vs dot), the carrying script
 *          blob (tag attributes) and, when the blob parses as JSON, the
 *          exact key path — the facts 3.1's normalizer is built on.
 *          Non-numeric `"volume":"Volume : "` i18n-dictionary hits are
 *          counted separately so the guard is measured, not assumed.
 *        - JSON-LD census — `@type Product` (category, brand), `gtin13`/
 *          `gtin`/`gtin8` (digit shapes + GS1 check digit for 13-digit
 *          values), microdata `itemprop="gtin…"` (case-insensitive, the
 *          PR #107 rule), `BreadcrumbList` terms, offers `priceCurrency`/
 *          `price` parseability (EUR sanity).
 *        - state-JSON category-ish keys as a fallback taxonomy signal.
 *   4. Decision suggestion — URL-source (pure sitemap vs GraphQL-seeded)
 *      from measured coverage, and a go/no-go suggestion for task 3.1
 *      from extraction + category-signal density. The operator records
 *      the final decision in the change notes.
 *
 * Read-only: GET requests to www.whisky.fr and read GraphQL `products`
 * queries — nothing else. No writes, no database, no watermark rows.
 *
 * Usage (tsx from the data-platform workspace, per scripts/seed-d1.ts
 * convention — the path is relative to the package cwd):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/lmdw-crawl-probe.ts
 *
 * Exit codes: 0 complete, 1 incomplete (enumeration failed or > 10 % page
 * failures — shares untrustworthy), 2 usage error.
 */

import { CRAWLER_USER_AGENT } from '../packages/data-acquisition/src/crawl/crawl-walker';
import { parseSitemapXml } from '../packages/data-acquisition/src/crawl/sitemap.parse';

/** The storefront host — product pages are `https://www.whisky.fr/<url_key>.html`. */
const STOREFRONT = 'https://www.whisky.fr';

/** The LMDW Magento GraphQL gateway — URL-source enumeration only. */
const GRAPHQL_ENDPOINT = 'https://gateway.prod2.whisky.fr/graphql';

/**
 * Sample size (task text: ~300 pages). Optional first CLI arg overrides it,
 * hard-capped so a typo cannot turn the probe into a crawl.
 */
const SAMPLE_DEFAULT = 300;
const SAMPLE_HARD_CAP = 500;

/** ≥ 1 s same-host spacing floor; +100 ms so the floor is never shaved by timers. */
const PAGE_PACE_MS = 1_100;

/** GraphQL walk pacing — the lmdw-catalog-sweep's measured-polite 3 s. */
const GRAPHQL_PACE_MS = 3_000;

/** Per-fetch timeout — a hung fetch is a collected failure, not a stalled run. */
const FETCH_TIMEOUT_MS = 20_000;

/** Single bounded retry (429/5xx/network/non-JSON) before recording a failure. */
const RETRY_WAIT_MS = 30_000;

/** Bounded GraphQL fallback walk — 75 pages × 100 = 7,500 url_keys max. */
const GRAPHQL_PAGE_HARD_CAP = 75;
const GRAPHQL_PAGE_SIZE = 100;

/** Sitemap-discovery bounds: children per index, recursion depth, total fetches. */
const SITEMAP_CHILDREN_CAP = 50;
const SITEMAP_DEPTH_CAP = 2;
const SITEMAP_FETCH_CAP = 60;

/** The product-URL shape a whisky.fr sitemap predicate would use (design D1). */
const PRODUCT_URL_PATTERN = /^https:\/\/www\.whisky\.fr\/[^/?#]+\.html$/;

/** The Nature de produit branch id — the only GraphQL filter legal here. */
const NATURE_CATEGORY_ID = '3';

/** Census/report rows printed per list — keeps the report readable. */
const TOP_TERMS_LIMIT = 40;
const SAMPLE_LIMIT = 5;

// ---------------------------------------------------------------------------
// Shared helpers
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * One GET under the crawler UA with the sweep's bounded retry: one retry
 * after RETRY_WAIT_MS on network error / 429 / 5xx, then a collected
 * error. Timeout per fetch via AbortSignal — a hung page costs one page,
 * never the run.
 */
async function politeGet(
  url: string,
  label: string,
): Promise<{ ok: true; status: number; body: string } | { ok: false; error: string }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      console.log(`[lmdw-probe] ${label}: retrying once after ${RETRY_WAIT_MS / 1000}s`);
      await sleep(RETRY_WAIT_MS);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'user-agent': CRAWLER_USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
    let body: string;
    try {
      body = await response.text();
    } catch (err) {
      if (attempt === 2) return { ok: false, error: `${label}: body read failed: ${errorOf(err)}` };
      continue;
    }
    return { ok: true, status: response.status, body };
  }
  return { ok: false, error: `${label}: unreachable retry state` };
}

/**
 * One GraphQL READ call (products enumeration only) with the same bounded
 * retry discipline as the sweep's graphqlPost.
 */
async function graphqlRead(
  query: string,
  label: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      console.log(`[lmdw-probe] ${label}: retrying once after ${RETRY_WAIT_MS / 1000}s`);
      await sleep(RETRY_WAIT_MS);
    }
    let response: Response;
    try {
      response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
      if (attempt === 2) return { ok: false, error: `${label}: payload has no data object` };
      continue;
    }
    return { ok: true, data: record.data as Record<string, unknown> };
  }
  return { ok: false, error: `${label}: unreachable retry state` };
}

// ---------------------------------------------------------------------------
// Phase 1 — sitemap discovery (robots.txt directives → indexes → urlsets)
// ---------------------------------------------------------------------------

interface SitemapDocumentOutcome {
  readonly url: string;
  readonly kind: 'urlset' | 'index' | 'unusable';
  readonly httpStatus: number | null;
  readonly entries: readonly { loc: string; lastmod: string | null }[];
  readonly note: string;
}

interface SitemapDiscovery {
  readonly robotsSitemapDirectives: readonly string[];
  readonly documents: readonly SitemapDocumentOutcome[];
  readonly fetchErrors: readonly string[];
  /** Unique locs over every parsed urlset, in first-seen order. */
  readonly allLocs: readonly string[];
  readonly locsWithLastmod: number;
}

/** `Sitemap:` directives from robots.txt — verbatim URL values, case-insensitive key. */
function parseRobotsSitemaps(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)\s*$/i.exec(line);
    if (match !== null) out.push(match[1]);
  }
  return out;
}

/** `<loc>` children of a `<sitemapindex>` document (namespace-tolerant, bounded). */
function parseSitemapIndexLocs(xml: string): string[] {
  const locs: string[] = [];
  for (const block of xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap\s*>/gi)) {
    const match = /<(?:[A-Za-z_][-\w.-]*:)?loc\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][-\w.-]*:)?loc\s*>/i.exec(block[1]);
    if (match === null) continue;
    const loc = match[1].replace(/<!\[CDATA\[([\s\S]*)\]\]>/, '$1').trim();
    if (loc !== '') locs.push(loc);
    if (locs.length >= SITEMAP_CHILDREN_CAP) break;
  }
  return locs;
}

async function discoverSitemaps(): Promise<SitemapDiscovery> {
  const documents: SitemapDocumentOutcome[] = [];
  const fetchErrors: string[] = [];
  const robotsSitemapDirectives: string[] = [];

  const robots = await politeGet(`${STOREFRONT}/robots.txt`, 'robots.txt');
  if (robots.ok) {
    for (const directive of parseRobotsSitemaps(robots.body)) robotsSitemapDirectives.push(directive);
  } else {
    fetchErrors.push(robots.error);
  }

  // robots directives + the bare /sitemap.xml, deduped, discovery order kept.
  const candidates = [...robotsSitemapDirectives, `${STOREFRONT}/sitemap.xml`].filter(
    (url, i, arr) => arr.indexOf(url) === i,
  );

  const queue: { url: string; depth: number }[] = candidates.map((url) => ({ url, depth: 0 }));
  const seen = new Set<string>(candidates);
  const allLocs: string[] = [];
  const seenLocs = new Set<string>();
  let locsWithLastmod = 0;
  let sitemapFetches = 0;

  while (queue.length > 0 && sitemapFetches < SITEMAP_FETCH_CAP) {
    const { url, depth } = queue.shift()!;
    sitemapFetches++;
    if (sitemapFetches > 1) await sleep(PAGE_PACE_MS);
    const result = await politeGet(url, `sitemap ${url}`);
    if (!result.ok) {
      fetchErrors.push(result.error);
      documents.push({ url, kind: 'unusable', httpStatus: null, entries: [], note: result.error });
      continue;
    }
    const xml = result.body;
    if (/<sitemapindex[\s>]/i.test(xml)) {
      const children = parseSitemapIndexLocs(xml).filter((child) => !seen.has(child));
      documents.push({
        url,
        kind: 'index',
        httpStatus: result.status,
        entries: [],
        note: `index with ${children.length} child sitemaps (cap ${SITEMAP_CHILDREN_CAP})`,
      });
      if (depth < SITEMAP_DEPTH_CAP) {
        for (const child of children) {
          seen.add(child);
          queue.push({ url: child, depth: depth + 1 });
        }
      }
      continue;
    }
    const parsed = parseSitemapXml(xml);
    if (parsed.error !== null) {
      const note = `HTTP ${result.status}, ${xml.length} bytes — ${parsed.error}`;
      documents.push({ url, kind: 'unusable', httpStatus: result.status, entries: [], note });
      continue;
    }
    for (const entry of parsed.entries) {
      if (!seenLocs.has(entry.loc)) {
        seenLocs.add(entry.loc);
        allLocs.push(entry.loc);
      }
      if (entry.lastmod !== null) locsWithLastmod++;
    }
    documents.push({
      url,
      kind: 'urlset',
      httpStatus: result.status,
      entries: parsed.entries,
      note: `${parsed.entries.length} entries`,
    });
  }

  return { robotsSitemapDirectives, documents, fetchErrors, allLocs, locsWithLastmod };
}

// ---------------------------------------------------------------------------
// Phase 2 — GraphQL url_key cross-walk (URL-source use ONLY)
// ---------------------------------------------------------------------------

interface UrlKeyWalk {
  readonly totalCount: number | null;
  readonly pagesFetched: number;
  readonly pagesOk: number;
  readonly failures: readonly string[];
  /** sku → url_key, deduped by sku (the spike's dedupe rule). */
  readonly urlKeys: ReadonlyMap<string, string>;
  readonly duplicateSkus: number;
  readonly rowsWithoutUrlKey: number;
}

async function walkUrlKeys(): Promise<UrlKeyWalk> {
  const urlKeys = new Map<string, string>();
  const failures: string[] = [];
  let totalCount: number | null = null;
  let pagesFetched = 0;
  let pagesOk = 0;
  let duplicateSkus = 0;
  let rowsWithoutUrlKey = 0;

  for (let page = 1; page <= GRAPHQL_PAGE_HARD_CAP; page++) {
    if (totalCount !== null && urlKeys.size >= totalCount) break;
    if (page > 1) await sleep(GRAPHQL_PACE_MS);
    pagesFetched++;
    const result = await graphqlRead(
      `{
  products(filter: { category_id: { eq: "${NATURE_CATEGORY_ID}" } }, pageSize: ${GRAPHQL_PAGE_SIZE}, currentPage: ${page}) {
    total_count
    items { sku url_key }
  }
}`,
      `url_key walk page ${page}`,
    );
    if (!result.ok) {
      failures.push(result.error);
      if (totalCount === null) failures.push('walk aborted: page 1 never succeeded');
      break;
    }
    const products = result.data.products as { total_count?: unknown; items?: unknown } | undefined;
    if (typeof products?.total_count === 'number' && Number.isFinite(products.total_count)) {
      totalCount = products.total_count;
      if (page === 1) {
        console.log(
          `[lmdw-probe] url_key walk: total_count=${totalCount}, hard cap=${GRAPHQL_PAGE_HARD_CAP} pages`,
        );
      }
    }
    const items = Array.isArray(products?.items) ? products.items : [];
    if (items.length === 0) break;
    pagesOk++;
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const row = item as { sku?: unknown; url_key?: unknown };
      const sku = typeof row.sku === 'string' ? row.sku.trim() : '';
      const urlKey = typeof row.url_key === 'string' && row.url_key !== '' ? row.url_key.trim() : '';
      if (sku === '') continue;
      if (urlKeys.has(sku)) {
        duplicateSkus++;
        continue;
      }
      if (urlKey === '') {
        rowsWithoutUrlKey++;
        continue;
      }
      urlKeys.set(sku, urlKey);
    }
    if (totalCount !== null && urlKeys.size >= totalCount) break;
  }

  return { totalCount, pagesFetched, pagesOk, failures, urlKeys, duplicateSkus, rowsWithoutUrlKey };
}

// ---------------------------------------------------------------------------
// Phase 3 helpers — guarded parsing (the design D2 windows)
// ---------------------------------------------------------------------------

/**
 * Comma/dot decimal → number, else null. Empty/whitespace and multi-dot
 * forms fail — the normalizer's guarded-parse behavior, measured here.
 */
function parseDecimal(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Numeric value shape from an embedded state JSON, as the sweep saw it:
 * `"volume":"0.7"` (string) or `"strength":45` (bare number). Quoted
 * comma decimals (`"0,7"`) are tolerated by the guard. The i18n
 * dictionary's `"volume":"Volume : "` must fail this — non-numeric
 * values are counted separately by the caller.
 */
function numericStateValuePattern(key: string): RegExp {
  return new RegExp(`"${key}"\\s*:\\s*(?:"(\\d+(?:[.,]\\d+)?)"|(\\d+(?:\\.\\d+)?))`);
}

const NUMERIC_VOLUME_PATTERN = numericStateValuePattern('volume');
const NUMERIC_STRENGTH_PATTERN = numericStateValuePattern('strength');

interface StateValueRead {
  readonly raw: string;
  readonly form: 'string-dot' | 'string-comma' | 'number-dot';
}

/** First numeric `"key"` value in a script body — raw token + value form. */
function readNumericStateValue(pattern: RegExp, scriptBody: string): StateValueRead | null {
  const match = pattern.exec(scriptBody);
  if (match === null) return null;
  const raw = match[1] ?? match[2];
  return {
    raw,
    form: match[1] !== undefined ? (raw.includes(',') ? 'string-comma' : 'string-dot') : 'number-dot',
  };
}

/**
 * String-valued `"volume"`/`"strength"` keys that are NOT pure numeric —
 * the i18n-dictionary form (`"volume":"Volume : "`, no digit) and digit
 * forms the guarded parse must reject (`"strength":"45,8 %"`). Counted so
 * the normalizer's numeric guard is measured, never assumed.
 */
const STRING_STATE_VALUE = /"(volume|strength)"\s*:\s*"([^"]{0,40})"/g;

/** Guarded litres parse → `{ litres, ml }` with the pipeline window applied. */
function guardedVolume(raw: string): { litres: number | null; ml: number | null; plausible: boolean } {
  const litres = parseDecimal(raw);
  if (litres === null) return { litres: null, ml: null, plausible: false };
  const ml = litres * 1000;
  // The pipeline's unit window: 0 < unit_volume < 100 litres (guardrails).
  const plausible = litres > 0 && litres < 100;
  return { litres, ml, plausible };
}

/** Guarded ABV parse — percent value and its ÷100 decimal, 0 < abv ≤ 100. */
function guardedStrength(raw: string): { percent: number | null; decimal: number | null; plausible: boolean } {
  const percent = parseDecimal(raw);
  if (percent === null) return { percent: null, decimal: null, plausible: false };
  const plausible = percent > 0 && percent <= 100;
  return { percent, decimal: percent / 100, plausible };
}

// ---------------------------------------------------------------------------
// Phase 3 helpers — script-blob + key-path discovery
// ---------------------------------------------------------------------------

/** Opening-tag attributes of every `<script>` block, with the body. */
function scriptBlocks(html: string): { attrs: string; body: string }[] {
  const blocks: { attrs: string; body: string }[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    blocks.push({ attrs: match[1], body: match[2] });
  }
  return blocks;
}

/** JSON.parse first, then the `window.x = {…}` slice (first `{` → last `}`). */
function tryParseJsonBlob(body: string): { ok: boolean; value: unknown; via: 'direct' | 'assignment-slice' | 'failed' } {
  const trimmed = body.trim();
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown, via: 'direct' };
  } catch {
    // fall through to the assignment slice
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return { ok: true, value: JSON.parse(trimmed.slice(start, end + 1)) as unknown, via: 'assignment-slice' };
    } catch {
      // fall through
    }
  }
  return { ok: false, value: null, via: 'failed' };
}

/**
 * Bounded DFS collecting the paths to the target keys (`volume`,
 * `strength`) inside a parsed state blob — the exact-key-path fact the
 * notes record. Depth-capped and result-capped so a pathological blob
 * cannot blow the probe up.
 */
function collectKeyPaths(
  node: unknown,
  targets: ReadonlySet<string>,
  maxDepth: number,
): ReadonlyMap<string, readonly string[]> {
  const paths = new Map<string, string[]>();
  const visit = (value: unknown, path: string, depth: number): void => {
    if (paths.size >= 12 || depth > maxDepth) return;
    if (Array.isArray(value)) {
      const bounded = value.slice(0, 50);
      for (let i = 0; i < bounded.length; i++) visit(bounded[i], `${path}[${i}]`, depth + 1);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (targets.has(key) && !paths.has(key)) paths.set(key, [...(path === '' ? [] : [path]), key]);
        visit(child, path === '' ? key : `${path}.${key}`, depth + 1);
      }
    }
  };
  visit(node, '', 0);
  return paths;
}

/**
 * Bounded DFS over a parsed state blob collecting the LABEL arrays of the
 * m3 taxonomy keys (`m3_category`, `m3_family`, `m3_subfamily`,
 * `m3_division` — `LmdwProductSelect`-shaped `{ label }` entries) and the
 * `ean` string. This is the page-side product-type vocabulary (design D3)
 * — measured where the page actually carries it, never from GraphQL.
 */
function collectStateTaxonomy(node: unknown, maxDepth: number): { m3Labels: Map<string, string[]>; ean: string | null } {
  const m3Targets = new Set(['m3_category', 'm3_family', 'm3_subfamily', 'm3_division']);
  const m3Labels = new Map<string, string[]>();
  let ean: string | null = null;
  const visit = (value: unknown, depth: number): void => {
    if (depth > maxDepth || (ean !== null && m3Labels.size >= m3Targets.size)) return;
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 50)) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (m3Targets.has(key) && !m3Labels.has(key)) {
        const labels: string[] = [];
        if (Array.isArray(child)) {
          for (const entry of child.slice(0, 20)) {
            const label = textOf((entry as { label?: unknown } | null)?.label);
            if (label !== null) labels.push(label);
          }
        } else {
          const label = textOf(child);
          if (label !== null) labels.push(label);
        }
        if (labels.length > 0) m3Labels.set(key, labels);
      }
      if (ean === null && key === 'ean') {
        if (typeof child === 'string' && child.trim() !== '') ean = child.trim();
        else if (typeof child === 'number') ean = String(child);
      }
      visit(child, depth + 1);
    }
  };
  visit(node, 0);
  return { m3Labels, ean };
}

// ---------------------------------------------------------------------------
// Phase 3 helpers — JSON-LD + microdata
// ---------------------------------------------------------------------------

interface JsonLdProductFacts {
  readonly category: string | null;
  readonly brand: string | null;
  readonly gtins: readonly string[];
  readonly currencies: readonly string[];
  readonly prices: readonly (number | null)[];
}

interface JsonLdBreadcrumbFacts {
  readonly terms: readonly string[];
}

function typeNameOf(node: Record<string, unknown>): string[] {
  const raw = node['@type'];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  return [];
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'object' && value !== null) {
    const name = (value as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim() !== '') return name.trim();
  }
  return null;
}

function productFactsOf(node: Record<string, unknown>): JsonLdProductFacts {
  const gtins: string[] = [];
  for (const key of ['gtin13', 'gtin', 'gtin8', 'gtin12', 'gtin14']) {
    const value = node[key];
    if (typeof value === 'string' && value.trim() !== '') gtins.push(value.trim());
    else if (typeof value === 'number') gtins.push(String(value));
  }
  const currencies: string[] = [];
  const prices: (number | null)[] = [];
  const offers = node['offers'];
  const offerList = Array.isArray(offers) ? offers : offers === undefined || offers === null ? [] : [offers];
  for (const offer of offerList) {
    if (typeof offer !== 'object' || offer === null) continue;
    const record = offer as Record<string, unknown>;
    if (typeof record['priceCurrency'] === 'string') currencies.push(record['priceCurrency'].trim());
    const priceRaw = record['price'] ?? record['lowPrice'];
    if (typeof priceRaw === 'string' || typeof priceRaw === 'number') {
      const parsed = typeof priceRaw === 'number' ? priceRaw : Number.parseFloat(priceRaw.replace(',', '.'));
      prices.push(Number.isFinite(parsed) ? parsed : null);
    }
  }
  return {
    category: textOf(node['category']),
    brand: textOf(node['brand'] ?? node['seller']),
    gtins,
    currencies,
    prices,
  };
}

function breadcrumbTermsOf(node: Record<string, unknown>): string[] {
  const terms: string[] = [];
  const items = node['itemListElement'];
  if (!Array.isArray(items)) return terms;
  for (const entry of items) {
    if (typeof entry === 'string' && entry.trim() !== '') {
      terms.push(entry.trim());
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const direct = textOf(record['name']);
    if (direct !== null) {
      terms.push(direct);
      continue;
    }
    const item = record['item'];
    if (typeof item === 'object' && item !== null) {
      const nested = textOf((item as Record<string, unknown>)['name']);
      if (nested !== null) terms.push(nested);
    }
  }
  return terms;
}

/** Walk a parsed JSON-LD document (plain or @graph) yielding every object node. */
function* jsonLdNodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const entry of value) yield* jsonLdNodes(entry);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  yield record;
  if (record['@graph'] !== undefined) yield* jsonLdNodes(record['@graph']);
}

interface JsonLdScan {
  readonly blocks: number;
  readonly parseErrors: number;
  readonly productNodes: number;
  readonly products: readonly JsonLdProductFacts[];
  readonly breadcrumbs: readonly JsonLdBreadcrumbFacts[];
}

function scanJsonLd(html: string): JsonLdScan {
  let blocks = 0;
  let parseErrors = 0;
  let productNodes = 0;
  const products: JsonLdProductFacts[] = [];
  const breadcrumbs: JsonLdBreadcrumbFacts[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    blocks++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      parseErrors++;
      continue;
    }
    for (const node of jsonLdNodes(parsed)) {
      const types = typeNameOf(node);
      if (types.some((t) => t.toLowerCase() === 'product')) {
        productNodes++;
        products.push(productFactsOf(node));
      }
      if (types.some((t) => t.toLowerCase() === 'breadcrumblist')) {
        breadcrumbs.push({ terms: breadcrumbTermsOf(node) });
      }
    }
  }
  return { blocks, parseErrors, productNodes, products, breadcrumbs };
}

/** Microdata `itemprop="gtin…"` values — case-insensitive (the PR #107 rule). */
function scanMicrodataGtin(html: string): { present: boolean; values: readonly string[] } {
  const values: string[] = [];
  for (const match of html.matchAll(/itemprop\s*=\s*["']gtin(?:8|12|13|14)?["'][^>]*>/gi)) {
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(match[0]);
    if (content !== null) values.push(content[1].trim());
  }
  return { present: values.length > 0, values };
}

/** GS1 check digit (GTIN-13; also validates zero-padded 14/12/8 forms). */
function checkDigitMatches(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  const padded = digits.padStart(14, '0');
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number.parseInt(padded[i], 10) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number.parseInt(padded[13], 10);
}

/** Category-ish keys inside embedded state JSON (`"category…" : "…"`) — bounded. */
function scanStateCategorySignals(html: string): ReadonlyMap<string, Map<string, number>> {
  const byKey = new Map<string, Map<string, number>>();
  const pattern = /"(category[a-z_]{0,20})"\s*:\s*"([^"]{1,80})"/gi;
  let seen = 0;
  for (const match of html.matchAll(pattern)) {
    if (++seen > 200) break;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (value === '') continue;
    let values = byKey.get(key);
    if (values === undefined) {
      values = new Map<string, number>();
      byKey.set(key, values);
    }
    values.set(value, (values.get(value) ?? 0) + 1);
  }
  return byKey;
}

// ---------------------------------------------------------------------------
// Phase 3 — page sampling + per-page measurement
// ---------------------------------------------------------------------------

interface PageOutcome {
  readonly url: string;
  readonly inUrlKeyWalk: boolean;
  readonly httpStatus: number | null;
  readonly fetchError: string | null;
  readonly bytes: number;
  // state-JSON facts
  readonly volume: StateValueRead | null;
  readonly volumeParse: { litres: number | null; ml: number | null; plausible: boolean } | null;
  readonly strength: StateValueRead | null;
  readonly strengthParse: { percent: number | null; decimal: number | null; plausible: boolean } | null;
  /** String-valued state keys with NO digit — i18n-dictionary noise. */
  readonly i18nStateValueCount: number;
  /** String-valued state keys WITH a digit the guarded parse rejects ("45,8 %"). */
  readonly unparseableStringStateCount: number;
  readonly carrierScriptAttrs: string | null;
  readonly stateBlobParse: 'direct' | 'assignment-slice' | 'failed' | 'not-attempted';
  readonly volumeKeyPath: string | null;
  readonly strengthKeyPath: string | null;
  readonly stateCategoryKeys: readonly string[];
  /** Flattened `key:value` → count from the state-JSON category scan (capped per page). */
  readonly stateCategoryValueCounts: readonly (readonly [string, number])[];
  /** Page-side m3 taxonomy labels from the state blob — `key` → label pairs (capped). */
  readonly stateM3Labels: readonly (readonly [string, string])[];
  /** The state blob's `ean` value when present (page-attested, design D4 cross-evidence). */
  readonly stateEan: string | null;
  // JSON-LD facts
  readonly jsonLdBlocks: number;
  readonly jsonLdParseErrors: number;
  readonly hasProductJsonLd: boolean;
  readonly jsonLdCategory: string | null;
  readonly jsonLdBrand: string | null;
  readonly gtins: readonly string[];
  readonly microdataGtin: readonly string[];
  readonly breadcrumbTerms: readonly string[];
  readonly currencies: readonly string[];
  readonly unparseablePrices: number;
}

async function measurePage(url: string, inUrlKeyWalk: boolean): Promise<PageOutcome> {
  const base: PageOutcome = {
    url,
    inUrlKeyWalk,
    httpStatus: null,
    fetchError: null,
    bytes: 0,
    volume: null,
    volumeParse: null,
    strength: null,
    strengthParse: null,
    i18nStateValueCount: 0,
    unparseableStringStateCount: 0,
    carrierScriptAttrs: null,
    stateBlobParse: 'not-attempted',
    volumeKeyPath: null,
    strengthKeyPath: null,
    stateCategoryKeys: [],
    stateCategoryValueCounts: [],
    stateM3Labels: [],
    stateEan: null,
    jsonLdBlocks: 0,
    jsonLdParseErrors: 0,
    hasProductJsonLd: false,
    jsonLdCategory: null,
    jsonLdBrand: null,
    gtins: [],
    microdataGtin: [],
    breadcrumbTerms: [],
    currencies: [],
    unparseablePrices: 0,
  };

  const result = await politeGet(url, `page ${url}`);
  if (!result.ok) return { ...base, fetchError: result.error };

  const html = result.body;

  // State-JSON carriers: per key, the FIRST script blob carrying a NUMERIC
  // value is its carrier (both normally share one blob). String values are
  // bucketed — digit-free (i18n dictionary noise) vs digit-bearing forms
  // the guarded parse must reject — so the numeric guard is measured.
  let i18nCount = 0;
  let unparseableStringCount = 0;
  STRING_STATE_VALUE.lastIndex = 0;
  for (const match of html.matchAll(STRING_STATE_VALUE)) {
    const value = match[2];
    if (/^[\d.,]+$/.test(value)) continue; // numeric string — covered by the read below
    if (/\d/.test(value)) unparseableStringCount++;
    else i18nCount++;
  }

  let volume: StateValueRead | null = null;
  let strength: StateValueRead | null = null;
  let carrierScriptAttrs: string | null = null;
  let stateBlobParse: PageOutcome['stateBlobParse'] = 'not-attempted';
  let volumeKeyPath: string | null = null;
  let strengthKeyPath: string | null = null;

  /** Parse the carrier blob and record the key paths found inside it. */
  const scanCarrier = (attrs: string, body: string, key: 'volume' | 'strength'): void => {
    if (carrierScriptAttrs === null) carrierScriptAttrs = truncate(attrs.trim().replace(/\s+/g, ' '), 200);
    const parsedBlob = tryParseJsonBlob(body);
    stateBlobParse = parsedBlob.via;
    if (!parsedBlob.ok) return;
    const paths = collectKeyPaths(parsedBlob.value, new Set(['volume', 'strength']), 12);
    const path = paths.get(key);
    if (key === 'volume') volumeKeyPath = path === undefined ? null : path.join(' › ');
    else strengthKeyPath = path === undefined ? null : path.join(' › ');
  };

  for (const block of scriptBlocks(html)) {
    if (!block.body.includes('"volume"') && !block.body.includes('"strength"')) continue;
    if (volume === null) {
      const read = readNumericStateValue(NUMERIC_VOLUME_PATTERN, block.body);
      if (read !== null) {
        volume = read;
        scanCarrier(block.attrs, block.body, 'volume');
      }
    }
    if (strength === null) {
      const read = readNumericStateValue(NUMERIC_STRENGTH_PATTERN, block.body);
      if (read !== null) {
        strength = read;
        scanCarrier(block.attrs, block.body, 'strength');
      }
    }
    if (volume !== null && strength !== null) break;
  }

  const volumeParse = volume !== null ? guardedVolume(volume.raw) : null;
  const strengthParse = strength !== null ? guardedStrength(strength.raw) : null;

  const jsonLd = scanJsonLd(html);
  const product = jsonLd.products[0] ?? null;
  const microdata = scanMicrodataGtin(html);
  const categorySignals = scanStateCategorySignals(html);
  const stateCategoryValueCounts: (readonly [string, number])[] = [];
  for (const [key, values] of categorySignals) {
    for (const [value, count] of topEntries(values, 5)) {
      stateCategoryValueCounts.push([`${key}:${value}`, count]);
      if (stateCategoryValueCounts.length >= 50) break;
    }
    if (stateCategoryValueCounts.length >= 50) break;
  }
  const categoryKeys = [...categorySignals.keys()].sort();

  // The __NEXT_DATA__ state blob — the m3 taxonomy + ean census source
  // (parsed independently of the volume carrier so pages WITHOUT the
  // numeric volume keys still contribute their taxonomy signal).
  let stateM3Labels: (readonly [string, string])[] = [];
  let stateEan: string | null = null;
  for (const block of scriptBlocks(html)) {
    if (!block.attrs.includes('__NEXT_DATA__')) continue;
    const parsedBlob = tryParseJsonBlob(block.body);
    if (parsedBlob.ok) {
      const taxonomy = collectStateTaxonomy(parsedBlob.value, 12);
      stateM3Labels = [...taxonomy.m3Labels.entries()].flatMap(([key, labels]) =>
        labels.map((label): readonly [string, string] => [key, label]),
      );
      stateEan = taxonomy.ean;
    }
    break;
  }

  const currencies = product !== null ? product.currencies : [];
  const unparseablePrices = product !== null ? product.prices.filter((p) => p === null).length : 0;

  return {
    ...base,
    httpStatus: result.status,
    bytes: html.length,
    volume,
    volumeParse,
    strength,
    strengthParse,
    i18nStateValueCount: i18nCount,
    unparseableStringStateCount: unparseableStringCount,
    carrierScriptAttrs,
    stateBlobParse,
    volumeKeyPath,
    strengthKeyPath,
    stateCategoryKeys: categoryKeys,
    stateCategoryValueCounts,
    stateM3Labels,
    stateEan,
    jsonLdBlocks: jsonLd.blocks,
    jsonLdParseErrors: jsonLd.parseErrors,
    hasProductJsonLd: jsonLd.productNodes > 0,
    jsonLdCategory: product?.category ?? null,
    jsonLdBrand: product?.brand ?? null,
    gtins: product?.gtins ?? [],
    microdataGtin: microdata.values,
    breadcrumbTerms: jsonLd.breadcrumbs.flatMap((b) => b.terms),
    currencies,
    unparseablePrices,
  };
}

/** Even-stride sample over an ordered URL list — the sweep's sampling rule. */
function strideSample(urls: readonly string[], count: number): string[] {
  if (urls.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(urls[Math.floor((i * urls.length) / count)]);
  return out;
}

// ---------------------------------------------------------------------------
// Phase 4 — aggregate + report
// ---------------------------------------------------------------------------

interface Aggregates {
  readonly volumePresent: number;
  readonly volumeImplausible: number;
  readonly strengthPresent: number;
  readonly strengthImplausible: number;
  readonly volumeForms: ReadonlyMap<string, number>;
  readonly strengthForms: ReadonlyMap<string, number>;
  readonly volumeValueCensus: ReadonlyMap<string, number>;
  readonly strengthValueCensus: ReadonlyMap<string, number>;
  readonly carrierAttrs: ReadonlyMap<string, number>;
  readonly blobParse: ReadonlyMap<string, number>;
  readonly volumeKeyPaths: ReadonlyMap<string, number>;
  readonly strengthKeyPaths: ReadonlyMap<string, number>;
  readonly pagesWithI18nGuardHits: number;
  readonly pagesWithUnparseableStringState: number;
  readonly stateCategoryKeyCensus: ReadonlyMap<string, number>;
  readonly stateCategoryValues: ReadonlyMap<string, number>;
  readonly m3LabelCensus: ReadonlyMap<string, number>;
  readonly m3DistinctByKey: ReadonlyMap<string, number>;
  readonly pagesWithM3Labels: number;
  readonly stateEanPresent: number;
  readonly stateEanSamples: readonly string[];
  readonly breadcrumbCensus: ReadonlyMap<string, number>;
  readonly jsonLdCategoryCensus: ReadonlyMap<string, number>;
  readonly pagesWithProductJsonLd: number;
  readonly pagesWithBreadcrumbs: number;
  readonly jsonLdParseErrorPages: number;
  readonly pagesWithAnyGtin: number;
  readonly gtinSamples: readonly string[];
  readonly gtinLengths: ReadonlyMap<number, number>;
  readonly gtinCheckDigitValid: number;
  readonly gtinCheckDigitInvalid: number;
  readonly currencyCensus: ReadonlyMap<string, number>;
  readonly unparseablePriceRows: number;
  readonly failures: readonly PageOutcome[];
  readonly noVolumeSamples: readonly string[];
}

function increment<T>(map: Map<T, number>, key: T, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function topEntries<T>(map: ReadonlyMap<T, number>, limit: number): [T, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function aggregate(outcomes: readonly PageOutcome[]): Aggregates {
  const volumeForms = new Map<string, number>();
  const strengthForms = new Map<string, number>();
  const volumeValueCensus = new Map<string, number>();
  const strengthValueCensus = new Map<string, number>();
  const carrierAttrs = new Map<string, number>();
  const blobParse = new Map<string, number>();
  const volumeKeyPaths = new Map<string, number>();
  const strengthKeyPaths = new Map<string, number>();
  const stateCategoryKeyCensus = new Map<string, number>();
  const stateCategoryValues = new Map<string, number>();
  const m3LabelCensus = new Map<string, number>();
  const m3KeysSeen = new Map<string, Set<string>>();
  const stateEanSamples: string[] = [];
  const breadcrumbCensus = new Map<string, number>();
  const jsonLdCategoryCensus = new Map<string, number>();
  const currencyCensus = new Map<string, number>();
  const gtinLengths = new Map<number, number>();
  const gtinSamples: string[] = [];
  const failures: PageOutcome[] = [];
  const noVolumeSamples: string[] = [];

  let volumePresent = 0;
  let volumeImplausible = 0;
  let strengthPresent = 0;
  let strengthImplausible = 0;
  let pagesWithI18nGuardHits = 0;
  let pagesWithUnparseableStringState = 0;
  let pagesWithProductJsonLd = 0;
  let pagesWithBreadcrumbs = 0;
  let jsonLdParseErrorPages = 0;
  let pagesWithAnyGtin = 0;
  let checkDigitValidCount = 0;
  let checkDigitInvalidCount = 0;
  let pagesWithM3Labels = 0;
  let stateEanPresent = 0;
  let unparseablePriceRows = 0;

  for (const page of outcomes) {
    if (page.fetchError !== null || page.httpStatus === null || page.httpStatus >= 400) {
      failures.push(page);
      continue;
    }
    if (page.volume !== null) {
      volumePresent++;
      increment(volumeForms, page.volume.form);
      increment(volumeValueCensus, page.volume.raw);
      if (page.volumeParse !== null && !page.volumeParse.plausible) volumeImplausible++;
    } else if (noVolumeSamples.length < SAMPLE_LIMIT && page.httpStatus === 200) {
      noVolumeSamples.push(page.url);
    }
    if (page.strength !== null) {
      strengthPresent++;
      increment(strengthForms, page.strength.form);
      increment(strengthValueCensus, page.strength.raw);
      if (page.strengthParse !== null && !page.strengthParse.plausible) strengthImplausible++;
    }
    if (page.i18nStateValueCount > 0) pagesWithI18nGuardHits++;
    if (page.unparseableStringStateCount > 0) pagesWithUnparseableStringState++;
    if (page.carrierScriptAttrs !== null) {
      increment(carrierAttrs, page.carrierScriptAttrs);
      increment(blobParse, page.stateBlobParse);
      if (page.volumeKeyPath !== null) increment(volumeKeyPaths, page.volumeKeyPath);
      if (page.strengthKeyPath !== null) increment(strengthKeyPaths, page.strengthKeyPath);
    }
    for (const key of page.stateCategoryKeys) increment(stateCategoryKeyCensus, key);
    for (const [keyValue, count] of page.stateCategoryValueCounts) increment(stateCategoryValues, keyValue, count);
    if (page.stateM3Labels.length > 0) {
      pagesWithM3Labels++;
      for (const [key, label] of page.stateM3Labels) {
        increment(m3LabelCensus, `${key} "${label}"`);
        let seen = m3KeysSeen.get(key);
        if (seen === undefined) {
          seen = new Set<string>();
          m3KeysSeen.set(key, seen);
        }
        seen.add(label);
      }
    }
    if (page.stateEan !== null) {
      stateEanPresent++;
      if (stateEanSamples.length < 10) stateEanSamples.push(page.stateEan);
    }
    if (page.hasProductJsonLd) {
      pagesWithProductJsonLd++;
      if (page.jsonLdCategory !== null) increment(jsonLdCategoryCensus, page.jsonLdCategory);
      for (const term of page.breadcrumbTerms) increment(breadcrumbCensus, term);
    }
    if (page.breadcrumbTerms.length > 0) pagesWithBreadcrumbs++;
    if (page.jsonLdParseErrors > 0) jsonLdParseErrorPages++;
    const allGtins = [...page.gtins, ...page.microdataGtin];
    if (allGtins.length > 0) {
      pagesWithAnyGtin++;
      for (const gtin of allGtins) {
        increment(gtinLengths, gtin.length);
        if (gtinSamples.length < 10) gtinSamples.push(gtin);
        if (/^\d{13}$/.test(gtin)) {
          if (checkDigitMatches(gtin)) checkDigitValidCount++;
          else checkDigitInvalidCount++;
        }
      }
    }
    for (const currency of page.currencies) increment(currencyCensus, currency);
    unparseablePriceRows += page.unparseablePrices;
  }

  return {
    volumePresent,
    volumeImplausible,
    strengthPresent,
    strengthImplausible,
    volumeForms,
    strengthForms,
    volumeValueCensus,
    strengthValueCensus,
    carrierAttrs,
    blobParse,
    volumeKeyPaths,
    strengthKeyPaths,
    pagesWithI18nGuardHits,
    pagesWithUnparseableStringState,
    stateCategoryKeyCensus,
    stateCategoryValues,
    m3LabelCensus,
    m3DistinctByKey: new Map([...m3KeysSeen.entries()].map(([key, seen]) => [key, seen.size])),
    pagesWithM3Labels,
    stateEanPresent,
    stateEanSamples,
    breadcrumbCensus,
    jsonLdCategoryCensus,
    pagesWithProductJsonLd,
    pagesWithBreadcrumbs,
    jsonLdParseErrorPages,
    pagesWithAnyGtin,
    gtinSamples,
    gtinLengths,
    gtinCheckDigitValid: checkDigitValidCount,
    gtinCheckDigitInvalid: checkDigitInvalidCount,
    currencyCensus,
    unparseablePriceRows,
    failures,
    noVolumeSamples,
  };
}

function printReport(
  discovery: SitemapDiscovery,
  walk: UrlKeyWalk,
  productUrls: readonly string[],
  source: 'sitemap' | 'graphql',
  outcomes: readonly PageOutcome[],
  agg: Aggregates,
  coverage: { readonly overlap: number; readonly precision: number | null; readonly recall: number | null },
): void {
  const okPages = outcomes.length - agg.failures.length;

  console.log('');
  console.log('=== lmdw (www.whisky.fr) crawl probe — read-only (task 1.1, design D1) ===');
  console.log(`user-agent: ${CRAWLER_USER_AGENT}`);
  console.log('');

  console.log('-- 1. Sitemap discovery --');
  console.log(
    `robots.txt Sitemap directives: ${discovery.robotsSitemapDirectives.length > 0 ? discovery.robotsSitemapDirectives.join(', ') : '(none)'}`,
  );
  for (const doc of discovery.documents) {
    console.log(`  [${doc.kind}] ${doc.url} — ${doc.note}${doc.httpStatus !== null ? ` (HTTP ${doc.httpStatus})` : ''}`);
  }
  console.log(
    `urlsets: ${discovery.documents.filter((d) => d.kind === 'urlset').length}` +
      ` | indexes: ${discovery.documents.filter((d) => d.kind === 'index').length}` +
      ` | unusable: ${discovery.documents.filter((d) => d.kind === 'unusable').length}` +
      ` | unique locs: ${discovery.allLocs.length}` +
      ` | with lastmod: ${discovery.locsWithLastmod}`,
  );
  const singleSegment = productUrls;
  const multiSegment = discovery.allLocs.filter((l) => /^https:\/\/www\.whisky\.fr\/.+\/.+\.html$/.test(l));
  console.log(
    `product-shaped (single-segment <url_key>.html): ${singleSegment.length}` +
      ` | multi-segment .html: ${multiSegment.length}` +
      ` | other locs: ${discovery.allLocs.length - singleSegment.length - multiSegment.length}`,
  );
  for (const error of discovery.fetchErrors) console.log(`  discovery error: ${error}`);
  console.log('');

  console.log('-- 2. GraphQL url_key cross-walk (URL-source use only) --');
  console.log(
    `total_count: ${walk.totalCount ?? '(unknown)'} | pages ok: ${walk.pagesOk}/${walk.pagesFetched}` +
      ` | distinct skus: ${walk.urlKeys.size} | duplicate-sku rows: ${walk.duplicateSkus}` +
      ` | rows without url_key: ${walk.rowsWithoutUrlKey} | failures: ${walk.failures.length}`,
  );
  console.log(
    `predicate coverage — overlap sitemap∩catalog: ${coverage.overlap}` +
      ` (precision ${coverage.precision === null ? 'n/a' : `${(coverage.precision * 100).toFixed(1)}%`}` +
      `, recall ${coverage.recall === null ? 'n/a' : `${(coverage.recall * 100).toFixed(1)}%`})` +
      ` — precision = share of sitemap candidates that are catalog products,` +
      ` recall = share of catalog products present in the sitemap`,
  );
  for (const failure of walk.failures) console.log(`  walk failure: ${failure}`);
  console.log('');

  console.log('-- 3. Page sample — extraction coverage --');
  console.log(`URL source: ${source} | sampled: ${outcomes.length} | fetched ok: ${okPages} | failures: ${agg.failures.length}`);
  for (const failure of agg.failures.slice(0, 10)) {
    console.log(`  page failure: ${failure.url} — ${failure.fetchError ?? `HTTP ${failure.httpStatus}`}`);
  }
  const volumeCoverage = pct(agg.volumePresent, okPages);
  const strengthCoverage = pct(agg.strengthPresent, okPages);
  console.log(
    `volume (state JSON, litres): ${agg.volumePresent}/${okPages} (${volumeCoverage})` +
      ` | implausible-after-guard: ${agg.volumeImplausible}`,
  );
  console.log(
    `strength (state JSON, ABV %): ${agg.strengthPresent}/${okPages} (${strengthCoverage})` +
      ` | implausible-after-guard: ${agg.strengthImplausible}`,
  );
  console.log(`volume forms: ${topEntries(agg.volumeForms, 6).map(([f, c]) => `${f}×${c}`).join(', ') || '(none)'}`);
  console.log(`strength forms: ${topEntries(agg.strengthForms, 6).map(([f, c]) => `${f}×${c}`).join(', ') || '(none)'}`);
  console.log(
    `top volume values (litres): ${topEntries(agg.volumeValueCensus, 12).map(([v, c]) => `${v}×${c}`).join(', ') || '(none)'}`,
  );
  console.log(
    `top strength values (percent): ${topEntries(agg.strengthValueCensus, 12).map(([v, c]) => `${v}×${c}`).join(', ') || '(none)'}`,
  );
  console.log(
    `i18n-dictionary guard hits (digit-free "volume"/"strength" strings): ${agg.pagesWithI18nGuardHits}/${okPages} pages` +
      ` | digit strings the guard rejects ("45,8 %" forms): ${agg.pagesWithUnparseableStringState}/${okPages} pages` +
      ' — the normalizer MUST require pure-numeric values',
  );
  for (const url of agg.noVolumeSamples) console.log(`  no-volume sample: ${url}`);
  console.log('');
  console.log('-- 3b. State-JSON structure (the normalizer facts) --');
  console.log(
    `carrier script tags: ${topEntries(agg.carrierAttrs, 5).map(([a, c]) => `"${truncate(a, 90)}"×${c}`).join(' | ') || '(none)'}`,
  );
  console.log(`blob JSON-parse: ${topEntries(agg.blobParse, 4).map(([k, c]) => `${k}×${c}`).join(', ') || '(none)'}`);
  console.log(
    `volume key paths: ${topEntries(agg.volumeKeyPaths, 5).map(([p, c]) => `"${p}"×${c}`).join(', ') || '(none)'}`,
  );
  console.log(
    `strength key paths: ${topEntries(agg.strengthKeyPaths, 5).map(([p, c]) => `"${p}"×${c}`).join(', ') || '(none)'}`,
  );
  console.log('');

  console.log('-- 4. Category signal census (page-side, design D3 vocabulary input) --');
  console.log(`pages with @type Product JSON-LD: ${agg.pagesWithProductJsonLd}/${okPages} | with BreadcrumbList terms: ${agg.pagesWithBreadcrumbs}`);
  console.log(
    `distinct JSON-LD category values: ${agg.jsonLdCategoryCensus.size}` +
      ` | distinct breadcrumb terms: ${agg.breadcrumbCensus.size}` +
      ` | distinct state-JSON category-ish keys: ${agg.stateCategoryKeyCensus.size}`,
  );
  console.log(`JSON-LD category top values: ${topEntries(agg.jsonLdCategoryCensus, TOP_TERMS_LIMIT).map(([t, c]) => `"${t}"×${c}`).join(', ') || '(none)'}`);
  console.log(`breadcrumb terms (top ${TOP_TERMS_LIMIT}):`);
  for (const [term, count] of topEntries(agg.breadcrumbCensus, TOP_TERMS_LIMIT)) {
    console.log(`  "${term}": ${count}`);
  }
  console.log(`state-JSON category keys: ${topEntries(agg.stateCategoryKeyCensus, 10).map(([k, c]) => `${k}×${c}`).join(', ') || '(none)'}`);
  console.log(`state-JSON category values (top ${TOP_TERMS_LIMIT}):`);
  for (const [value, count] of topEntries(agg.stateCategoryValues, TOP_TERMS_LIMIT)) {
    console.log(`  "${value}": ${count}`);
  }
  console.log('');
  console.log('-- 4b. State-JSON m3 taxonomy census (page-side product-type vocabulary, design D3) --');
  console.log(
    `pages with m3_* labels in the state blob: ${agg.pagesWithM3Labels}/${okPages}` +
      ` | distinct labels by key: ${[...agg.m3DistinctByKey.entries()].map(([k, n]) => `${k}=${n}`).join(', ') || '(none)'}`,
  );
  console.log(`m3 labels (top ${TOP_TERMS_LIMIT} of ${agg.m3LabelCensus.size} distinct key+label pairs):`);
  for (const [pair, count] of topEntries(agg.m3LabelCensus, TOP_TERMS_LIMIT)) {
    console.log(`  ${pair}: ${count}`);
  }
  console.log('');

  console.log('-- 5. GTIN13 (design D4 — page-attested only) --');
  console.log(
    `pages with any gtin (JSON-LD or microdata): ${agg.pagesWithAnyGtin}/${okPages} (${pct(agg.pagesWithAnyGtin, okPages)})` +
      ` | length census: ${topEntries(agg.gtinLengths, 6).map(([l, c]) => `${l}-digit×${c}`).join(', ') || '(none)'}`,
  );
  console.log(
    `13-digit check digit: valid ${agg.gtinCheckDigitValid}, invalid ${agg.gtinCheckDigitInvalid}` +
      ` | samples: ${agg.gtinSamples.slice(0, 10).join(', ') || '(none)'}`,
  );
  console.log(
    `state-JSON ean field: ${agg.stateEanPresent}/${okPages} pages` +
      ` | samples: ${agg.stateEanSamples.slice(0, 10).join(', ') || '(none)'}`,
  );
  console.log('');

  console.log('-- 6. EUR sanity (JSON-LD offers) --');
  console.log(
    `priceCurrency: ${topEntries(agg.currencyCensus, 8).map(([c, n]) => `${c}×${n}`).join(', ') || '(no offers parsed)'}` +
      ` | unparseable price rows: ${agg.unparseablePriceRows}` +
      ` | JSON-LD parse-error pages: ${agg.jsonLdParseErrorPages}`,
  );
  console.log('');

  // Decision suggestion — the operator records the final call in the notes.
  const volumeOk = okPages > 0 && agg.volumePresent / okPages >= 0.9;
  const strengthOk = okPages > 0 && agg.strengthPresent / okPages >= 0.9;
  const categorySignalPages = new Set(
    outcomes
      .filter(
        (p) =>
          (p.hasProductJsonLd && (p.jsonLdCategory !== null || p.breadcrumbTerms.length > 0)) ||
          p.stateM3Labels.length > 0,
      )
      .map((p) => p.url),
  ).size;
  const categoryOk =
    agg.jsonLdCategoryCensus.size + agg.breadcrumbCensus.size + agg.m3LabelCensus.size >= 10 &&
    okPages > 0 &&
    categorySignalPages / okPages >= 0.6;
  const urlSource =
    productUrls.length >= 100 && coverage.recall !== null && coverage.recall >= 0.9
      ? 'PURE SITEMAP (LmdwFeedAdapter extends SitemapCrawlFeedAdapter)'
      : productUrls.length >= 100
        ? 'PURE SITEMAP with flagged coverage (see recall above)'
        : 'GRAPHQL-SEEDED URL LIST (design D1 variant)';
  console.log('-- 7. Decision suggestion (operator records the final call) --');
  console.log(`URL source: ${urlSource}`);
  console.log(
    `task 3.1: ${volumeOk && strengthOk && categoryOk ? 'GO suggested' : 'NO-GO suggested'}` +
      ` (volume ${volumeOk ? 'ok' : 'thin'} ≥90%: ${volumeCoverage}` +
      `, strength ${strengthOk ? 'ok' : 'thin'} ≥90%: ${strengthCoverage}` +
      `, category signal ${categoryOk ? 'ok' : 'sparse'}: ${categorySignalPages}/${okPages} pages` +
      `, distinct terms ${agg.jsonLdCategoryCensus.size + agg.breadcrumbCensus.size + agg.m3LabelCensus.size} ≥10)`,
  );
  console.log('');

  const complete = walk.failures.length === 0 && okPages > 0 && agg.failures.length / outcomes.length <= 0.1;
  console.log(
    complete
      ? '=== probe COMPLETE — numbers above are the 1.1 decision evidence ==='
      : '=== probe INCOMPLETE — enumeration or page failures beyond 10%; shares untrustworthy ===',
  );
  if (!complete) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let sampleTarget = SAMPLE_DEFAULT;
  if (argv.length > 1 || (argv.length === 1 && !/^\d+$/.test(argv[0]))) {
    console.error('usage: tsx ../../scripts/lmdw-crawl-probe.ts [sampleSize]');
    process.exit(2);
  }
  if (argv.length === 1) {
    sampleTarget = Math.min(Number.parseInt(argv[0], 10), SAMPLE_HARD_CAP);
  }

  console.log('[lmdw-probe] www.whisky.fr crawl probe — read-only GETs + URL-source GraphQL reads');
  console.log(`[lmdw-probe] sample target: ${sampleTarget} pages, page pace ${PAGE_PACE_MS}ms, fetch timeout ${FETCH_TIMEOUT_MS}ms`);

  // Phase 1 — sitemap discovery.
  const discovery = await discoverSitemaps();
  const productUrls = [...new Set(discovery.allLocs.filter((loc) => PRODUCT_URL_PATTERN.test(loc)))];

  // Phase 2 — GraphQL url_key cross-walk (coverage measurement + D1 fallback).
  const walk = await walkUrlKeys();
  const catalogUrls = [...walk.urlKeys.values()].map((key) => `${STOREFRONT}/${key}.html`);
  const catalogUrlSet = new Set(catalogUrls);
  const overlap = productUrls.filter((url) => catalogUrlSet.has(url)).length;

  // Phase 3 — sample + measure pages (sitemap first per design D1; GraphQL fallback).
  let source: 'sitemap' | 'graphql' = 'sitemap';
  let sampleUrls = strideSample(productUrls, Math.min(sampleTarget, productUrls.length));
  if (productUrls.length < 100 && catalogUrls.length > 0) {
    source = 'graphql';
    sampleUrls = strideSample(catalogUrls, Math.min(sampleTarget, catalogUrls.length));
  }

  const outcomes: PageOutcome[] = [];
  if (sampleUrls.length === 0) {
    console.log('[lmdw-probe] no sample URLs — neither the sitemap nor the GraphQL walk yielded product URLs');
    console.log('=== probe INCOMPLETE — nothing sampled; shares untrustworthy ===');
    process.exitCode = 1;
    return;
  }
  for (let i = 0; i < sampleUrls.length; i++) {
    if (i > 0) await sleep(PAGE_PACE_MS);
    const url = sampleUrls[i];
    outcomes.push(await measurePage(url, catalogUrlSet.has(url)));
    if ((i + 1) % 25 === 0) {
      const fetched = outcomes.length;
      const ok = outcomes.filter((o) => o.httpStatus !== null && o.httpStatus < 400).length;
      const withVolume = outcomes.filter((o) => o.volume !== null).length;
      console.log(`[lmdw-probe] progress ${fetched}/${sampleUrls.length}: ${ok} ok, ${withVolume} with volume`);
    }
  }

  const agg = aggregate(outcomes);
  printReport(discovery, walk, productUrls, source, outcomes, agg, {
    overlap,
    precision: productUrls.length > 0 ? overlap / productUrls.length : null,
    recall: walk.urlKeys.size > 0 ? overlap / walk.urlKeys.size : null,
  });
}

main().catch((err: unknown) => {
  console.error(`[lmdw-probe] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
