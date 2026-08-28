/**
 * Sitemap (task 9.5).
 *
 * Static destinations per locale plus per-product URLs drawn from the
 * product listing via the shared API client. Finnish serves from the
 * unprefixed paths, English under /en (localePrefix: 'as-needed'). The
 * listing read is cached; an unreachable backend degrades to a
 * static-routes-only sitemap rather than a failed one.
 *
 * @module Sitemap
 */

import type { MetadataRoute } from 'next';
import { getServerProductListing, SITE_URL } from '@/lib/api';
import { routing } from '@/i18n/routing';

/** Static destinations every locale offers (header navigation surface). */
const STATIC_PATHS = ['', '/calculator', '/compare', '/basket', '/ranking'];

export const revalidate = 900;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getServerProductListing();

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
  }

  return entries;
}
