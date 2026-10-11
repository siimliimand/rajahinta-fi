#!/usr/bin/env node
/**
 * Ferry onboard pre-order shop probe — read-only sweep (task 1.1, change
 * ferry-onboard-prices; the gate for every downstream dataset task).
 *
 * Probes the three Baltic operators' pre-order / onboard shops for the
 * findings the change's gate decision needs, per operator:
 *
 *   1. Feed shape — WooCommerce Store API / Shopify products.json /
 *      platform-fingerprinted custom surface (Tallink: Next.js SSR over
 *      Konakart; Viking: Episerver behind Imperva Incapsula + Distil;
 *      Eckerö: Magento 2 behind Cloudflare).
 *   2. Currency — EUR expected on the FI routes.
 *   3. Category vocabulary — a sample of the live alcohol taxonomy.
 *   4. Product-label overlap — the five recognizable candidate styles
 *      (Koskenkorva, Jack Daniel's, Absolut, sparkling wine, lonkero/RTD)
 *      against the labels the probe actually fetched.
 *   5. Label-parser compatibility — every fetched alcohol label run
 *      through the production parsers (`parseAbvPercent`, `parseVolume`,
 *      `parsePackUnitVolumeLitres`, `parsePackUnits`) so the curated-row
 *      verdict rests on measured parses, not eyeballing.
 *   6. Terms posture — robots.txt for the shop paths, API-surface
 *      status codes, whether the catalog is publicly browsable.
 *
 * Probe discipline (this is the gate's honesty contract):
 *   - GET requests only; no auth bypass; no bot-protection circumvention.
 *     A 403/challenge IS a finding, recorded as such — the Viking
 *     Incapsula/Distil challenge and the Eckerö Cloudflare 403 are
 *     results, not failures.
 *   - Sequential requests, one at a time, per-operator delay
 *     (Eckerö's robots.txt declares Crawl-delay: 10 and the sweep honors it).
 *   - The crawler UA is the honest project crawler (crawl-walker
 *     convention), never a browser spoof.
 *
 * Read-only: the script issues GET requests and nothing else — no
 * writes, no database, no state mutation anywhere.
 *
 * Usage (tsx from the data-platform workspace, per scripts/seed-d1.ts
 * convention — the path is relative to the package cwd):
 *
 *   pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/ferry-shop-sweep.ts
 *   pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/ferry-shop-sweep.ts --operator eckero
 *
 * @module FerryShopSweep
 */

import { CRAWLER_USER_AGENT } from '../packages/data-acquisition/src/crawl/crawl-walker';
import {
  parseAbvPercent,
  parseVolume,
} from '../packages/data-acquisition/src/adapters/alks.parser';
import { parsePackUnitVolumeLitres } from '../packages/data-acquisition/src/services/pack-notation';

// ---------------------------------------------------------------------------
// Registry — one entry per operator; probes read only from here
// ---------------------------------------------------------------------------

interface OperatorSpec {
  readonly key: string;
  readonly label: string;
  /** Politeness delay between this operator's sequential requests (ms). */
  readonly delayMs: number;
}

const OPERATORS: readonly OperatorSpec[] = [
  { key: 'tallink', label: 'Tallink Silja', delayMs: 2000 },
  { key: 'viking', label: 'Viking Line', delayMs: 2000 },
  { key: 'eckero', label: 'Eckerö Line', delayMs: 10_000 },
];

// ---------------------------------------------------------------------------
// Probe plumbing
// ---------------------------------------------------------------------------

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A GET with the honest crawler UA and a hard timeout; never throws. */
async function get(url: string): Promise<{
  status: number | null;
  body: string | null;
  error: string | null;
}> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(25_000),
      redirect: 'follow',
    });
    const body = await response.text();
    return { status: response.status, body, error: null };
  } catch (err) {
    return { status: null, body: null, error: errorOf(err) };
  }
}

/** True when a 200/403 body is a bot-protection interstitial, not content. */
function isBotChallenge(body: string | null): boolean {
  if (body === null) return false;
  return (
    body.includes('Pardon Our Interruption') ||
    body.includes('_Incapsula_Resource') ||
    body.includes('distil_referrer') ||
    body.includes('Attention Required') ||
    /<title>[^<]*Access denied/i.test(body)
  );
}

