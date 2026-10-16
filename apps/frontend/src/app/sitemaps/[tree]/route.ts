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
 *  - `products-N` — one 5,000-product id-ordered slice (offset
 *    `N * PRODUCT_CHUNK_SIZE`, D2/D3), the fi+en URLs of the same slice
 *    in one document with the enumeration endpoint's truthful lastmod
 *    and the full hreflang pairing (x-default → the bare fi URL),
 *    exactly the builder's product-row shape. Range honesty: a chunk
 *    number at or past `productChunkCount(total)` does not exist — the
 *    same crawler-honest 404 as any slug outside the vocabulary (D4:
 *    the index never references one). A degraded enumeration read
 *    serves the honest empty `<urlset>` — the sitemap never fails, and
 *    no timestamp is ever fabricated (D5).
 *
 * Any other slug is outside the vocabulary → notFound() → 404, never
 * an empty or guessed document (spec: Unknown tree slug). ISR
 * revalidate 900 s, matching the index and the builder's fetches.
 *
 * @module SitemapTreeRoute
 */

import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import {
  buildSitemapEntries,
  localizedUrl,
} from '@/lib/sitemap-entries';
import {
  PRODUCT_CHUNK_SIZE,
  productChunkCount,
  serializeUrlset,
  type SitemapUrlEntry,
} from '@/lib/sitemap-xml';
import { getServerProductIds } from '@/lib/server-api';

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

  const chunkMatch = PRODUCTS_CHUNK_PATTERN.exec(tree);
  if (chunkMatch) {
    const chunk = Number(chunkMatch[1]);
    const page = await getServerProductIds(
      chunk * PRODUCT_CHUNK_SIZE,
      PRODUCT_CHUNK_SIZE,
    );

    // Degraded read (D5): the sitemap never fails and never fabricates —
    // the honest empty urlset, not a guessed or timestamped document.
    if (page === null) return urlsetResponse([]);

    // Out of range (chunk at/past the enumerated chunk count, or a total
    // the endpoint never supplied): the chunk does not exist — the index
    // never references one (D4), so the same crawler-honest 404 as any
    // slug outside the vocabulary, never an empty or guessed document.
    if (chunk >= productChunkCount(page.total)) notFound();

    const entries: SitemapUrlEntry[] = [];
    for (const item of page.items) {
      const fi = localizedUrl('/products/[id]', 'fi', { id: item.id });
      const en = localizedUrl('/products/[id]', 'en', { id: item.id });
      // The builder's pairing shape (D6): x-default → the bare fi URL;
      // both localized entries share one map so the sets are identical.
      const languages = { 'x-default': fi, fi, en };
      for (const url of [fi, en]) {
        entries.push({
          url,
          lastmod: item.lastmod,
          changeFrequency: 'daily',
          priority: 0.5,
          alternates: { languages: { ...languages } },
        });
      }
    }
    return urlsetResponse(entries);
  }

  // Outside the tree vocabulary — a crawler-honest 404, never an empty
  // or guessed sitemap (spec: Unknown tree slug).
  notFound();
}
