#!/usr/bin/env node
/**
 * kuhns.shop full-catalog read-only sweep (pre-onboarding audit; the
 * onboard-shopify-lmdw-merchants 1.2 playbook — the bottleofitaly sweep
 * walker applied to the second Shopify merchant, German extraction).
 *
 * The walk is Shopify `products.json`: sequential `?limit=250&page=N`
 * GETs with SHORT-PAGE termination — Shopify exposes no total-pages
 * header, so a page returning fewer products than the limit is the last
 * page and an empty page is normal termination (design D1). Extraction
 * is prototyped inline (task 3.2 promotes exactly this logic into
 * `kuhns.parser.ts`):
 *
 *   - ABV from the German title form `alc. 12 Vol.-%` (also `12,5` —
 *     comma decimal).
 *   - Volume from the title token (`0,75l`, `0,2l`, `1L` — comma
 *     decimal, bare `l` → ×1000), with the multipack token
 *     (`12 x 0,33 l`) taking precedence when present.
 *
 * Measured egress conditions on this host (2026-10-07): outbound requests
 * are locally rate-limited (a non-JSON body comes back instead of the
 * feed) and Shopify 429s after ~6 rapid calls. The walk therefore paces
 * ~5 s between pages, treats a 429 page and a non-JSON body as a failed
 * fetch with ONE retry after a 30 s backoff, hard-caps the walk at 60
 * pages, and STOPS at the first collected (post-retry) page failure —
 * a skipped page punches a silent hole in the census, so the partial
 * report prints and exits 1 (not trustworthy) instead of continuing.
 *
 * Read-only: the script issues GET requests and nothing else — no
 * writes, no database, no state mutation anywhere.
 *
 * Usage (tsx from the data-platform workspace, per scripts/seed-d1.ts
 * convention — the path is relative to the package cwd):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/kuhns-catalog-sweep.ts
 */

/** Shopify products.json page size maximum — also the walk's fixed page size. */
const PAGE_LIMIT = 250;

/** Spacing between page fetches — under the measured Shopify 429 threshold. */
const PAGE_PACE_MS = 5_000;

/** Backoff before the single retry of a 429 / non-JSON failed fetch. */
const RETRY_BACKOFF_MS = 30_000;

/** Hard cap on walked pages — the unbounded-loop guard (no header bound exists). */
const MAX_PAGES = 60;

/** Per-request timeout — a hung connection is a failed fetch, not a hang. */
const FETCH_TIMEOUT_MS = 30_000;

const COLLECTION_URL = 'https://kuhns.shop/products.json';

/**
 * German ABV title form: `alc. 12 Vol.-%`, `alc. 12,5 Vol.-%` — the
 * strict pattern task 3.2 promotes. A looser "vol mentioned but
 * unmatched" diagnostic below tells whether the strict form misses
 * variants (`% Vol`, `vol.%`…).
 */
const TITLE_ABV_PATTERN = /alc\.\s*(\d+[.,]?\d*)\s*Vol\.?-%/i;

/**
 * Title volume token: `0,75l`, `0,2l`, `1L`, `20cl` — comma/dot decimal,
 * optional space, case-insensitive unit, word-bounded so `1 Liter` and
 * vintage years do not match.
 */
const TITLE_VOLUME_PATTERN = /(\d+[.,]?\d*)\s*(cl|ml|l)\b/i;

/**
 * Multipack token: `12 x 0,33 l`, `20×0,5l` — takes precedence over the
 * single token (a 12-pack's `0,33 l` is per-unit, not the offer volume).
 */
const MULTIPACK_PATTERN = /(\d+)\s*[x×]\s*(\d+[.,]?\d*)\s*(ml|cl|l)/i;

/** Samples printed per bucket — keeps the report readable. */
const SAMPLES_LIMIT = 8;

/**
 * The kuhns `product_type` values already named by the task-2.2 plan
 * (`Wein`, `Bier`, `Sekt`, `Spirituosen`-shaped per census spelling).
 * The census below reports every distinct value so the vocabulary can be
 * trimmed from data; rows outside the mapped set → correction queue.
 */
const KNOWN_CATEGORY_KEYS: ReadonlyArray<string> = ['Wein', 'Bier', 'Sekt'];

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
  readonly variants: readonly ShopifyVariant[];
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
  return {
    id: String(record['id'] ?? '(unknown)'),
    title: asTrimmedString(record['title']),
    productType: asTrimmedString(record['product_type']),
    vendor: asTrimmedString(record['vendor']),
    variants: Array.isArray(record['variants']) ? record['variants'].map(readVariant) : [],
  };
}

function readProducts(payload: unknown): ShopifyProduct[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const products = (payload as Record<string, unknown>)['products'];
  return Array.isArray(products) ? products.map(readProduct) : null;
}

// ---------------------------------------------------------------------------
// Extraction prototypes (task 3.2 promotes these unchanged)
// ---------------------------------------------------------------------------

function commaToDot(value: string): number {
  return Number(value.replace(',', '.'));
}