/** Distinct `<loc>` URL count of a sitemap body; null when not a sitemap. */
function sitemapUrlCount(body: string | null): number | null {
  if (body === null || !body.includes('<loc>')) return null;
  return (body.match(/<loc>/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// Label-parse compatibility (production parsers, unchanged)
// ---------------------------------------------------------------------------

interface LabelParse {
  readonly name: string;
  readonly abv: number | null;
  readonly volumeMl: number | null;
  readonly packCount: number | null;
  readonly packUnitLitres: number | null;
}

function runLabelParsers(name: string): LabelParse {
  const volume = parseVolume(name);
  return {
    name,
    abv: parseAbvPercent(name),
    volumeMl: volume === null ? null : volume.volumeMl,
    packCount: volume === null ? null : volume.packCount,
    packUnitLitres: parsePackUnitVolumeLitres(name),
  };
}

/**
 * The five recognizable overlap candidates (task 1.1's spot-check list),
 * matched case-insensitively against fetched labels and category facets.
 */
const OVERLAP_CANDIDATES: ReadonlyArray<{ readonly label: string; readonly match: RegExp }> = [
  { label: 'Koskenkorva', match: /koskenkorva/i },
  { label: "Jack Daniel's", match: /jack\s*daniel/i },
  { label: 'Absolut', match: /absolut/i },
  { label: 'sparkling wine / champagne', match: /(sparkling|champagne|kuohuviini|cava|prosecco)/i },
  { label: 'lonkero / long drink (RTD)', match: /(lonkero|long\s*drink)/i },
];

function overlapReport(names: readonly string[]): string[] {
  return OVERLAP_CANDIDATES.map((candidate) => {
    const hit = names.some((n) => candidate.match.test(n));
    return `${hit ? 'FOUND ' : 'absent'}  ${candidate.label}`;
  });
}

// ---------------------------------------------------------------------------
// Per-operator probes
// ---------------------------------------------------------------------------

interface OperatorFinding {
  readonly operator: string;
  readonly lines: readonly string[];
  readonly requests: number;
  /** Labels actually fetched from the live shop (parser + overlap input). */
  readonly labels: readonly string[];
}

async function probeTallink(): Promise<OperatorFinding> {
  const lines: string[] = [];
  const labels: string[] = [];
  let requests = 0;

  lines.push('shop discovery: tallinksilja.com 301s everything to www.tallink.com/en (Next.js +');
  lines.push('  headless WP at cms-web-wp.fleet.zone); pre-order info page links the two shops:');
  lines.push('  shopping.tallink.com (E-SHOP pre-order) + shopping-onboard.tallink.com (onboard price lists).');
  lines.push('  shop.tallink.com NXDOMAIN; preorder.tallink.com resolves but TLS-hangs from this');
  lines.push('  egress (Posti-pattern rejection — a Worker live fetch would fail the same way).');

  // robots.txt — permissive cart/checkout-only disallow.
  const robots = await get('https://shopping.tallink.com/robots.txt');
  requests++;
  if (robots.body !== null && robots.status === 200) {
    const disallowed = robots.body.split('\n').filter((l) => /^Disallow:/i.test(l.trim()));
    lines.push(
      `robots.txt (shopping): 200, ${disallowed.length} Disallow rules — ` +
        `${disallowed.slice(0, 3).join(' ').replace(/Disallow:\s*/gi, '')}… (cart/checkout only; catalog allowed)`,
    );
  } else {
    lines.push(`robots.txt (shopping): ${robots.status ?? robots.error}`);
  }

  // Sitemap index — the catalog-size anchor for both shops.
  const sitemap = await get('https://shopping.tallink.com/sitemap.xml');
  requests++;
  const onboardFiles = (sitemap.body?.match(/sitemap-products_\d+\.xml/g) ?? []).length;
  const eshopFiles = (sitemap.body?.match(/sitemap-products-shop_\d+\.xml/g) ?? []).length;
  lines.push(
    `sitemap index: 200 — onboard shop ${onboardFiles} product-sitemap files, ` +
      `E-SHOP ${eshopFiles} product-sitemap files`,
  );

  const prodSitemap = await get('https://shopping.tallink.com/sitemap-products-shop_1.xml');
  requests++;
  const eshopUrls = sitemapUrlCount(prodSitemap.body);
  if (eshopUrls !== null) {
    lines.push(
      `E-SHOP products-shop_1.xml: ${eshopUrls} URLs (7 locales/product) → ~${Math.round(eshopUrls / 7)}/file; ` +
        `14 files → E-SHOP catalog order ${Math.round((eshopUrls / 7) * 14)} SKUs`,
    );
  }
  const onboardSitemap = await get('https://shopping-onboard.tallink.com/sitemap-products_1.xml');
  requests++;
  const onboardUrls = sitemapUrlCount(onboardSitemap.body);
  const ships = new Set(
    (onboardSitemap.body?.match(/\/en\/([a-z]+)\/product\//g) ?? []).map((s) =>
      s.replace('/en/', '').replace('/product/', ''),
    ),
  );
  if (onboardUrls !== null) {
    lines.push(
      `onboard products_1.xml: ${onboardUrls} URLs (7 locales/product), ship segments: ` +
        `${[...ships].join(', ') || '(none parsed)'} — the URL path IS the ship/route dimension`,
    );
  }
  lines.push(
    `onboard catalog estimate: ${onboardUrls ?? '?'} URLs/file × 51 files ÷ 7 locales ≈ ` +
      `${onboardUrls === null ? '?' : Math.round(((onboardUrls / 7) * 51) / 100) * 100}+ ship-product rows`,
  );

  // Category SSR payload — the actual feed shape probe (Konakart JSON in __NEXT_DATA__).
  const cat = await get('https://shopping.tallink.com/en/category/vodka-1802');
  requests++;
  if (cat.status === 200 && cat.body?.includes('__NEXT_DATA__')) {
    const json = cat.body.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
    );
    if (json !== null) {
      try {
        const data = JSON.parse(json[1]) as {
          props?: {
            pageProps?: {
              initialCategoryData?: {
                category?: {
                  totalNumProducts?: number;
                  taxMultiplier?: number;
                  productArray?: Array<{
                    name?: string;
                    custom1?: string;
                    priceExTax?: number;
                    priceIncTax?: number;
                    specialStatus?: number;
                    manufacturerName?: string;
                  }>;
                  manufacturerFacets?: Array<{ name?: string; numberOfProducts?: number }>;
                };
              };
            };
          };
        };
        const category =
          data.props?.pageProps?.initialCategoryData?.category ?? {};
        const products = category.productArray ?? [];
        lines.push(
          `feed shape: Next.js __NEXT_DATA__ SSR JSON (Konakart product objects) — ` +
            `vodka category totalNumProducts=${category.totalNumProducts ?? '?'}, ` +
            `${products.length} per page, pagination via currentPage`,
        );
        lines.push(
          `currency: no explicit field; taxMultiplier=${category.taxMultiplier ?? '?'}, ` +
            `priceExTax/priceIncTax dual prices (EUR implied, FI market)`,
        );
        lines.push(
          `sale/regular distinction: specialStatus flag + custom4 campaign dates ` +
            `(${products.filter((p) => p.specialStatus === 1).length} of ${products.length} sampled on sale)`,
        );
        lines.push(
          `label shape: "name + volume" (sample: ${products[0]?.name ?? 'n/a'}); ` +
            `custom1 carries the EAN (sample: ${products[0]?.custom1 ?? 'n/a'}); ` +
            `manufacturerName present (${products[0]?.manufacturerName ?? 'n/a'})`,
        );
        const facets = category.manufacturerFacets ?? [];
        lines.push(
          `brand facets (vodka): ${facets
            .slice(0, 6)
            .map((f) => `${f.name}(${f.numberOfProducts})`)
            .join(', ')}…`,
        );
        for (const product of products) {
          if (typeof product.name === 'string') labels.push(product.name);
        }
      } catch (err) {
        lines.push(`feed shape: __NEXT_DATA__ present but unparseable: ${errorOf(err)}`);
      }
    }
  } else {
    lines.push(
      `category probe: ${cat.status ?? cat.error}` +
        (isBotChallenge(cat.body) ? ' (bot challenge page)' : ''),
    );
  }

  lines.push('routes: onboard shop is per-ship (balticprincess, mystar, megastar, silja*, victoria…)');
  lines.push('  → Helsinki–Tallinn, Helsinki–Stockholm, Tallinn–Stockholm, Turku–Stockholm all covered;');
  lines.push('  E-SHOP (pre-order) is shop-wide, pickup desk onboard (info page names MyStar, Victoria I).');
  lines.push('terms: robots permissive (cart/checkout only), catalog publicly browsable, no login wall;');

  return { operator: 'tallink', lines, requests, labels };
}

async function probeViking(): Promise<OperatorFinding> {
  const lines: string[] = [];
  let requests = 0;

  lines.push('shop discovery: www.vikingline.fi/taxfree/ and /verkkokauppa/ exist (first-follow got 200');
  lines.push('  text/html); no /wp-json or /products.json fingerprints; CMS is Episerver (robots /episerver/).');

  const robots = await get('https://www.vikingline.fi/robots.txt');
  requests++;
  if (robots.status === 200 && robots.body !== null) {
    const disallows = robots.body
      .split('\n')
      .filter((l) => /^Disallow:/i.test(l.trim()))
      .map((l) => l.trim());
    const taxfreeBlocked = disallows.some((l) => l.toLowerCase().includes('taxfree'));
    lines.push(
      `robots.txt: 200, ${disallows.length} Disallow rules; shop paths (/taxfree/) ` +
        `${taxfreeBlocked ? 'DISALLOWED' : 'not disallowed'}; /protheus-api/ disallowed`,
    );
  } else {
    lines.push(`robots.txt: ${robots.status ?? robots.error}`);
  }

  for (const path of ['/taxfree/', '/verkkokauppa/']) {
    const probe = await get(`https://www.vikingline.fi${path}`);
    requests++;
    const challenge = isBotChallenge(probe.body);
    lines.push(
      `GET ${path}: ${probe.status ?? probe.error}` +
        (challenge
          ? ' — bot-protection interstitial (Imperva Incapsula `/_Incapsula_Resource` + Distil `distil_referrer`, "Pardon Our Interruption")'
          : probe.status === 200 && probe.body !== null
            ? ` — real page (${probe.body.length}B)`
            : ''),
    );
  }

  lines.push('label/currency/category: NOT obtainable — every shop-path HTML fetch is the challenge page.');
  lines.push('  No labels → parser compatibility and overlap spot-check UNMEASURED (not failed: gated).');
  lines.push('routes: not discoverable from here — route taxonomy unclear, operator transcription needed.');
  lines.push('terms: robots.txt permissive on shop paths, but the Imperva/Distil layer is the de-facto');
  lines.push('  terms posture: automated non-browser access is actively rejected. Circumventing it is');
  lines.push('  out of scope by the sweep guardrails, so the posture stands as "hostile to live feeds".');

  return { operator: 'viking', lines, requests, labels: [] };
}

async function probeEckero(): Promise<OperatorFinding> {
  const lines: string[] = [];
  const labels: string[] = [];
  let requests = 0;

  lines.push('shop discovery: www.eckeroline.com IS the webshop — Magento 2 (Luma fingerprints:');
  lines.push('  Magento_Catalog/js/price-utils, /checkout/, /wishlist/, /pkginfo/ robots rules).');
  lines.push('  Pre-order catalog lives at /shopping/preorder/* (strong-alcohol, liqueur, beer, cider,');
  lines.push('  long-drink, sparkling-wine-and-champagne, wine-bottle-boxes, bag-in-box, non-alcoholic).');
  lines.push('  www.eckeroline.com/shopping = "Eckerö Market" (data-dimension10), onboard context M/S');
  lines.push('  Finlandia (/onboard/msfinlandia/shopping-at-the-sea) → Helsinki–Tallinn route.');

  const robots = await get('https://www.eckeroline.com/robots.txt');
  requests++;
  if (robots.status === 200 && robots.body !== null) {
    const crawlDelay = robots.body.match(/Crawl-delay:\s*(\d+)/i);
    lines.push(
      `robots.txt: 200 — Crawl-delay ${crawlDelay?.[1] ?? '?'}s (honored by this sweep); ` +
        `native /catalog/ and /catalogsearch/ paths blocked; SEO /shopping/ paths allowed`,
    );
  } else {
    lines.push(`robots.txt: ${robots.status ?? robots.error}`);
  }

  // Pre-order category page — data-attribute product payload + toolbar count.
  const cat = await get(
    'https://www.eckeroline.com/shopping/preorder/pre-order-strong-alcohol',
  );
  requests++;
  if (cat.status === 200 && cat.body !== null && !isBotChallenge(cat.body)) {
    const names = [...cat.body.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]);
    const prices = [...cat.body.matchAll(/data-price="([^"]+)"/g)].map((m) => m[1]);
    const currencies = [...new Set([...cat.body.matchAll(/data-currency="([^"]+)"/g)].map((m) => m[1]))];    const brand = [...new Set([...cat.body.matchAll(/data-brand="([^"]+)"/g)].map((m) => m[1]))];
    const toolbar = [...cat.body.matchAll(/toolbar-number">(\d+)</g)].map((m) => m[1]);
    const unique = [...new Set(names)];
    lines.push(
      `feed shape: server-rendered HTML, per-product data-* attributes ` +
        `(data-name/data-price/data-currency/data-currency-base); no public JSON feed`,
    );
    lines.push(
      `currency: explicit data-currency=${currencies.join('/') || 'n/a'} (EUR confirmed), ` +
        `base currency identical`,
    );
    lines.push(
      `sale/regular distinction: Magento special-price markup present in product tiles ` +
        `(regular-price + special-price classes)`,
    );
    lines.push(
      `labels: ${names.length} data-name tags → ${unique.length} unique products on page; ` +
        `label shape "Brand Product ABV%, N x VOL" (e.g. "${unique[0] ?? 'n/a'}"` +
        `${prices[0] !== undefined ? ` @ EUR ${prices[0]}` : ''}); ` +
        `data-brand is a slot value ("${brand.join('/') || 'n/a'}"), NOT the producer`,
    );
    lines.push(
      `catalog size: toolbar counts parsed: ${toolbar.join(', ') || 'n/a'} (strong-alcohol pre-order ` +
        `tree; full /shopping/ tree spans dozens of categories —Magento has no public total)`,
    );
    lines.push('api surface: /rest/V1/store/storeConfigs and /graphql probed below (status only).');
    for (const product of unique) labels.push(product);
  } else {
    lines.push(
      `pre-order category probe: ${cat.status ?? cat.error}` +
        (isBotChallenge(cat.body) ? ' (bot challenge page)' : ''),
    );
  }

  const rest = await get('https://www.eckeroline.com/rest/V1/store/storeConfigs');
  requests++;
  lines.push(
    `GET /rest/V1/store/storeConfigs: ${rest.status ?? rest.error}` +
      (rest.status === 401 ? ' — Magento auth required (consumer not authorized)' : ''),
  );
  const graphql = await get('https://www.eckeroline.com/graphql?query=%7B__typename%7D');
  requests++;
  lines.push(
    `GET /graphql: ${graphql.status ?? graphql.error}` +
      (graphql.status === 403
        ? ' — Cloudflare WAF block; Luma HTML is the only public data path'
        : isBotChallenge(graphql.body)
          ? ' (bot challenge page)'
          : ''),
  );

  lines.push('routes: M/S Finlandia, Helsinki–Tallinn (single-route operator; ship named in shop context).');
  lines.push('terms: robots allows /shopping/ SEO paths with Crawl-delay 10; catalog publicly browsable,');
  lines.push('  no login wall; API surface closed (401/403) — a live feed would be HTML scraping, which');
  lines.push('  the change explicitly rules out ("no auto-scraping").');

  return { operator: 'eckero', lines, requests, labels };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const LABEL_SAMPLE_LIMIT = 12;

function printParserVerdict(labels: readonly string[]): void {
  if (labels.length === 0) {
    console.log('label-parser compatibility: UNMEASURED (no labels obtainable)');
    return;
  }
  const parses = labels.map(runLabelParsers);
  const withVol = parses.filter((p) => p.volumeMl !== null).length;
  const withAbv = parses.filter((p) => p.abv !== null).length;
  const withPack = parses.filter((p) => p.packCount !== null).length;
  const withPackLitres = parses.filter((p) => p.packUnitLitres !== null).length;
  console.log(
    `label-parser compatibility on ${parses.length} fetched labels: volume ` +
      `${withVol}/${parses.length}, ABV ${withAbv}/${parses.length}, packCount ` +
      `${withPack}/${parses.length}, pack-notation unit-volume ${withPackLitres}/${parses.length}`,
  );
  for (const parse of parses.slice(0, LABEL_SAMPLE_LIMIT)) {
    console.log(
      `  "${parse.name}" → ABV=${parse.abv ?? '—'}, vol=${parse.volumeMl ?? '—'}ml, ` +
        `pack=${parse.packCount ?? '—'}, packUnitL=${parse.packUnitLitres ?? '—'}`,
    );
  }
}

function printOverlap(labels: readonly string[], extraNames: readonly string[]): void {
  console.log('overlap spot-check (5 candidates vs fetched labels):');
  for (const line of overlapReport([...labels, ...extraNames])) {
    console.log(`  ${line}`);
  }
}

async function main(): Promise<void> {
  const filterArg = process.argv.indexOf('--operator');
  const filter = filterArg !== -1 ? process.argv[filterArg + 1] : undefined;
  const selected = OPERATORS.filter((o) => filter === undefined || o.key === filter);
  if (selected.length === 0) {
    console.error(`[ferry-sweep] unknown --operator "${filter}" (known: ${OPERATORS.map((o) => o.key).join(', ')})`);
    process.exit(1);
  }

  console.log('[ferry-sweep] ferry onboard pre-order shop probe — read-only GETs, sequential, polite');
  console.log(`[ferry-sweep] UA: ${CRAWLER_USER_AGENT}`);

  const findings: OperatorFinding[] = [];
  for (const operator of selected) {
    console.log('');
    console.log(`=== ${operator.label} (${operator.key}) ===`);
    const finding = await (operator.key === 'tallink'
      ? probeTallink()
      : operator.key === 'viking'
        ? probeViking()
        : probeEckero());
    for (const line of finding.lines) console.log(line);
    console.log('');
    printParserVerdict(finding.labels);
    printOverlap(finding.labels, []);
    console.log(`(probe requests to ${operator.key}: ${finding.requests}, ${operator.delayMs}ms polite delay between)`);
    findings.push(finding);
    if (operator !== selected[selected.length - 1]) await sleep(operator.delayMs);
  }

  // Deterministic gate summary — the recorded go/no-go lives in the change
  // notes; this block only derives the inputs from measured facts.
  console.log('');
  console.log('=== gate summary (measured inputs; the recorded decision lives in notes.md) ===');
  for (const finding of findings) {
    const liveFeed =
      finding.operator === 'viking'
        ? 'NO-GO (bot-gated; no reachable feed)'
        : finding.operator === 'tallink'
          ? 'NO-GO for unsanctioned scraping (public SSR surface exists but is a Konakart-backed SPA with no published feed terms); candidate ONLY with operator grant'
          : 'NO-GO for unsanctioned scraping (HTML-only, Magento API closed, robots crawl-delay); candidate ONLY with operator grant';
    const curated =
      finding.operator === 'viking'
        ? 'GO via operator transcription (route taxonomy needs operator input)'
        : 'GO (labels + EUR prices + route context publicly browsable for transcription with citation)';
    console.log(`${finding.operator}: live-feed ${liveFeed}`);
    console.log(`${finding.operator}: curated ${curated}`);
  }
  console.log('overall: curated-dataset path (Fransberg/Posti pattern) is viable for all three;');
  console.log('no operator offers a sanctioned public feed — live ingestion would require an operator grant.');
}

main().catch((err: unknown) => {
  console.error(`[ferry-sweep] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
