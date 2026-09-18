/**
 * Sitemap static-paths tests (task 3.3, change
 * price-intelligence-roadmap).
 *
 * With every backend fetch degraded (the sitemap's own degradation
 * contract), the sitemap still emits the locale-prefixed static
 * destinations — and the About + Contact pages added by task 3.3 are
 * among them for BOTH locales (unprefixed for default-locale Finnish,
 * /en-prefixed for English).
 *
 * @module SitemapStaticPathsTest
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sitemap from './sitemap';

describe('sitemap static paths (task 3.3)', () => {
  beforeEach(() => {
    // Backend unreachable → the degradation contract yields a
    // static-routes-only sitemap (catalog/list/blog/guide fetches fail).
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes /about and /contact for the default locale (unprefixed)', async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain('https://rajahinta.fi/about');
    expect(urls).toContain('https://rajahinta.fi/contact');
  });

  it('includes /about and /contact for the en locale (/en prefix)', async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain('https://rajahinta.fi/en/about');
    expect(urls).toContain('https://rajahinta.fi/en/contact');
  });
});

/**
 * The public static routes a crawler may be advertised, independent of
 * sitemap.ts's own list: every non-dynamic page route that is neither
 * session-scoped (account, group-order), a gate prompt (age-gate), an
 * auth/transactional flow (login, register, newsletter), the operator
 * console (ops), nor token-scoped (share). Task 6.2 pins the sitemap to
 * this inventory so a new public route cannot ship unadvertised — the
 * same filesystem scan layout.ssr.test.tsx uses for the chrome contract.
 */
const PUBLIC_STATIC_ROUTES = [
  '/',
  '/about',
  '/allowances',
  '/basket',
  '/blog',
  '/calculator',
  '/compare',
  '/contact',
  '/event',
  '/guides',
  '/products',
  '/ranking',
  '/savings',
  '/trip',
  '/value',
  '/what-if',
] as const;

/** Route prefixes that are public pages but never sitemap entries. */
const NON_ADVERTISED_PREFIXES = [
  '/account',
  '/age-gate',
  '/group-order',
  '/login',
  '/register',
  '/newsletter',
  '/ops',
  '/share',
] as const;

describe('sitemap vs the public route inventory (task 6.2)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Non-dynamic page routes under [locale] that are public destinations. */
  function publicPageRoutesFromDisk(): string[] {
    const appDir = path.dirname(fileURLToPath(import.meta.url));
    const localeDir = path.join(appDir, '[locale]');
    return collectPageRoutes(localeDir, localeDir).filter(
      (route) =>
        !route.includes('[') &&
        !(NON_ADVERTISED_PREFIXES as readonly string[]).some((prefix) =>
          route === prefix || route.startsWith(`${prefix}/`),
        ),
    );
  }

  it('the on-disk public page inventory is exactly the pinned route list', () => {
    expect(publicPageRoutesFromDisk().sort()).toEqual([...PUBLIC_STATIC_ROUTES].sort());
  });

  it.each(['', '/en'] as const)('every public route is advertised for the "%s" URL space', async (prefix) => {
    const entries = await sitemap();
    const advertised = new Set(
      entries
        .map((entry) => entry.url)
        .filter((url) => url.startsWith(`https://rajahinta.fi${prefix}`))
        // Keep only the static path itself (strip query, e.g. the
        // /products?category=… category views). The bare locale root
        // (https://…fi/en) is the '' static path, i.e. route '/'.
        .map((url) => {
          const stripped = new URL(url).pathname.slice(prefix.length);
          return stripped === '' ? '/' : stripped;
        }),
    );

    for (const route of PUBLIC_STATIC_ROUTES) {
      expect(advertised, `${prefix || '/'}${route} is in the sitemap`).toContain(route);
    }
  });

  it('every advertised static URL serves an actual page (no dead entries)', async () => {
    const entries = await sitemap();
    const pages = new Set(publicPageRoutesFromDisk());

    for (const entry of entries) {
      const pathname = new URL(entry.url).pathname;
      const stripped =
        pathname === '/en' || pathname.startsWith('/en/')
          ? pathname.slice('/en'.length)
          : pathname;
      // The bare locale root (https://…fi/en) is the '' path.
      const withoutPrefix = stripped === '' ? '/' : stripped;
      expect(pages, `${entry.url} resolves to a page`).toContain(withoutPrefix);
    }
  });
});

/** Recursively collect [locale]-relative routes from page.tsx files. */
function collectPageRoutes(dir: string, localeRoot: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...collectPageRoutes(full, localeRoot));
    } else if (entry.name === 'page.tsx') {
      const rel = path.relative(localeRoot, dir);
      const route = rel === '' ? '/' : `/${rel.split(path.sep).join('/')}`;
      routes.push(route);
    }
  }
  return routes;
}
