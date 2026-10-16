/**
 * Sitemap tree child route (sitemap-tree-coverage task 2.2, design
 * D6) — `/sitemaps/[tree]` serves one document of the descriptive
 * index tree, each an `<urlset>` in the exact shape Next's metadata
 * route emitted (the serializer pins the byte shape; the builder
 * machinery lives in `lib/sitemap-entries.ts`).
 *
 * Tree vocabulary:
 *  - `pages` — the unconditional static routes, the tax-change
 *    calendar pair, and the catalog base/category views, both locales,
 *    with their hreflang alternates. Byte-matched to the builder's
 *    output by construction: the builder runs verbatim and this route
 *    keeps exactly its vocabulary-static subset.
 *  - `editorial` — the content-gated remainder: curated-list, blog,
 *    and guide slug URLs plus the per-locale `/blog` and `/guides`
 *    index URLs, exactly the builder's gates. A store that fails or is
 *    empty contributes nothing (an empty `<urlset>` — the tree never
 *    fails), and the index omits the child entirely while all stores
 *    are empty (D4).
 *  - `products-N` — one 5,000-product id-ordered slice, fi+en paired
 *    (D1/D3). Task 2.3 fills the enumeration reader, the truthful
 *    lastmod and the chunk-range check; until then the chunk serves an
 *    honest empty `<urlset>` (see the TODO below).
 *
 * Any other slug is outside the vocabulary → notFound() → 404, never
 * an empty or guessed document (spec: Unknown tree slug). ISR
 * revalidate 900 s, matching the index and the builder's fetches.
 *
 * @module SitemapTreeRoute
 */

import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { buildSitemapEntries } from '@/lib/sitemap-entries';
import {
  serializeUrlset,
  type SitemapUrlEntry,
} from '@/lib/sitemap-xml';

export const revalidate = 900;

/** `products-N` with a decimal N — the chunk-vocabulary shape (D2). */
const PRODUCTS_CHUNK_PATTERN = /^products-(\d+)$/;

/**
 * The tax-change calendar pair (tax-change-calendar task 4.4): its two
 * physical folders sit deliberately OUTSIDE routing.pathnames — the
 * pages hand-write their canonical/hreflang pair (calendar-page design
 * D6) — so the vocabulary lookup below extends the map by hand with
 * exactly that pair, mirroring how the builder advertises it.
 */
const CALENDAR_PAIR: Readonly<Record<'fi' | 'en', string>> = {
  fi: '/veromuutokset',
  en: '/tax-changes',
};

/** routing.pathnames plus the hand-written calendar pair (see above). */
const PATHNAMES = new Map<string, string | Record<'fi' | 'en', string>>(
  Object.entries(routing.pathnames),
);
PATHNAMES.set('/tax-changes', CALENDAR_PAIR);
PATHNAMES.set('/veromuutokset', CALENDAR_PAIR);

/**
 * The internal routing-vocabulary route a sitemap URL was emitted for
 * — the classification the tree split relies on (design D6): fi URLs
 * carry the localized segment bare, en URLs the internal route name
 * under /en. Bracket templates match any single non-empty segment;
 * null when the URL is not part of the vocabulary (the builder never
 * emits such a URL — its emission is the vocabulary).
 */
function vocabularyRouteOf(url: string): string | null {
  const pathname = new URL(url).pathname;
  const prefix = pathname === '/en' || pathname.startsWith('/en/') ? '/en' : '';
  const stripped = pathname.slice(prefix.length) || '/';
  const locale: 'fi' | 'en' = prefix === '' ? 'fi' : 'en';
  const segments = stripped.split('/');
  for (const [route, entry] of PATHNAMES) {
    const segment = typeof entry === 'string' ? entry : entry[locale];
    const template = segment.split('/');
    if (template.length !== segments.length) continue;
    const matches = template.every(
      (part, index) =>
        part === segments[index] ||
        (part.startsWith('[') && part.endsWith(']') && segments[index] !== ''),
    );
    if (matches) return route;
  }
  return null;
}

/** The builder's per-locale editorial index routes (content-gated). */
function isEditorialIndexRoute(route: string): boolean {
  return route === '/blog' || route === '/guides';
}

/** `pages` = the vocabulary-static subset: no bracket params, no
 * editorial indexes — static routes, the calendar pair, and the
 * catalog base/category views (their `?category=` query rides along). */
function isPagesEntry(entry: SitemapUrlEntry): boolean {
  const route = vocabularyRouteOf(entry.url);
  return (
    route !== null && !isEditorialIndexRoute(route) && !route.includes('[')
  );
}

/** `editorial` = the builder's content-gated remainder: the editorial
 * index routes plus the slug pages (lists, blog posts, guides) — every
 * bracket route except the product detail template. */
function isEditorialEntry(entry: SitemapUrlEntry): boolean {
  const route = vocabularyRouteOf(entry.url);
  if (route === null) return false;
  if (isEditorialIndexRoute(route)) return true;
  return route.includes('[') && route !== '/products/[id]';
}

/** Tree entries → one `application/xml` urlset response. */
function urlsetResponse(entries: readonly SitemapUrlEntry[]): Response {
  return new Response(serializeUrlset(entries), {
    headers: { 'content-type': 'application/xml' },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ tree: string }> },
): Promise<Response> {
  const { tree } = await context.params;

  if (tree === 'pages' || tree === 'editorial') {
    const entries = await buildSitemapEntries();
    return urlsetResponse(
      tree === 'pages'
        ? entries.filter(isPagesEntry)
        : entries.filter(isEditorialEntry),
    );
  }

  if (PRODUCTS_CHUNK_PATTERN.test(tree)) {
    // TODO(sitemap-tree-coverage 2.3): fill with the paired chunk —
    // the id-ordered offset slice (offset = N * PRODUCT_CHUNK_SIZE,
    // width PRODUCT_CHUNK_SIZE) read through getServerProductIds, fi+en
    // URLs per product with the endpoint's truthful lastmod (D5), and
    // a chunk-range check of N against the enumerated total. Task 2.2
    // serves the honest empty urlset so the index's references (built
    // from the real total) never point at a 404.
    return urlsetResponse([]);
  }

  // Outside the tree vocabulary — a crawler-honest 404, never an empty
  // or guessed sitemap (spec: Unknown tree slug).
  notFound();
}
