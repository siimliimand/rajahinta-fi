/**
 * Sitemap index route (sitemap-tree-coverage task 2.2, design D6) —
 * `/sitemap.xml` as a hand-rolled sitemapindex over the descriptive
 * tree: `pages`, `editorial`, `products-0..N-1`. The builder machinery
 * lives in `lib/sitemap-entries.ts`, the serializer in
 * `lib/sitemap-xml.ts`; this handler owns the one D4 invariant the
 * index exists for: it references only children that serve.
 *
 * Child honesty rules:
 *  - `pages` always serves (unconditional static surface) → always
 *    referenced;
 *  - `editorial` is referenced only when one of its content stores
 *    (curated lists, per-locale blog, per-locale guides) returned
 *    published entries — the builder's own index-route gates, lifted
 *    one level; a degraded or empty store omits the child;
 *  - `products-N` is derived from the enumerated catalog total
 *    (`getServerProductIds`, one cheap slice read for its `total`); a
 *    degraded read (null) references no products children rather than
 *    dead URLs. The chunks themselves are task 2.3.
 *
 * ISR revalidate 900 s — the same cadence the metadata route ran and
 * the builder's fetches cache at, so the advertised set never drifts
 * more than one window from the served tree.
 *
 * @module SitemapIndexRoute
 */

import { SITE_URL } from '@/lib/api';
import { routing } from '@/i18n/routing';
import {
  getServerBlogSlugs,
  getServerCuratedListSlugs,
  getServerGuideSlugs,
} from '@/lib/sitemap-entries';
import {
  productChunkCount,
  serializeSitemapindex,
} from '@/lib/sitemap-xml';
import { getServerProductIds } from '@/lib/server-api';

export const revalidate = 900;

/** Where the tree children live (app/sitemaps/[tree]/route.ts). */
const TREE_URL_BASE = `${SITE_URL}/sitemaps`;

export async function GET(): Promise<Response> {
  // One parallel pass over the gates: the enumeration read only for
  // its `total` (limit 1 — the endpoint returns the total it slices),
  // the editorial stores exactly as the builder reads them (cached at
  // the same 900 s cadence, degraded reads yield []).
  const [idPage, listSlugs, ...slugLists] = await Promise.all([
    getServerProductIds(0, 1),
    getServerCuratedListSlugs(),
    ...routing.locales.flatMap((locale) => [
      getServerBlogSlugs(locale),
      getServerGuideSlugs(locale),
    ]),
  ]);
  const blogSlugLists = routing.locales.map((_, index) => slugLists[index * 2]);
  const guideSlugLists = routing.locales.map(
    (_, index) => slugLists[index * 2 + 1],
  );

  const children: string[] = [`${TREE_URL_BASE}/pages`];

  const editorialHasEntries =
    listSlugs.length > 0 ||
    blogSlugLists.some((slugs) => slugs.length > 0) ||
    guideSlugLists.some((slugs) => slugs.length > 0);
  if (editorialHasEntries) {
    children.push(`${TREE_URL_BASE}/editorial`);
  }

  const chunkCount = idPage === null ? 0 : productChunkCount(idPage.total);
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    children.push(`${TREE_URL_BASE}/products-${chunk}`);
  }

  return new Response(serializeSitemapindex(children), {
    headers: { 'content-type': 'application/xml' },
  });
}
