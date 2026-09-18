/**
 * SEO smoke — unique per-route metadata across the public surface
 * (price-intelligence-roadmap task 6.2).
 *
 * Every public route must carry its OWN non-empty title and description,
 * resolved through the page's real generateMetadata from the real locale
 * catalogs. A duplicate or missing title/description fails here — the
 * per-page tests pin their copy, this smoke pins the surface-wide
 * uniqueness contract: two routes must never emit the same metadata, and
 * no route may fall back to the layout's site-default metadata.
 *
 * @module SeoSmokeTest
 */
// @vitest-environment jsdom

import React from 'react';
import type { Metadata } from 'next';
import { describe, expect, it, vi } from 'vitest';
import { generateMetadata as calculatorMetadata } from '../calculator/page';
import { generateMetadata as compareMetadata } from '../compare/page';
import { generateMetadata as basketMetadata } from '../basket/page';
import { generateMetadata as tripMetadata } from '../trip/page';
import { generateMetadata as eventMetadata } from '../event/page';
import { generateMetadata as whatIfMetadata } from '../what-if/page';
import { generateMetadata as rankingMetadata } from '../ranking/page';
import { generateMetadata as valueMetadata } from '../value/page';
import { generateMetadata as aboutMetadata } from '../about/page';
import { generateMetadata as contactMetadata } from '../contact/page';
import { generateMetadata as productsMetadata } from '../products/page';
import { generateMetadata as blogMetadata } from '../blog/page';
import { generateMetadata as guidesMetadata } from '../guides/page';

// The pages resolve their copy through next-intl/server; resolve straight
// from the real catalogs with {param} interpolation support (value test
// precedent, extended the way the crawlability harness interpolates).
vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const locale = (typeof opts === 'object' && opts?.locale) || 'fi';
    const table = (await import(`@/messages/${locale}.json`)).default as Record<
      string,
      unknown
    >;
    return (key: string, values?: Record<string, unknown>) => {
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
}));

// The router-aware navigation module does not load under this test
// environment (value test precedent); generateMetadata never renders it.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

// generateMetadata signatures differ only in whether searchParams is
// part of the props (products); this unified shape serves all 13.
type PageMetadata = (props: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) => Promise<Metadata>;

/** The public routes task 6.2 enumerates, with their metadata source. */
const ROUTES: readonly { route: string; metadata: PageMetadata }[] = [
  { route: '/calculator', metadata: calculatorMetadata as PageMetadata },
  { route: '/compare', metadata: compareMetadata as PageMetadata },
  { route: '/basket', metadata: basketMetadata as PageMetadata },
  { route: '/trip', metadata: tripMetadata as PageMetadata },
  { route: '/event', metadata: eventMetadata as PageMetadata },
  { route: '/what-if', metadata: whatIfMetadata as PageMetadata },
  { route: '/ranking', metadata: rankingMetadata as PageMetadata },
  { route: '/value', metadata: valueMetadata as PageMetadata },
  { route: '/about', metadata: aboutMetadata as PageMetadata },
  { route: '/contact', metadata: contactMetadata as PageMetadata },
  { route: '/products', metadata: productsMetadata as PageMetadata },
  { route: '/blog', metadata: blogMetadata as PageMetadata },
  { route: '/guides', metadata: guidesMetadata as PageMetadata },
];

const LOCALES = ['fi', 'en'] as const;

describe('SEO smoke — unique per-route metadata on the public surface (task 6.2)', () => {
  it.each(LOCALES)('every public route emits non-empty, catalog-resolved metadata (%s)', async (locale) => {
    for (const { route, metadata } of ROUTES) {
      const meta = await metadata({
        params: Promise.resolve({ locale }),
        searchParams: Promise.resolve({}),
      });

      const title = typeof meta.title === 'string' ? meta.title : '';
      const description =
        typeof meta.description === 'string' ? meta.description : '';

      expect(title, `${route} (${locale}) has a title`).not.toBe('');
      expect(description, `${route} (${locale}) has a description`).not.toBe('');
      // A dropped catalog key would surface as the mock's sentinel, and
      // an unresolved {param} would surface as a literal placeholder.
      expect(title, `${route} (${locale}) title resolves`).not.toContain('__MISSING_');
      expect(title, `${route} (${locale}) title interpolates`).not.toContain('{');
      expect(description, `${route} (${locale}) description resolves`).not.toContain('__MISSING_');
    }
  });

  it.each(LOCALES)('titles and descriptions are pairwise unique across the routes, and none restates the site default (%s)', async (locale) => {
    const root = (await import(`@/messages/${locale}.json`)).default as {
      Metadata: { title: string; description: string };
    };
    const titles: string[] = [];
    const descriptions: string[] = [];

    for (const { route, metadata } of ROUTES) {
      const meta = await metadata({
        params: Promise.resolve({ locale }),
        searchParams: Promise.resolve({}),
      });
      titles.push(meta.title as string);
      descriptions.push(meta.description as string);

      expect(meta.title, `${route} (${locale}) title is its own, not the layout default`)
        .not.toBe(root.Metadata.title);
      expect(meta.description, `${route} (${locale}) description is its own, not the layout default`)
        .not.toBe(root.Metadata.description);
    }

    expect(new Set(titles).size, `titles unique across ${ROUTES.length} routes (${locale})`).toBe(ROUTES.length);
    expect(new Set(descriptions).size, `descriptions unique across ${ROUTES.length} routes (${locale})`).toBe(ROUTES.length);
  });
});
