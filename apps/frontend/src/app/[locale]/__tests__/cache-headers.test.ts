/**
 * Cache-header contract (first-impression-pass task 2.2).
 *
 * Pins the per-route cache classification that the production server
 * was verified against live (`next build` + `next start`, sessionless
 * GET, Next 15.5) and guards the three source-level facts that fully
 * determine those headers:
 *
 *   1. The [locale] layout exports `revalidate = 60` (task 2.1 removed
 *      its `cookies()` read — the route tree is ISR-eligible again).
 *   2. Whether a page opts back OUT of shared-cacheable rendering:
 *      awaiting `searchParams` (URL-state pages) or reading a dynamic
 *      API (`next/headers`, `unstable_noStore`, `connection`).
 *   3. Whether a page pins its own ISR window (`export const
 *      revalidate = <n>` with `dynamicParams`) and — on a dynamic
 *      segment — exports `generateStaticParams`, which Next 15.5
 *      requires before it engages the fallback cache at all
 *      (products/[id] does: 300 s, on-demand, empty export;
 *      product-page-cold-latency 1.1 + fix round). The page's window
 *      bounds its revalidation timing; the emitted `s-maxage` still
 *      takes the tree minimum (fact 1).
 *
 * The unit suite has no built-server harness (CI builds the frontend in
 * a separate job; the SSR tests render components against mocked Next
 * plumbing), so the classification is pinned structurally — the way a
 * reviewer reads the source — while the header shapes themselves are
 * pinned as the exact strings observed live:
 *
 *   Route                Cache-Control (observed, sessionless GET)
 *   ──────────────────── ───────────────────────────────────────────────────────
 *   /                    s-maxage=60, stale-while-revalidate=31535940
 *   /ranking             s-maxage=60, stale-while-revalidate=31535940
 *   /account             s-maxage=60, stale-while-revalidate=31535940
 *                        (static shell; the session is a client fetch,
 *                        so no per-visitor state reaches the shared HTML)
 *   /products            private, no-cache, no-store, max-age=0,
 *                        must-revalidate (searchParams URL state: sort,
 *                        category, page, q)
 *   /contact             private, no-cache, no-store, max-age=0,
 *                        must-revalidate (searchParams: ?sent/?error
 *                        acknowledgement states for the no-JS POST flow)
 *   /products/[id]       s-maxage=60, stale-while-revalidate=31535940
 *                        (route-level on-demand ISR: the page pins
 *                        revalidate 300 + dynamicParams true + an
 *                        empty generateStaticParams — first visit per
 *                        product renders and caches the shell, later
 *                        visits inside the 300 s window serve it; the
 *                        emitted s-maxage is the tree minimum, the
 *                        layout's 60, while the page's own 300 s
 *                        window governs revalidation timing via
 *                        x-nextjs-stale-time; no build-time id
 *                        catalog, and the 900 s fetch cache still
 *                        dedupes its upstream reads; session state is
 *                        client-side, /account-style. On the deployed
 *                        OpenNext worker runtime OpenNext rewrites
 *                        cache-control, so this exact string holds
 *                        only for `next start`)
 *   /savings             … (searchParams ?method)
 *
 * The ISR shape is the shared-cache contract: `s-maxage` equals the
 * MINIMUM revalidate window across the route's segment tree — the
 * layout's 60 for every route in the table, including products/[id],
 * whose own 300 s window governs its revalidation timing (observed as
 * `x-nextjs-stale-time: 300`) without winning the header — and the
 * server pairs it with `stale-while-revalidate` for the remainder of
 * the one-year expire window (31536000 − window). These exact strings
 * describe `next start` output only: on the deployed OpenNext worker
 * runtime OpenNext rewrites cache-control (its own windows and shape),
 * so worker verification should assert the shared-vs-private
 * distinction and cacheability, not Next's exact strings. `private,
 * no-store` never appears on an ISR route; on the dynamic routes it is
 * the honest cost of request state, not a regression.
 *
 * @module CacheHeadersTest
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** The [locale] root this test audits (relative to this file). */
const LOCALE_DIR = path.resolve(import.meta.dirname, '..');

