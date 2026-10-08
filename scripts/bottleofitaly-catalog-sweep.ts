#!/usr/bin/env node
/**
 * bottleofitaly.com full-catalog read-only sweep (pre-onboarding audit;
 * the onboard-shopify-lmdw-merchants 1.1 playbook, mydrink-sweep structure
 * applied to the first Shopify merchant).
 *
 * Unlike the Woo sweeps, the walk is Shopify `products.json`: sequential
 * `?limit=250&page=N` GETs with SHORT-PAGE termination — Shopify exposes
 * no total-pages header, so a page returning fewer products than the limit
 * is the last page and an empty page is normal termination (design D1).
 * Extraction is prototyped inline here (task 3.1 promotes exactly this
 * logic into `bottleofitaly.parser.ts`, so the parser is never the first
 * time the extraction runs):
 *
 *   - ABV from the `custom-gradazione-XX-X` tag: `40-0` → 40.0 %,
 *     `41-5` → 41.5 % (integer + decimal-halves form).
 *   - Volume from the product title token (`20cl`, `70cl`, `0,75 l` —
 *     comma-decimal, bare `l` → ×1000), then the fallback chain the
 *     sweep measures so 3.1 can decide the fallback rule for the titles
 *     the token misses: a whole-tag volume token (`150cl` — discovered
 *     in sweep run 1: BOI wine carries its volume as a tag, while the
 *     variant title is the useless `Default Title`), then the variant
 *     title, then the description, then the honest 0 ml + ESTIMATED
 *     path.
 *
 * Measured egress conditions on this host (2026-10-07): outbound requests
 * are locally rate-limited (a non-JSON body comes back instead of the
 * feed) and Shopify itself 429s after ~6 rapid calls. The walk therefore
 * paces ~5 s between pages, treats a 429 page and a non-JSON body as a
 * failed fetch with ONE retry after a 30 s backoff, and STOPS at the
 * first collected (post-retry) page failure — a skipped page punches a
 * silent hole in the census, so the partial report prints and exits 1
 * (not trustworthy) instead of continuing. The 60-page hard cap from the
 * sweep plan measured too small in run 1 (60 full pages, 15,000 distinct
 * ids, zero failures — the catalog is larger than 15,000), so the bound
 * is raised to 120 pages (30,000 products); it stays a hard bound, never
 * an unbounded loop.
 *
 * Read-only: the script issues GET requests and nothing else — no
 * writes, no database, no state mutation anywhere.
 *
 * Usage (tsx from the data-platform workspace, per scripts/seed-d1.ts
 * convention — the path is relative to the package cwd):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/bottleofitaly-catalog-sweep.ts
 */

/** Shopify products.json page size maximum — also the walk's fixed page size. */
const PAGE_LIMIT = 250;

/** Spacing between page fetches — under the measured Shopify 429 threshold. */
const PAGE_PACE_MS = 5_000;

/** Backoff before the single retry of a 429 / non-JSON failed fetch. */
const RETRY_BACKOFF_MS = 30_000;

/**
 * Hard cap on walked pages — the unbounded-loop guard (no header bound
 * exists). Raised from the planned 60 after run 1 measured the catalog
 * larger than 15,000 products (60 full pages, zero failures); 120 pages
 * = 30,000 products is the new ceiling, still a hard bound.
 */
const MAX_PAGES = 120;

/** Per-request timeout — a hung connection is a failed fetch, not a hang. */
const FETCH_TIMEOUT_MS = 30_000;

const COLLECTION_URL = 'https://bottleofitaly.com/products.json';

/**
 * The `custom-gradazione-XX-X` tag form, matched as a substring per the
 * sweep spec (`/gradazione-(\d+)-(\d+)/i`) — the `custom-` prefix the
 * store admin adds is not part of the match. `40-0` → 40.0, `41-5` → 41.5.
 */
const TAG_ABV_PATTERN = /gradazione-(\d+)-(\d+)/i;

