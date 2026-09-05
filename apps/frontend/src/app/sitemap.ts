/**
 * Sitemap (task 9.5; curated lists added by task 7.2).
 *
 * Static destinations per locale plus per-product URLs drawn from the
 * product listing via the shared API client, plus one URL per published
 * curated list drawn from the flag-gated list catalog. Finnish serves
 * from the unprefixed paths, English under /en (localePrefix:
 * 'as-needed'). Backend reads are cached; an unreachable backend
 * degrades to a static-routes-only sitemap rather than a failed one.
 *
 * Curated-list flag interaction (`enable_curated_lists`): the catalog
 * endpoint is gated by the same flag as the list pages themselves, so
 * flag off → 403 → zero list URLs and flag on without published
 * entries → empty catalog → zero list URLs. A flag-off deployment thus
 * never advertises list URLs that would not serve; the sitemap needs
 * no flag awareness of its own (degrades to inert).
 *
 * @module Sitemap
 */

import type { MetadataRoute } from 'next';
import { getServerProductListing, SITE_URL, BASE_URL } from '@/lib/api';
import { routing } from '@/i18n/routing';

/** Static destinations every locale offers (header navigation surface). */
const STATIC_PATHS = ['', '/calculator', '/compare', '/basket', '/ranking'];

/** One catalog row — slug + display title (criteria live per slug). */
interface CuratedCatalogList {
  readonly slug: string;
  readonly title: string;
}

/** URL-safe slug guard — a catalog row that fails it is not a list. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Published curated-list slugs from the API catalog (GET /api/v1/lists,
 * task 7.2). Mirrors the product-listing degradation contract: any
 * failure (backend unreachable, flag-off 403, unexpected shape)
 * degrades to an empty list, never a failed sitemap.
 */
async function getServerCuratedListSlugs(): Promise<string[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/lists`, {
      headers: { accept: 'application/json' },
      // Same cadence as the sitemap revalidation below.
      next: { revalidate: 900 },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { lists?: CuratedCatalogList[] };
    const slugs = Array.isArray(body.lists)
      ? body.lists
          .map((list) => list?.slug)
          .filter((slug): slug is string => typeof slug === 'string' && SLUG_PATTERN.test(slug))
      : [];
    return slugs;
  } catch {
    return [];
  }
}

export const revalidate = 900;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, listSlugs] = await Promise.all([
    getServerProductListing(),
    getServerCuratedListSlugs(),
  ]);

  const entries: MetadataRoute.Sitemap = [];
  for (const locale of routing.locales) {
    // The default locale serves unprefixed; others get their prefix.
    const prefix = locale === routing.defaultLocale ? '' : `/${locale}`;

    for (const path of STATIC_PATHS) {
      entries.push({
        url: `${SITE_URL}${prefix}${path}`,
        changeFrequency: path === '' ? 'daily' : 'weekly',
        priority: path === '' ? 1 : 0.7,
      });
    }

    for (const product of products) {
      entries.push({
        url: `${SITE_URL}${prefix}/products/${product.id}`,
        changeFrequency: 'daily',
        priority: 0.5,
      });
    }

    // Editorial list pages (task 7.3) — SEO content between the static
    // navigation surface and per-product pages.
    for (const slug of listSlugs) {
      entries.push({
        url: `${SITE_URL}${prefix}/lists/${slug}`,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
  }

  return entries;
}