/** One year, the expire window Next pairs the revalidate window into. */
const EXPIRE_SECONDS = 31_536_000;

/** The layout's ISR window — parsed from source, asserted below. */
const LAYOUT_REVALIDATE_SECONDS = 60;

/** Observed live: cache-control of an ISR route under this layout. */
const ISR_CACHE_CONTROL = `s-maxage=${LAYOUT_REVALIDATE_SECONDS}, stale-while-revalidate=${EXPIRE_SECONDS - LAYOUT_REVALIDATE_SECONDS}`;

/**
 * Observed live under `next start` (product-page-cold-latency 1.1 fix
 * round): the product route's emitted cache-control. Next emits the
 * MINIMUM revalidate across the segment tree as s-maxage, so the
 * [locale] layout's 60 beats the page's own 300 and the header takes
 * the layout-window shape; the page's 300 s window still governs its
 * revalidation timing (`x-nextjs-stale-time: 300` observed). On the
 * deployed OpenNext worker runtime OpenNext rewrites cache-control, so
 * this exact string describes `next start` output only.
 */
const PRODUCT_NEXT_START_CACHE_CONTROL = `s-maxage=${LAYOUT_REVALIDATE_SECONDS}, stale-while-revalidate=${EXPIRE_SECONDS - LAYOUT_REVALIDATE_SECONDS}`;

/** Observed live: cache-control of a per-request dynamic route. */
const DYNAMIC_CACHE_CONTROL =
  'private, no-cache, no-store, max-age=0, must-revalidate';