/**
 * Title volume token: `20cl`, `70cl`, `0,75 l`, `1.5L` — comma or dot
 * decimal, optional space, case-insensitive unit, word-bounded so
 * `5 Liter` and vintage years do not match.
 */
const TITLE_VOLUME_PATTERN = /(\d+[.,]?\d*)\s*(cl|ml|l)\b/i;

/** Samples printed per bucket — keeps the report readable. */
const SAMPLES_LIMIT = 8;

/**
 * The BOI `product_type` values the task-2.2 vocabulary will map to
 * canonical categories (probe census, EN). Everything else is merch or
 * unmapped → correction queue (design D3: Olio/Aceto deliberately
 * unmapped, never guessed).
 */
const CANDIDATE_BEVERAGE_TYPES: ReadonlyArray<string> = [
  'Spirits',
  'Vino Rosso',
  'Vino Bianco',
  'Vino Rosato',
  'Bollicine',
];

/** The merch pair the probe census measured (~36 % expected). */
const MERCH_TYPES: ReadonlyArray<string> = ['Olio', 'Aceto'];

// ---------------------------------------------------------------------------
// Shopify payload readers (narrowed from unknown — no schema trust)
// ---------------------------------------------------------------------------

interface ShopifyVariant {
  readonly title: string | null;
  readonly sku: string | null;
  readonly barcode: string | null;
  readonly grams: number | null;
  readonly price: string | null;
}

interface ShopifyProduct {
  readonly id: string;
  readonly title: string | null;
  readonly productType: string | null;
  readonly vendor: string | null;
  readonly tags: readonly string[];
  readonly bodyHtml: string | null;
  readonly variants: readonly ShopifyVariant[];
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readVariant(raw: unknown): ShopifyVariant {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    title: asTrimmedString(record['title']),
    sku: asTrimmedString(record['sku']),
    barcode: asTrimmedString(record['barcode']),
    grams: asNonNegativeNumber(record['grams']),
    price: asTrimmedString(record['price']),
  };
}

function readProduct(raw: unknown): ShopifyProduct {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const tags = Array.isArray(record['tags'])
    ? record['tags'].map(asTrimmedString).filter((t): t is string => t !== null)
    : typeof record['tags'] === 'string' && record['tags'].trim() !== ''
      ? record['tags'].split(',').map((t) => t.trim()).filter((t) => t !== '')
      : [];
  return {
    id: String(record['id'] ?? '(unknown)'),
    title: asTrimmedString(record['title']),
    productType: asTrimmedString(record['product_type']),
    vendor: asTrimmedString(record['vendor']),
    tags,
    bodyHtml: asTrimmedString(record['body_html']),
    variants: Array.isArray(record['variants']) ? record['variants'].map(readVariant) : [],
  };
}

function readProducts(payload: unknown): ShopifyProduct[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const products = (payload as Record<string, unknown>)['products'];
  return Array.isArray(products) ? products.map(readProduct) : null;
}

// ---------------------------------------------------------------------------
// Extraction prototypes (task 3.1 promotes these unchanged)
// ---------------------------------------------------------------------------

/** `gradazione-40-0` → 40.0; `gradazione-41-5` → 41.5; absent tag → null. */
function tagAbvOf(tags: readonly string[]): number | null {
  for (const tag of tags) {
    const match = TAG_ABV_PATTERN.exec(tag);
    if (match === null) continue;
    const abv = Number(match[1]) + Number(match[2]) / 10;
    if (Number.isFinite(abv) && abv > 0) return abv;
  }
  return null;
}

/**
 * A tag that IS a volume: `150cl`, `75cl`, `0,75 l` — anchored to the
 * full tag so `custom-gradazione-40-0` and `cantine-riunite` never match.
 * Discovered in sweep run 1: BOI wine carries its bottle size as a tag.
 */
const TAG_VOLUME_PATTERN = /^(\d+[.,]?\d*)\s*(cl|ml|l)$/i;

