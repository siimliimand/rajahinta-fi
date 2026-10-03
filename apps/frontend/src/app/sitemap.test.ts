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
    // Backend unreachable → the degradation contract yields the static
    // routes minus the content-gated editorial indexes (task 1.1:
    // catalog/list/blog/guide fetches fail ⇒ /blog and /guides omitted).
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

/**
 * The public static routes advertised unconditionally, independent of
 * backend content — every route above except the two editorial indexes,
 * which are content-gated per locale (sitemap-content-aware-advertisement
 * task 1.1): a locale's /blog and /guides indexes appear only when that
 * locale's slug fetch returned published posts/guides.
 */
const UNCONDITIONAL_STATIC_ROUTES = PUBLIC_STATIC_ROUTES.filter(
  (route) => route !== '/blog' && route !== '/guides',
);

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

  it.each(['', '/en'] as const)('every unconditional public route is advertised for the "%s" URL space', async (prefix) => {
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

    for (const route of UNCONDITIONAL_STATIC_ROUTES) {
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

/**
 * Content-aware index advertisement (change
 * sitemap-content-aware-advertisement, task 1.1). The per-locale /blog
 * and /guides index URLs derive from the slug fetches the sitemap
 * already performs — advertised only for locales with published
 * content, omitted otherwise, so every advertised URL serves. A
 * degraded fetch obeys the same contract as before (the sitemap never
 * fails) and additionally omits that locale's editorial indexes.
 */
describe('sitemap content-aware index advertisement (task 1.1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Stub the backend the way the sitemap reads it: per-locale blog and
   * guide slug lists keyed by locale, served with `{ ok, json }` — the
   * surface the slug fetchers consume. Every other endpoint (products,
   * lists) returns an empty payload, the inert-shape degradation.
   */
  function stubEditorialContent(options: {
    blog?: Record<string, string[]>;
    guides?: Record<string, string[]>;
  }): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const slugs = url.pathname.endsWith('/api/v1/blog/posts')
          ? options.blog?.[url.searchParams.get('locale') ?? '']
          : url.pathname.endsWith('/api/v1/guides')
            ? options.guides?.[url.searchParams.get('locale') ?? '']
            : undefined;
        return {
          ok: true,
          json: async () => ({ items: (slugs ?? []).map((slug) => ({ slug })) }),
        };
      }),
    );
  }

  /** Static-path routes advertised for one URL space (prefix-stripped). */
  async function advertisedRoutes(prefix: '' | '/en'): Promise<Set<string>> {
    const entries = await sitemap();
    return new Set(
      entries
        .map((entry) => entry.url)
        .filter((url) => url.startsWith(`https://rajahinta.fi${prefix}`))
        .map((url) => {
          const stripped = new URL(url).pathname.slice(prefix.length);
          return stripped === '' ? '/' : stripped;
        }),
    );
  }

  it('empty blog slugs for a locale → that locale\'s /blog omitted, other static routes remain', async () => {
    stubEditorialContent({ blog: { fi: [] }, guides: { fi: ['kusikki'] } });
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).not.toContain('https://rajahinta.fi/blog');
    // The guide gate is independent: with guides present, /guides stays.
    expect(urls).toContain('https://rajahinta.fi/guides');
    expect(urls).toContain('https://rajahinta.fi/savings');
    expect(urls).toContain('https://rajahinta.fi/products');
    expect(urls).toContain('https://rajahinta.fi/about');
  });

  it('non-empty blog slugs → /blog advertised alongside its slug URLs', async () => {
    stubEditorialContent({ blog: { fi: ['olutreissu'] } });
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain('https://rajahinta.fi/blog');
    expect(urls).toContain('https://rajahinta.fi/blog/olutreissu');
  });

  it('guide-family parity: empty → /guides omitted, non-empty → advertised alongside slug URLs', async () => {
    stubEditorialContent({ guides: { fi: [] } });
    let urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).not.toContain('https://rajahinta.fi/guides');

    stubEditorialContent({ guides: { fi: ['kusikki'] } });
    urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain('https://rajahinta.fi/guides');
    expect(urls).toContain('https://rajahinta.fi/guides/kusikki');
  });

  it('per-locale independence: a post in fi advertises /blog but not /en/blog', async () => {
    stubEditorialContent({ blog: { fi: ['olutreissu'], en: [] } });
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain('https://rajahinta.fi/blog');
    expect(urls).not.toContain('https://rajahinta.fi/en/blog');
    expect(urls).toContain('https://rajahinta.fi/blog/olutreissu');
    expect(urls).not.toContain('https://rajahinta.fi/en/blog/olutreissu');
  });

  it('degraded blog/guide fetch (reject or !ok) → indexes omitted, sitemap stays valid', async () => {
    // Backend unreachable — the suite-wide degradation posture.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const degraded = (await sitemap()).map((entry) => entry.url);
    for (const url of [
      'https://rajahinta.fi/blog',
      'https://rajahinta.fi/en/blog',
      'https://rajahinta.fi/guides',
      'https://rajahinta.fi/en/guides',
    ]) {
      expect(degraded).not.toContain(url);
    }
    // The non-editorial static surface remains advertised.
    for (const url of [
      'https://rajahinta.fi',
      'https://rajahinta.fi/savings',
      'https://rajahinta.fi/products',
      'https://rajahinta.fi/en/about',
    ]) {
      expect(degraded).toContain(url);
    }

    // A !ok response degrades identically.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const notOk = (await sitemap()).map((entry) => entry.url);
    expect(notOk).not.toContain('https://rajahinta.fi/blog');
    expect(notOk).not.toContain('https://rajahinta.fi/en/guides');
  });

  it('with published content for both locales, the full public route inventory is advertised', async () => {
    stubEditorialContent({
      blog: { fi: ['olutreissu'], en: ['brew-trip'] },
      guides: { fi: ['kusikki'], en: ['party-guide'] },
    });

    for (const prefix of ['', '/en'] as const) {
      const advertised = await advertisedRoutes(prefix);
      for (const route of PUBLIC_STATIC_ROUTES) {
        expect(advertised, `${prefix || '/'}${route} is in the sitemap`).toContain(route);
      }
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