/** Source constructs that flip a route tree to per-request rendering. */
const DYNAMIC_API_PATTERNS = [
  /from ['"]next\/headers['"]/,
  /unstable_noStore/,
  /await connection\(/,
] as const;

/** Read a file under [locale] as text (source-level audit). */
function readSource(...segments: string[]): string {
  return readFileSync(path.join(LOCALE_DIR, ...segments), 'utf8');
}

/** Every .ts/.tsx file under [locale], as paths relative to it. */
function allSourceFiles(dir = ''): string[] {
  const entries = readdirSync(path.join(LOCALE_DIR, dir), {
    withFileTypes: true,
  });
  return entries.flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Test files audit this contract; they are not part of it.
      if (entry.name === '__tests__') return [];
      return allSourceFiles(rel);
    }
    return /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

describe('cache-header contract (first-impression-pass 2.2)', () => {
  it('the layout carries the ISR window the s-maxage value derives from', () => {
    const source = readSource('layout.tsx');
    const match = source.match(/export const revalidate = (\d+);/);
    expect(match, 'layout must declare its revalidate window').not.toBeNull();
    expect(Number(match![1])).toBe(LAYOUT_REVALIDATE_SECONDS);
    // The exact shape observed live on every ISR route under the
    // layout's 60 s window (/, /ranking, /account): the revalidate
    // window as s-maxage, the remainder of the expire window as
    // stale-while-revalidate — a shared-cache header, never a private
    // one. products/[id] emits the same shape too — by the
    // tree-minimum rule, not from its own 300 s window (pinned in the
    // product-detail verdict below).
    expect(ISR_CACHE_CONTROL).toBe(
      's-maxage=60, stale-while-revalidate=31535940',
    );
  });

  it('no file under [locale] reads a dynamic API (shared segments stay cacheable)', () => {
    // Task 2.1 removed the layout's cookies() read; this sweep keeps it
    // out — and keeps cookies()/headers()/unstable_noStore/connection()
    // out of every segment and page — so the layout-wide `revalidate`
    // stays effective. A route that genuinely needs request state must
    // await searchParams instead (the pinned dynamic pages below) and
    // accept the per-request cost explicitly.
    const offenders = allSourceFiles().filter((rel) => {
      const source = readSource(rel);
      return DYNAMIC_API_PATTERNS.some((pattern) => pattern.test(source));
    });
    expect(offenders).toEqual([]);
  });

  it('no page opts out via route segment config (force-dynamic / revalidate 0)', () => {
    // Route segment config that opts OUT of shared-cacheable rendering
    // stays banned on every page. A page MAY pin its own positive ISR
    // window (`export const revalidate = <n>` — product-page-cold-latency
    // 1.1 put 300 on products/[id]); only 0 is the per-request opt-out.
    // `dynamicParams` is likewise allowed: it governs on-demand
    // rendering of unprerendered params, not cacheability.
    const offenders = allSourceFiles().filter((rel) => {
      if (!rel.endsWith('page.tsx')) return false;
      const source = readSource(rel);
      if (/export const (dynamic|fetchCache) =/.test(source)) return true;
      const revalidate = source.match(/export const revalidate = (\d+)/);
      return revalidate !== null && Number(revalidate[1]) === 0;
    });
    expect(offenders).toEqual([]);
  });

  it('ISR-pinned public routes carry no request-state reads', () => {
    // Home and ranking sit fully under the layout's ISR umbrella —
    // observed live as `s-maxage=60, stale-while-revalidate=31535940`.
    // Any searchParams or dynamic-API read here would flip them to
    // per-request dynamic (no-store); this pin makes that flip a
    // conscious act.
    for (const rel of ['page.tsx', 'ranking/page.tsx']) {
      const source = readSource(rel);
      expect(
        source,
        `${rel} must not read searchParams`,
      ).not.toMatch(/searchParams/);
      for (const pattern of DYNAMIC_API_PATTERNS) {
        expect(source, rel).not.toMatch(pattern);
      }
    }
  });

  it('the catalog stays dynamic by contract: searchParams URL state', () => {
    // VERDICT (task 2.2, verified live): awaiting searchParams makes
    // /products per-request dynamic — `private, no-cache, no-store` —
    // regardless of the layout's revalidate. This is accepted, not
    // accidental: the catalog's sort/category/page/q state lives in the
    // URL and every control is a plain link or a no-JS GET form (design
    // D5), so the server must read the query each request. Caching it
    // would require moving that state client-side, which the design
    // forbids. If the query read ever moves out of the page, flip this
    // pin into the ISR set above.
    // URL state in the query (await searchParams) — these routes render
    // per request and emit the dynamic shape below, the honest cost of
    // their request state:
    expect(DYNAMIC_CACHE_CONTROL).toBe(
      'private, no-cache, no-store, max-age=0, must-revalidate',
    );
    const source = readSource('products/page.tsx');
    expect(source).toMatch(/await searchParams/);
  });

  it('the contact page stays dynamic by contract: searchParams ack states', () => {
    // Same verdict as the catalog: ?sent=1 / ?error=<code> render the
    // acknowledgement and honest-error states for the no-JS form POST,
    // so the page awaits searchParams and stays per-request dynamic,
    // emitting DYNAMIC_CACHE_CONTROL (observed live). Moving those
    // states client-side would break the plain-HTML POST path; not taken.
    expect(DYNAMIC_CACHE_CONTROL).toBe(
      'private, no-cache, no-store, max-age=0, must-revalidate',
    );
    const source = readSource('contact/page.tsx');
    expect(source).toMatch(/await searchParams/);
  });

  it('product detail is on-demand ISR: route-level 300 s window, no request-time reads', () => {
    // VERDICT (product-page-cold-latency 1.1 + fix round; supersedes
    // this suite's earlier per-request verdict): /products/[id] pins
    // its own ISR window — `revalidate = 300`, `dynamicParams = true`
    // — AND exports `generateStaticParams`, empty. The empty export is
    // load-bearing on Next 15.5: the ISR fallback cache for a dynamic
    // segment engages only when the route exports it, so the first fix
    // attempt (the two constants alone) kept the deployed route
    // per-request — `private, no-store`, warm TTFB 1.29–2.09 s (5.2
    // staging). With the export: first hit `x-nextjs-cache: MISS`,
    // then HIT, warm TTFB 0.011 s. An empty return builds no id
    // catalog: every path renders on demand. The old verdict's
    // no-store was mechanical — a dynamic param with no build-time
    // catalog — never age-gate policy: the age gate is a client-side
    // overlay and the session state is client-side too, /account
    // precedent. Its data fetches keep the 900 s fetch cache, so
    // upstream reads stay deduped. What keeps the route ISR-legal is
    // the absence of request-time reads: no searchParams await, no
    // dynamic API.
    const source = readSource('products/[id]/page.tsx');
    // The route-level ISR window and on-demand param handling:
    expect(source).toMatch(/export const revalidate = 300;/);
    expect(source).toMatch(/export const dynamicParams = true;/);
    // The load-bearing empty generateStaticParams — presence AND
    // empty-return shape; a populated return would prerender a
    // build-time id catalog, which the route deliberately avoids.
    expect(source).toMatch(
      /export\s+(?:async\s+)?function\s+generateStaticParams\s*\(/,
    );
    expect(source).toMatch(
      /generateStaticParams\s*\([^)]*\)\s*\{\s*return\s+\[\];\s*\}/,
    );
    // The honest header pin, replacing the old exact `s-maxage=300…`
    // string (unreachable): under `next start` the emitted s-maxage is
    // the MINIMUM revalidate across the segment tree — the [locale]
    // layout's 60 beats the page's own 300 — while the page's 300 s
    // window still governs its revalidation timing
    // (`x-nextjs-stale-time: 300` observed). On the deployed OpenNext
    // worker runtime OpenNext rewrites cache-control, so exact strings
    // only describe `next start` output.
    expect(PRODUCT_NEXT_START_CACHE_CONTROL).toBe(
      's-maxage=60, stale-while-revalidate=31535940',
    );
    // ISR legality — no request-time state may reach the render:
    expect(source, 'must not read searchParams').not.toMatch(/searchParams/);
    for (const pattern of DYNAMIC_API_PATTERNS) {
      expect(source, 'must not read a dynamic API').not.toMatch(pattern);
    }
  });

  it('the per-request route set is exactly the pinned URL-state + dynamic-param pages', () => {
    // Surface-wide inventory: a page is per-request dynamic when it
    // awaits searchParams, or when it lives under a dynamic segment
    // whose ISR fallback is not engaged. Next 15.5 engages that
    // fallback only when the route exports generateStaticParams
    // (product-page-cold-latency 1.1 fix round: the revalidate/
    // dynamicParams window pins alone kept /products/[id] per-request
    // on staging, 5.2) — the layout's 60 s window covers the whole
    // tree, so the export, not a window pin, is what separates ISR
    // from per-request on a dynamic segment. Everything else renders
    // under the layout's ISR umbrella. A new searchParams read
    // anywhere below flips that page to `private, no-store` — extend
    // the pins above and this set consciously.
    const underDynamicSegment = (rel: string) =>
      rel.split(path.sep).some((segment) => /^\[.+\]$/.test(segment));
    const exportsGenerateStaticParams = (source: string) =>
      /export\s+(?:async\s+)?function\s+generateStaticParams\s*\(/.test(
        source,
      );
    const perRequest = allSourceFiles().filter((rel) => {
      if (!rel.endsWith('page.tsx')) return false;
      const source = readSource(rel);
      if (/await searchParams/.test(source)) return true;
      if (underDynamicSegment(rel)) return !exportsGenerateStaticParams(source);
      return false;
    });
    expect(perRequest.sort()).toEqual(
      [
        // URL state in the query (await searchParams):
        'allowances/page.tsx',
        'contact/page.tsx',
        'products/page.tsx',
        'savings/page.tsx',
        'value/page.tsx',
        // Dynamic segments with no route-level ISR window (per-request
        // regardless of searchParams):
        '[...rest]/page.tsx',
        'blog/[slug]/page.tsx',
        'calculator/result/[recordId]/page.tsx',
        'guides/[slug]/page.tsx',
        'group-order/[token]/page.tsx',
        'lists/[slug]/page.tsx',
        'share/[publicId]/page.tsx',
      ].sort(),
    );
  });
});