function tagVolumeMlOf(tags: readonly string[]): { readonly ml: number; readonly token: string } | null {
  for (const tag of tags) {
    const match = TAG_VOLUME_PATTERN.exec(tag);
    if (match === null) continue;
    const value = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) continue;
    const ml = value * unitFactorMl(match[2]);
    if (Number.isFinite(ml) && ml > 0) return { ml, token: tag };
  }
  return null;
}

function unitFactorMl(unit: string): number {
  const lowered = unit.toLowerCase();
  if (lowered === 'ml') return 1;
  if (lowered === 'cl') return 10;
  return 1000;
}

/** `70cl` → 700; `0,75 l` → 750; `1.5L` → 1500; no token → null. */
function volumeMlOf(text: string | null): { readonly ml: number; readonly token: string } | null {
  if (text === null) return null;
  const match = TITLE_VOLUME_PATTERN.exec(text);
  if (match === null) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const ml = value * unitFactorMl(match[2]);
  return Number.isFinite(ml) && ml > 0 ? { ml, token: match[0] } : null;
}

/** The full fallback chain a product can satisfy: title → tag → variant title → description. */
function hasVolumeSource(product: ShopifyProduct): boolean {
  return (
    volumeMlOf(product.title) !== null ||
    tagVolumeMlOf(product.tags) !== null ||
    product.variants.some((v) => volumeMlOf(v.title) !== null) ||
    volumeMlOf(product.bodyHtml) !== null
  );
}

// ---------------------------------------------------------------------------
// Sweep — sequential pages, short-page termination, one-retry failure policy
// ---------------------------------------------------------------------------

/** What one page fetch observed, across its one-or-two attempts. */
interface PageAttemptMeta {
  readonly attempts: number;
  readonly had429: boolean;
  readonly hadNonJson: boolean;
}
type PageOutcome =
  | ({ readonly kind: 'ok'; readonly products: readonly ShopifyProduct[] } & PageAttemptMeta)
  | ({ readonly kind: 'failure'; readonly reason: string } & PageAttemptMeta);

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchText(page: number): Promise<{ readonly status: number; readonly text: string }> {
  const response = await fetch(`${COLLECTION_URL}?limit=${PAGE_LIMIT}&page=${page}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await response.text();
  return { status: response.status, text };
}

/**
 * One page fetch with the single-retry policy: HTTP 429, a non-JSON body
 * (the local rate limiter's `local_rate_limited` page) and a thrown fetch
 * each back off 30 s and re-fetch once; a second failure — or any other
 * HTTP status, which gets no retry — is a collected failure, never a
 * throw and never an unbounded loop.
 */
async function fetchPage(page: number): Promise<PageOutcome> {
  const meta = { attempts: 0, had429: false, hadNonJson: false };
  const fail = (reason: string): PageOutcome => ({ kind: 'failure', reason, ...meta });
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      const cause = meta.had429 ? 'HTTP 429' : meta.hadNonJson ? 'non-JSON body' : 'fetch error';
      console.log(
        `[boi-sweep] page ${page} failed once (${cause}) — retrying after ${RETRY_BACKOFF_MS} ms backoff`,
      );
      await sleepMs(RETRY_BACKOFF_MS);
    }
    meta.attempts = attempt;
    let text: string;
    let status: number;
    try {
      const fetched = await fetchText(page);
      text = fetched.text;
      status = fetched.status;
    } catch (err) {
      if (attempt === 2) return fail(`fetch error: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (status === 429) {
      meta.had429 = true;
      continue;
    }
    if (status !== 200) return fail(`HTTP ${status}`);
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      meta.hadNonJson = true;
      continue;
    }
    const products = readProducts(payload);
    if (products === null) {
      meta.hadNonJson = true;
      continue;
    }
    return { kind: 'ok', products, ...meta };
  }
  return fail(
    meta.had429 ? 'HTTP 429 (after one 30 s retry)' : 'non-JSON body (after one 30 s retry)',
  );
}

