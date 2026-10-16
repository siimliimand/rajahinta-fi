/**
 * Unit tests for the sitemap entry-builder's URL vocabulary (task 2.1,
 * change sitemap-tree-coverage): the routing-vocabulary emission edges
 * (design D6/D7) that the full-inventory suite (src/app/sitemap.test.ts)
 * pins only indirectly — the bare-root normalization, bracket-param
 * substitution, shared-segment string routes, and the slug fetchers'
 * URL-safe guard and degradation contract.
 *
 * @module SitemapEntriesTest
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  getServerBlogSlugs,
  localizedPathname,
  localizedUrl,
} from './sitemap-entries';
import { routing } from '@/i18n/routing';

describe('localizedPathname (design D6)', () => {
  it('serves the fi segment bare and the en route name under /en', () => {
    expect(localizedPathname('/calculator', 'fi')).toBe('/laskuri');
    expect(localizedPathname('/calculator', 'en')).toBe('/en/calculator');
  });

  it('normalizes the bare root: empty for fi, /en for en', () => {
    expect(localizedPathname('/', 'fi')).toBe('');
    expect(localizedPathname('/', 'en')).toBe('/en');
  });

  it('substitutes bracket params and percent-encodes them', () => {
    expect(localizedPathname('/products/[id]', 'fi', { id: 123 })).toBe(
      '/tuotteet/123',
    );
    expect(
      localizedPathname('/blog/[slug]', 'en', { slug: 'a b/c' }),
    ).toBe('/en/blog/a%20b%2Fc');
  });

  it('substitutes an absent param as empty (no crash)', () => {
    expect(localizedPathname('/lists/[slug]', 'fi')).toBe('/listat/');
  });

  it('keeps shared-segment string routes identical in both locales', () => {
    expect(localizedPathname('/login', 'fi')).toBe('/login');
    expect(localizedPathname('/login', 'en')).toBe('/en/login');
  });
});

describe('localizedUrl (design D6)', () => {
  it('pairs the pathname onto the site origin', () => {
    expect(localizedUrl('/', 'fi')).toBe('https://rajahinta.fi');
    expect(localizedUrl('/products/[id]', 'en', { id: 7 })).toBe(
      'https://rajahinta.fi/en/products/7',
    );
  });
});

describe('getServerBlogSlugs (slug guard + degradation)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps URL-safe slugs and drops rows that fail the guard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            { slug: 'olutopas' },
            { slug: 'with-hyphen' },
            { slug: 'Upper' },
            { slug: 'under_score' },
            { slug: '' },
            { slug: 42 },
            {},
          ],
        }),
      }),
    );
    expect(await getServerBlogSlugs('fi')).toEqual(['olutopas', 'with-hyphen']);
  });

  it('degrades to an empty list on fetch failure (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await getServerBlogSlugs('en')).toEqual([]);
  });

  it('degrades to an empty list on a non-2xx answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await getServerBlogSlugs('fi')).toEqual([]);
  });
});

describe('STATIC_PATHS lockstep (satisfies guard)', () => {
  it('advertising vocabulary stays a subset of routing.pathnames keys', () => {
    // The builder's static list is pinned by `satisfies readonly
    // AppPathnames[]` at compile time; this runtime sweep fails loudly if
    // the vocabulary ever drops a route the builder assumes.
    for (const route of [
      '/',
      '/calculator',
      '/compare',
      '/basket',
      '/trip',
      '/event',
      '/what-if',
      '/value',
      '/group-order',
      '/products',
      '/ranking',
      '/blog',
      '/guides',
      '/allowances',
      '/savings',
      '/about',
      '/contact',
    ] as const) {
      expect(routing.pathnames[route], route).toBeDefined();
    }
  });
});