function unitFactorMl(unit: string): number {
  const lowered = unit.toLowerCase();
  if (lowered === 'ml') return 1;
  if (lowered === 'cl') return 10;
  return 1000;
}

/** `alc. 12 Vol.-%` → 12; `alc. 12,5 Vol.-%` → 12.5; no token → null. */
function titleAbvOf(title: string | null): number | null {
  if (title === null) return null;
  const match = TITLE_ABV_PATTERN.exec(title);
  if (match === null) return null;
  const abv = commaToDot(match[1]);
  return Number.isFinite(abv) && abv > 0 ? abv : null;
}

/** `12 x 0,33 l` → per-unit 330 ml × 12 units; no multipack token → null. */
function multipackOf(
  title: string | null,
): { readonly perUnitMl: number; readonly units: number; readonly token: string } | null {
  if (title === null) return null;
  const match = MULTIPACK_PATTERN.exec(title);
  if (match === null) return null;
  const perUnitMl = commaToDot(match[2]) * unitFactorMl(match[3]);
  const units = Number(match[1]);
  if (!Number.isFinite(perUnitMl) || perUnitMl <= 0 || !Number.isFinite(units) || units <= 0) {
    return null;
  }
  return { perUnitMl, units, token: match[0] };
}

/** `0,75l` → 750; `0,2 l` → 200; `1L` → 1000; no token → null. */
function volumeMlOf(title: string | null): { readonly ml: number; readonly token: string } | null {
  if (title === null) return null;
  const match = TITLE_VOLUME_PATTERN.exec(title);
  if (match === null) return null;
  const ml = commaToDot(match[1]) * unitFactorMl(match[2]);
  return Number.isFinite(ml) && ml > 0 ? { ml, token: match[0] } : null;
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
        `[kuhns-sweep] page ${page} failed once (${cause}) — retrying after ${RETRY_BACKOFF_MS} ms backoff`,
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
        console.log(`[kuhns-sweep] page ${page} recovered on the 30 s retry`);
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
    console.log(
      `[kuhns-sweep] page ${page}: ${outcome.products.length} products (total ${products.length})`,
    );
    if (outcome.products.length < PAGE_LIMIT) {
      console.log(
        `[kuhns-sweep] page ${page} is short (${outcome.products.length} < ${PAGE_LIMIT}) — last page per short-page termination`,
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

/** EAN-shaped SKU — the only shape the platform may ever treat as an EAN. */
const BARE13_PATTERN = /^\d{13}$/;

function printReport(sweep: SweepResult): void {
  const { products } = sweep;
  const total = products.length;
  const variants = products.flatMap((p) => p.variants);

  console.log('');
  console.log('=== kuhns.shop full-catalog sweep (pre-onboarding audit) ===');
  console.log(`collection: ${COLLECTION_URL} (limit=${PAGE_LIMIT}, sequential, read-only)`);

  console.log('');
  console.log('-- Catalog walk --');
  console.log(
    `pages fetched ok: ${sweep.pagesOk} | products: ${total} | distinct product ids: ${sweep.distinctIds}` +
      ` | page failures: ${sweep.pageFailures.length} | hard cap hit: ${sweep.hitPageCap ? 'YES' : 'no'}`,
  );
  console.log(
    `429 responses seen: ${sweep.http429Count} | non-JSON bodies seen: ${sweep.nonJsonCount}` +
      ` | pages that needed the 30 s retry: ${sweep.retriedPages} (recovered: ${sweep.recoveredRetries})`,
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
  const knownCount = products.filter(
    (p) => p.productType !== null && KNOWN_CATEGORY_KEYS.includes(p.productType),
  ).length;
  console.log(
    `known vocabulary keys (Wein/Bier/Sekt) cover: ${knownCount} (${pct(knownCount, total)})` +
      ' — the remaining distinct values above are the 2.2 key-trimming input',
  );

  console.log('');
  console.log('-- 2. German title parse shares --');
  const withAbv = products.filter((p) => titleAbvOf(p.title) !== null);
  console.log(`ABV parsed from title (alc. N Vol.-%): ${withAbv.length} (${pct(withAbv.length, total)})`);
  const volMentioning = products.filter((p) => p.title !== null && /vol/i.test(p.title)).length;
  const abvMentionsUnmatched = volMentioning - withAbv.length;
  console.log(
    `titles mentioning "vol" but unmatched by the strict pattern: ${abvMentionsUnmatched}` +
      ` (of ${volMentioning} mentioning vol) — variant-title-form risk for 3.2`,
  );
  for (const product of products
    .filter((p) => p.title !== null && /vol/i.test(p.title) && titleAbvOf(p.title) === null)
    .slice(0, SAMPLES_LIMIT)) {
    console.log(`  sample (vol mentioned, strict pattern missed): ${product.title}`);
  }
  const multipackTitles = products.filter((p) => multipackOf(p.title) !== null);
  console.log(
    `multipack tokens (N x 0,33 l): ${multipackTitles.length} (${pct(multipackTitles.length, total)})`,
  );
  for (const product of multipackTitles.slice(0, SAMPLES_LIMIT)) {
    const pack = multipackOf(product.title);
    console.log(
      `  sample multipack: "${product.title}" → ${pack !== null ? `${pack.units} × ${pack.perUnitMl} ml` : '?'}`,
    );
  }
  const withVolumeSingle = products.filter(
    (p) => volumeMlOf(p.title) !== null && multipackOf(p.title) === null,
  ).length;
  console.log(
    `volume from title (single token): ${withVolumeSingle} (${pct(withVolumeSingle, total)})` +
      ` | via multipack: ${multipackTitles.length} (${pct(multipackTitles.length, total)})`,
  );
  const volumeMisses = total - withVolumeSingle - multipackTitles.length;
  const volumeMissSamples = products
    .filter((p) => volumeMlOf(p.title) === null && multipackOf(p.title) === null)
    .slice(0, SAMPLES_LIMIT);
  console.log(`volume unparsed from title: ${volumeMisses} (${pct(volumeMisses, total)})`);
  for (const product of volumeMissSamples) {
    console.log(`  sample (no volume token): ${product.title ?? '(no title)'}`);
  }

  console.log('');
  console.log('-- 3. ESTIMATED share (ABV or volume unparsed — the alks discipline) --');
  const estimated = products.filter(
    (p) => titleAbvOf(p.title) === null || (volumeMlOf(p.title) === null && multipackOf(p.title) === null),
  ).length;
  const bothMissing = products.filter(
    (p) => titleAbvOf(p.title) === null && volumeMlOf(p.title) === null && multipackOf(p.title) === null,
  ).length;
  console.log(`ABV unparsed: ${total - withAbv.length} (${pct(total - withAbv.length, total)})`);
  console.log(`volume unparsed: ${volumeMisses} (${pct(volumeMisses, total)})`);
  console.log(`both unparsed: ${bothMissing} (${pct(bothMissing, total)})`);
  console.log(`ESTIMATED (either unparsed): ${estimated} (${pct(estimated, total)})`);
  for (const product of products
    .filter(
      (p) => titleAbvOf(p.title) === null || (volumeMlOf(p.title) === null && multipackOf(p.title) === null),
    )
    .slice(0, SAMPLES_LIMIT)) {
    const abvParsed = titleAbvOf(product.title) !== null;
    const volumeParsed = volumeMlOf(product.title) !== null || multipackOf(product.title) !== null;
    const missing = !abvParsed && !volumeParsed ? 'ABV+volume' : !abvParsed ? 'ABV' : 'volume';
    console.log(`  sample (missing ${missing}): ${product.title ?? '(no title)'}`);
  }

  console.log('');
  console.log('-- 4. ESTIMATED-by-type preview (top 10 product_type values) --');
  for (const [type, count] of [...typeCensus.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    const ofType = products.filter((p) => (p.productType ?? '(missing)') === type);
    const ofTypeEstimated = ofType.filter(
      (p) =>
        titleAbvOf(p.title) === null ||
        (volumeMlOf(p.title) === null && multipackOf(p.title) === null),
    ).length;
    console.log(`  "${type}": ${ofTypeEstimated}/${count} ESTIMATED (${pct(ofTypeEstimated, count)})`);
  }

  console.log('');
  console.log('-- 5. Variant coverage: barcode / SKU / grams / price sanity --');
  console.log(`variants total: ${variants.length} across ${total} products`);
  const withBarcode = variants.filter((v) => v.barcode !== null).length;
  const productsWithBarcode = products.filter((p) => p.variants.some((v) => v.barcode !== null)).length;
  console.log(
    `variants with non-empty barcode: ${withBarcode} (${pct(withBarcode, variants.length)}) | products with ≥1: ${productsWithBarcode} (${pct(productsWithBarcode, total)})`,
  );
  const withSku = variants.filter((v) => v.sku !== null);
  console.log(`variants with non-empty SKU: ${withSku.length} (${pct(withSku.length, variants.length)})`);
  const skuBare13 = withSku.filter((v) => BARE13_PATTERN.test(v.sku ?? '')).length;
  console.log(
    `SKUs matching bare 13-digit (EAN-shaped): ${skuBare13} — probe expectation ~0 (ML9500-shaped internal codes stay EAN-less)`,
  );
  const skuSamples = [...new Set(withSku.map((v) => v.sku ?? ''))].slice(0, SAMPLES_LIMIT);
  for (const sample of skuSamples) {
    console.log(`  sample SKU: ${sample}`);
  }
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
  console.log(
    `distinct vendors: ${[...new Set(products.map((p) => p.vendor ?? '(missing)'))].slice(0, SAMPLES_LIMIT).join(', ')}`,
  );

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
  console.log('[kuhns-sweep] kuhns.shop full-catalog sweep — read-only GETs, sequential pages, 5 s pacing');
  const sweep = await sweepCatalog();
  printReport(sweep);
}

main().catch((err: unknown) => {
  console.error(`[kuhns-sweep] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