interface SweepResult {
  readonly products: readonly ShopifyProduct[];
  readonly distinctIds: number;
  readonly pagesOk: number;
  readonly pageFailures: readonly string[];
  readonly http429Count: number;
  readonly nonJsonCount: number;
  readonly retriedPages: number;
  readonly recoveredRetries: number;
  readonly hitPageCap: boolean;
}

async function sweepCatalog(): Promise<SweepResult> {
  const products: ShopifyProduct[] = [];
  const ids = new Set<string>();
  const pageFailures: string[] = [];
  let pagesOk = 0;
  let http429Count = 0;
  let nonJsonCount = 0;
  let retriedPages = 0;
  let recoveredRetries = 0;
  let terminated = false;
  let hitPageCap = false;

  for (let page = 1; page <= MAX_PAGES && !terminated; page++) {
    if (page > 1) await sleepMs(PAGE_PACE_MS);
    const outcome = await fetchPage(page);
    if (outcome.had429) http429Count++;
    if (outcome.hadNonJson) nonJsonCount++;
    if (outcome.attempts > 1) {
      retriedPages++;
      if (outcome.kind === 'ok') {
        recoveredRetries++;
        console.log(`[boi-sweep] page ${page} recovered on the 30 s retry`);
      }
    }
    if (outcome.kind === 'failure') {
      pageFailures.push(`page ${page}: ${outcome.reason}`);
      // Stop-on-failure: page N+1 without page N is a silent hole in the
      // census. Print the partial report and exit 1 instead.
      terminated = true;
      break;
    }
    pagesOk++;
    products.push(...outcome.products);
    for (const product of outcome.products) ids.add(product.id);
    console.log(`[boi-sweep] page ${page}: ${outcome.products.length} products (total ${products.length})`);
    if (outcome.products.length < PAGE_LIMIT) {
      console.log(
        `[boi-sweep] page ${page} is short (${outcome.products.length} < ${PAGE_LIMIT}) — last page per short-page termination`,
      );
      terminated = true;
    } else if (page === MAX_PAGES) {
      hitPageCap = true;
    }
  }

  if (hitPageCap) {
    pageFailures.push(
      `hit the ${MAX_PAGES}-page hard cap with full pages — walk unbounded; catalog larger than ${MAX_PAGES * PAGE_LIMIT}?`,
    );
  }

  return {
    products,
    distinctIds: ids.size,
    pagesOk,
    pageFailures,
    http429Count,
    nonJsonCount,
    retriedPages,
    recoveredRetries,
    hitPageCap,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pct(part: number, whole: number): string {
  if (whole === 0) return 'n/a';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** Shopify variant prices are decimal strings ("25.90"); dot-decimal only. */
const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

function printReport(sweep: SweepResult): void {
  const { products } = sweep;
  const total = products.length;
  const variants = products.flatMap((p) => p.variants);

  console.log('');
  console.log('=== bottleofitaly.com full-catalog sweep (pre-onboarding audit) ===');
  console.log(`collection: ${COLLECTION_URL} (limit=${PAGE_LIMIT}, sequential, read-only)`);

  console.log('');
  console.log('-- Catalog walk --');
  console.log(
    `pages fetched ok: ${sweep.pagesOk} | products: ${total} | distinct product ids: ${sweep.distinctIds}` +
      ` | page failures: ${sweep.pageFailures.length} | hard cap hit: ${sweep.hitPageCap ? 'YES' : 'no'}`,
  );
  console.log(
    `429 responses seen: ${sweep.http429Count} | non-JSON bodies seen: ${sweep.nonJsonCount}` +
      ` | pages that needed the 30 s retry: ${sweep.retriedPages}`,
  );
  console.log(
    total !== sweep.distinctIds
      ? `WARNING: ${total - sweep.distinctIds} duplicate product ids across pages — pagination drift or catalog change mid-walk`
      : 'no duplicate product ids across pages',
  );
  for (const failure of sweep.pageFailures) {
    console.log(`page failure: ${failure}`);
  }

  console.log('');
  console.log('-- 1. product_type census (count + share) --');
  const typeCensus = new Map<string, number>();
  for (const product of products) {
    const key = product.productType ?? '(missing)';
    typeCensus.set(key, (typeCensus.get(key) ?? 0) + 1);
  }
  for (const [type, count] of [...typeCensus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  "${type}": ${count} (${pct(count, total)})`);
  }
  const merchCount = products.filter(
    (p) => p.productType !== null && MERCH_TYPES.includes(p.productType),
  ).length;
  console.log(
    `merch share (Olio+Aceto): ${merchCount} (${pct(merchCount, total)}) — deliberately unmapped per design D3, correction queue`,
  );
  const beverageCount = products.filter(
    (p) => p.productType !== null && CANDIDATE_BEVERAGE_TYPES.includes(p.productType),
  ).length;
  console.log(
    `candidate vocabulary (Spirits/Vino Rosso/Vino Bianco/Vino Rosato/Bollicine) covers: ${beverageCount} (${pct(beverageCount, total)})`,
  );

  console.log('');
  console.log('-- 2. tag-ABV share (custom-gradazione-XX-X → XX + X/10 %) --');
  const withTagAbv = products.filter((p) => tagAbvOf(p.tags) !== null);
  console.log(
    `products with tag ABV: ${withTagAbv.length} (${pct(withTagAbv.length, total)}) — ` +
      'the rest ingest ABV-null and follow the ESTIMATED/merch-drop paths',
  );

  console.log('');
  console.log('-- 3. title-volume share + fallback-rule outcomes (title → tag → variant title → description) --');
  const volumeBuckets = { title: 0, tag: 0, variantTitle: 0, description: 0, neither: 0 };
  const neitherSamples: string[] = [];
  const variantTitleSamples = new Set<string>();
  for (const product of products) {
    if (volumeMlOf(product.title) !== null) {
      volumeBuckets.title++;
      continue;
    }
    if (tagVolumeMlOf(product.tags) !== null) {
      volumeBuckets.tag++;
      continue;
    }
    const fromVariant = product.variants.some((v) => volumeMlOf(v.title) !== null);
    const fromDescription = volumeMlOf(product.bodyHtml) !== null;
    if (fromVariant) volumeBuckets.variantTitle++;
    else if (fromDescription) volumeBuckets.description++;
    else {
      volumeBuckets.neither++;
      if (neitherSamples.length < SAMPLES_LIMIT) neitherSamples.push(product.title ?? '(no title)');
    }
    for (const variantTitle of product.variants.map((v) => v.title)) {
      if (variantTitle !== null && variantTitleSamples.size < SAMPLES_LIMIT) {
        variantTitleSamples.add(variantTitle);
      }
    }
  }
  console.log(
    `volume from product title: ${volumeBuckets.title} (${pct(volumeBuckets.title, total)})`,
  );
  console.log(
    `of the misses — whole-tag volume fallback (e.g. tag "150cl") covers: ${volumeBuckets.tag} (${pct(volumeBuckets.tag, total)})`,
  );
  console.log(
    `of the misses — variant-title fallback covers: ${volumeBuckets.variantTitle} (${pct(volumeBuckets.variantTitle, total)})` +
      (volumeBuckets.variantTitle === 0
        ? ` — variant titles look like: ${[...variantTitleSamples].slice(0, 3).join(' | ')}`
        : ''),
  );
  console.log(
    `of the misses — description fallback covers: ${volumeBuckets.description} (${pct(volumeBuckets.description, total)})`,
  );
  console.log(
    `of the misses — no token anywhere (honest 0 ml + ESTIMATED bucket): ${volumeBuckets.neither} (${pct(volumeBuckets.neither, total)})`,
  );
  for (const sample of neitherSamples) {
    console.log(`  sample (no volume token): ${sample}`);
  }

  console.log('');
  console.log('-- 4. ABV × volume matrix (the neither bucket drives the 3.1 fallback decision) --');
  const matrix = { both: 0, abvOnly: 0, volumeOnly: 0, neither: 0 };
  const abvOnlySamples: string[] = [];
  for (const product of products) {
    const abv = tagAbvOf(product.tags) !== null;
    const volume = hasVolumeSource(product);
    if (abv && volume) matrix.both++;
    else if (abv) {
      matrix.abvOnly++;
      if (abvOnlySamples.length < SAMPLES_LIMIT) abvOnlySamples.push(product.title ?? '(no title)');
    } else if (volume) matrix.volumeOnly++;
    else matrix.neither++;
  }
  console.log(`ABV + volume: ${matrix.both} (${pct(matrix.both, total)})`);
  console.log(`ABV only (no volume): ${matrix.abvOnly} (${pct(matrix.abvOnly, total)})`);
  for (const sample of abvOnlySamples.slice(0, 5)) {
    console.log(`  sample (ABV only): ${sample}`);
  }
  console.log(`volume only (no ABV — expected: merch, dropped by category): ${matrix.volumeOnly} (${pct(matrix.volumeOnly, total)})`);
  console.log(`neither (ESTIMATED if a beverage; merch drop if Olio/Aceto): ${matrix.neither} (${pct(matrix.neither, total)})`);

  console.log('');
  console.log('-- 5. Variant coverage: barcode / SKU / grams / price sanity --');
  console.log(`variants total: ${variants.length} across ${total} products`);
  const withBarcode = variants.filter((v) => v.barcode !== null).length;
  const productsWithBarcode = products.filter((p) => p.variants.some((v) => v.barcode !== null)).length;
  console.log(`variants with non-empty barcode: ${withBarcode} (${pct(withBarcode, variants.length)}) | products with ≥1: ${productsWithBarcode} (${pct(productsWithBarcode, total)}) — probe expectation 0`);
  const withSku = variants.filter((v) => v.sku !== null).length;
  console.log(`variants with non-empty SKU: ${withSku} (${pct(withSku, variants.length)})`);
  const withGrams = variants.filter((v) => v.grams !== null && v.grams > 0).length;
  console.log(`variants with grams > 0: ${withGrams} (${pct(withGrams, variants.length)})`);
  const priceUnparseable = variants.filter((v) => v.price === null || !PRICE_PATTERN.test(v.price));
  console.log(
    priceUnparseable.length === 0
      ? `price sanity: all ${variants.length} variant prices are parseable decimal strings`
      : `price sanity: ${priceUnparseable.length} unparseable prices — ${priceUnparseable.slice(0, SAMPLES_LIMIT).map((v) => v.price ?? '(missing)').join(', ')}`,
  );
  const withVendor = products.filter((p) => p.vendor !== null).length;
  console.log(`products with non-empty vendor: ${withVendor} (${pct(withVendor, total)})`);
  const distinctVendors = new Set(products.map((p) => p.vendor ?? '(missing)'));
  console.log(`distinct vendors: ${[...distinctVendors].slice(0, SAMPLES_LIMIT).join(', ')}`);

  console.log('');
  console.log('-- 6. ESTIMATED-by-type preview (unparsed ABV or volume per product_type) --');
  for (const [type, count] of [...typeCensus.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    const ofType = products.filter((p) => (p.productType ?? '(missing)') === type);
    const estimated = ofType.filter(
      (p) => tagAbvOf(p.tags) === null || !hasVolumeSource(p),
    ).length;
    console.log(`  "${type}": ${estimated}/${count} estimated-eligible (${pct(estimated, count)})`);
  }

  console.log('');
  const ok = sweep.pageFailures.length === 0 && total > 0;
  console.log(
    ok
      ? '=== sweep COMPLETE — numbers above are the pre-onboarding report ==='
      : '=== sweep INCOMPLETE — page failures or an empty walk; do not trust the shares above ===',
  );
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[boi-sweep] bottleofitaly.com full-catalog sweep — read-only GETs, sequential pages, 5 s pacing');
  const sweep = await sweepCatalog();
  printReport(sweep);
}

main().catch((err: unknown) => {
  console.error(`[boi-sweep] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
