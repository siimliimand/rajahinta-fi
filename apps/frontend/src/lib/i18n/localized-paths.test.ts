/**
 * Localized path + alternates helper tests (change
 * localize-fi-route-pathnames, design D6/D7).
 *
 * The canonical/hreflang emitters are SEO liability: a wrong segment
 * tells the crawler the wrong URL for every page. Pinned here against
 * the vocabulary routing.ts commits (the change spec's scenarios):
 *
 *   1. The active locale's segment — fi serves the bare localized
 *      segment (`/tuotteet`), en the prefixed internal one
 *      (`/en/products`).
 *   2. Query parameters stay English (design D7) and keep insertion
 *      order; absent entries never render a dangling `?` or `=`.
 *   3. Dynamic templates substitute their params (`/oppaat/[slug]`,
 *      `/tuotteet/[id]`); the typed input makes params mandatory.
 *   4. hreflang pairs the localized variants, `x-default` stays on the
 *      bare (fi) URL, and the canonical follows the active locale.
 *
 * @module LocalizedPathsTest
 */

import { describe, expect, it } from 'vitest';
import {
  localizedAlternates,
  localizedPath,
} from './localized-paths';

describe('localizedPath', () => {
  it('serves the bare localized segment for fi and the /en prefix for en', () => {
    expect(localizedPath('fi', { pathname: '/products' })).toBe('/tuotteet');
    expect(localizedPath('en', { pathname: '/products' })).toBe('/en/products');
    expect(localizedPath('fi', { pathname: '/' })).toBe('/');
    expect(localizedPath('en', { pathname: '/' })).toBe('/en/');
  });

  it('keeps query parameters English (design D7) in insertion order', () => {
    expect(
      localizedPath('fi', {
        pathname: '/products',
        query: { category: 'beer', page: 2 },
      }),
    ).toBe('/tuotteet?category=beer&page=2');
    expect(
      localizedPath('en', {
        pathname: '/savings',
        query: { category: 'wine_still' },
      }),
    ).toBe('/en/savings?category=wine_still');
  });

  it('omits absent query entries entirely — no dangling separator', () => {
    expect(
      localizedPath('fi', {
        pathname: '/products',
        query: { category: undefined, q: 'koskenkorva' },
      }),
    ).toBe('/tuotteet?q=koskenkorva');
    expect(localizedPath('fi', { pathname: '/value', query: {} })).toBe(
      '/grammahinta',
    );
  });

  it('substitutes dynamic template params for both locales', () => {
    expect(
      localizedPath('fi', {
        pathname: '/guides/[slug]',
        params: { slug: 'tullivapaat-rajat' },
      }),
    ).toBe('/oppaat/tullivapaat-rajat');
    expect(
      localizedPath('en', {
        pathname: '/guides/[slug]',
        params: { slug: 'tullivapaat-rajat' },
      }),
    ).toBe('/en/guides/tullivapaat-rajat');
    expect(
      localizedPath('fi', {
        pathname: '/products/[id]',
        params: { id: 42 },
      }),
    ).toBe('/tuotteet/42');
    expect(
      localizedPath('fi', {
        pathname: '/lists/[slug]',
        params: { slug: 'jouluvinkit' },
        query: { page: 1 },
      }),
    ).toBe('/listat/jouluvinkit?page=1');
  });

  it('localizes the shared segments identically apart from the prefix', () => {
    expect(localizedPath('fi', { pathname: '/account' })).toBe('/account');
    expect(localizedPath('en', { pathname: '/account' })).toBe('/en/account');
    expect(
      localizedPath('fi', {
        pathname: '/calculator/result/[recordId]',
        params: { recordId: 7 },
      }),
    ).toBe('/calculator/result/7');
  });
});

describe('localizedAlternates', () => {
  it('emits the active locale as canonical and pairs the localized variants', () => {
    const fi = localizedAlternates('fi', { pathname: '/products' });
    expect(fi.canonical).toBe('/tuotteet');
    expect(fi.languages).toEqual({
      fi: '/tuotteet',
      en: '/en/products',
      'x-default': '/tuotteet',
    });

    const en = localizedAlternates('en', { pathname: '/products' });
    expect(en.canonical).toBe('/en/products');
    expect(en.languages).toEqual({
      fi: '/tuotteet',
      en: '/en/products',
      'x-default': '/tuotteet',
    });
  });

  it('carries the English query parameters into canonical and pair', () => {
    const alternates = localizedAlternates('fi', {
      pathname: '/products',
      query: { category: 'beer', page: 3 },
    });
    expect(alternates.canonical).toBe('/tuotteet?category=beer&page=3');
    expect(alternates.languages?.fi).toBe('/tuotteet?category=beer&page=3');
    expect(alternates.languages?.en).toBe('/en/products?category=beer&page=3');
  });

  it('keeps x-default on the bare fi URL for a dynamic route', () => {
    const alternates = localizedAlternates('en', {
      pathname: '/blog/[slug]',
      params: { slug: 'veromuutos-2026-2' },
    });
    expect(alternates.canonical).toBe('/en/blog/veromuutos-2026-2');
    expect(alternates.languages).toEqual({
      fi: '/blogi/veromuutos-2026-2',
      en: '/en/blog/veromuutos-2026-2',
      'x-default': '/blogi/veromuutos-2026-2',
    });
  });
});
