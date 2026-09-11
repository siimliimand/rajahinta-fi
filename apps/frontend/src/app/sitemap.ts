/**
 * Sitemap (task 9.5; curated lists added by task 7.2, blog by
 * trust-and-reach-roadmap task 5.2, savings + guides by insight-surfaces
 * tasks 2.4/5.2).
 *
 * Static destinations per locale plus the six catalog category URLs
 * (product-catalog task 3.2), per-product URLs drawn from the product
 * listing via the shared API client, one URL per published curated list
 * drawn from the list catalog, and one URL per published blog post and
 * guide per locale. Finnish serves from the unprefixed
 * paths, English under /en (localePrefix: 'as-needed'). Backend reads
 * are cached; an unreachable backend degrades to a static-routes-only
 * sitemap rather than a failed one. The catalog only ever advertises
 * URLs that serve: a fetch failure or a catalog without published
 * entries yields zero dynamic URLs (the sitemap degrades to inert).
 *
 * @module Sitemap
 */

import type { MetadataRoute } from 'next';
import { getServerProductListing, SITE_URL, BASE_URL } from '@/lib/api';
import { routing } from '@/i18n/routing';

/** Static destinations every locale offers (header navigation surface;
 * /allowances added by insight-surfaces task 4.2; /savings and /guides
 * by insight-surfaces tasks 2.4/5.2; /products by product-catalog task
 * 3.2). */
const STATIC_PATHS = [
  '',
  '/calculator',
  '/compare',
  '/basket',
  '/products',
  '/ranking',
  '/blog',
  '/guides',
  '/allowances',
  '/savings',
];

/** Canonical product categories — mirrors PRODUCT_CATEGORIES in the D1
 *  schema (packages/data-platform), the set the API validates
 *  ?category= against; the frontend cannot import that module (worker
 *  bindings). Only these six values are advertiseable. */
const CATALOG_CATEGORIES = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

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
 * failure (backend unreachable, 403, unexpected shape) degrades to an
 * empty list, never a failed sitemap.
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

/**
 * Published blog slugs for one locale (GET /api/v1/blog/posts?locale=,
 * trust-and-reach-roadmap task 5.2). The endpoint serves PUBLISHED rows
 * only, so anything it returns is advertiseable. Same degradation
 * contract as the list slugs: any failure or unexpected shape yields an
 * empty list, never a failed sitemap.
 */
async function getServerBlogSlugs(locale: string): Promise<string[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/v1/blog/posts?locale=${encodeURIComponent(locale)}`,
      {
        headers: { accept: 'application/json' },
        next: { revalidate: 900 },
      },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: Array<{ slug?: unknown }> };
    const slugs = Array.isArray(body.items)
      ? body.items
          .map((post) => post?.slug)
          .filter((slug): slug is string => typeof slug === 'string' && SLUG_PATTERN.test(slug))
      : [];
    return slugs;
  } catch {
    return [];
  }
}

/**
 * Published guide slugs for one locale (GET /api/v1/guides?locale=,
 * insight-surfaces task 5.2). The endpoint serves PUBLISHED GUIDE rows
 * only, so anything it returns is advertiseable. Same degradation
 * contract as the blog slugs.
 */
async function getServerGuideSlugs(locale: string): Promise<string[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/v1/guides?locale=${encodeURIComponent(locale)}`,
      {
        headers: { accept: 'application/json' },
        next: { revalidate: 900 },
      },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: Array<{ slug?: unknown }> };
    const slugs = Array.isArray(body.items)
      ? body.items
          .map((guide) => guide?.slug)
          .filter((slug): slug is string => typeof slug === 'string' && SLUG_PATTERN.test(slug))
      : [];
    return slugs;
  } catch {
    return [];
  }
}

export const revalidate = 900;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, listSlugs, ...slugLists] = await Promise.all([
    getServerProductListing(),
    getServerCuratedListSlugs(),
    ...routing.locales.flatMap((locale) => [
      getServerBlogSlugs(locale),
      getServerGuideSlugs(locale),
    ]),
  ]);
  const blogSlugsByLocale = new Map(
    routing.locales.map((locale, index) => [locale, slugLists[index * 2]]),
  );
  const guideSlugsByLocale = new Map(
    routing.locales.map((locale, index) => [locale, slugLists[index * 2 + 1]]),
  );

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

    // Catalog category views (product-catalog task 3.2) — page-1 state
    // only, matching each state's canonical URL. Page ≥ 2 states stay
    // out of the sitemap: an infinite parameter space with no uniquely
    // indexable value (design D6).
    for (const category of CATALOG_CATEGORIES) {
      entries.push({
        url: `${SITE_URL}${prefix}/products?category=${category}`,
        changeFrequency: 'weekly',
        priority: 0.6,
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

    // Published blog posts (task 5.2) — per-locale content, so each
    // locale advertises only its own posts.
    for (const slug of blogSlugsByLocale.get(locale) ?? []) {
      entries.push({
        url: `${SITE_URL}${prefix}/blog/${slug}`,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }

    // Published guides (insight-surfaces task 5.2) — per-locale, blog
    // parity, PUBLISHED rows only.
    for (const slug of guideSlugsByLocale.get(locale) ?? []) {
      entries.push({
        url: `${SITE_URL}${prefix}/guides/${slug}`,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
  }

  return entries;
}
