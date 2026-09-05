/**
 * Robots rules (task 9.5).
 *
 * Public comparison surfaces are crawlable. Account pages are
 * session-scoped (no indexable content), group order sessions are
 * share-token-scoped coordination surfaces (task 9.4), and the age-gate
 * interstitial is a prompt, not a destination — all are excluded for
 * every locale.
 *
 * @module Robots
 */

import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/api';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/account',
          '/en/account',
          '/group-order',
          '/en/group-order',
          '/age-gate',
          '/en/age-gate',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
