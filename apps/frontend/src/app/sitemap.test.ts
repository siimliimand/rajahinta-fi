/**
 * Sitemap tests (task 3.3; inventory pin task 6.2; content-gated index
 * advertisement task 1.1; localized URLs + hreflang alternates task 2.1,
 * change localize-fi-route-pathnames).
 *
 * With every backend fetch degraded (the sitemap's own degradation
 * contract), the sitemap still emits the static destinations for both
 * URL spaces: Finnish serves the localized routing-vocabulary segments
 * bare (`/tuotteet`, `/laskuri`, …), English keeps the internal route
 * names under /en (`/en/products`, …). Every emitted URL maps back to a
 * defined `routing.pathnames` entry that serves a page, and every entry
 * pairs its localized variants as hreflang alternates with x-default →
 * the bare fi URL (design D6).
 *
 * @module SitemapTest
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sitemap from './sitemap';
import { routing } from '@/i18n/routing';

/** The deployment origin (mirrors SITE_URL's default). */
const SITE = 'https://rajahinta.fi';

/** URL space under test: bare (fi, default locale) or /en-prefixed. */
type UrlSpace = '' | '/en';

type PathnamesEntry = string | { fi: string; en: string };

/** routing.pathnames as a lookup table (shared segment or fi/en pair). */
const PATHNAMES = new Map<string, PathnamesEntry>(
  Object.entries(routing.pathnames),
);

function localeFor(prefix: UrlSpace): 'fi' | 'en' {
  return prefix === '' ? 'fi' : 'en';
}

/**
 * The prefix-stripped path an internal route serves in one URL space —
 * the emission direction of routing.pathnames (design D1): fi renders
 * the localized segment bare, en the internal route name under /en. The
 * locale root normalizes to '/', matching the advertised-set builders.
 */
function localizedRoute(route: string, prefix: UrlSpace): string {
  const entry = PATHNAMES.get(route) ?? route;
  return typeof entry === 'string' ? entry : entry[localeFor(prefix)];
}

/**
 * The internal route a prefix-stripped localized path maps back to in
 * one URL space — the reverse lookup the serve-invariant relies on.
 * Bracket segments ([id], [slug], …) match any single non-empty
 * segment; null when the path is not part of the routing vocabulary.
 */
function internalRouteFor(path: string, prefix: UrlSpace): string | null {
  const segments = path.split('/');
  for (const [route, entry] of PATHNAMES) {
    const segment =
      typeof entry === 'string' ? entry : entry[localeFor(prefix)];
    const template = segment.split('/');
    if (template.length !== segments.length) continue;
    const matches = template.every((part, index) =>
      part === segments[index] ||
      (part.startsWith('[') && part.endsWith(']') && segments[index] !== ''),
    );
    if (matches) return route;
  }
  return null;
}

/** Site-absolute URL for a prefix-stripped path (bare root, no slash). */
function siteUrl(path: string): string {
  return path === '/' ? SITE : `${SITE}${path}`;
}

/**
 * Reverse-map an emitted sitemap URL onto its internal route through
 * routing.pathnames (design D6): the fi space must match a localized fi
 * segment, the en space an internal route name under /en. Fails the
 * test when the URL is not defined in the vocabulary.
 */
function vocabularyRouteOf(url: string): {
  prefix: UrlSpace;
  path: string;
  route: string;
} {
  const parsed = new URL(url);
  const prefix: UrlSpace =
    parsed.pathname === '/en' || parsed.pathname.startsWith('/en/')
      ? '/en'
      : '';
  const stripped = parsed.pathname.slice(prefix.length);
  const path = stripped === '' ? '/' : stripped;
  const route = internalRouteFor(path, prefix);
  expect(route, `${url} is defined in routing.pathnames`).not.toBeNull();
  return { prefix, path, route: route as string };
}

describe('sitemap static paths (task 3.3)', () => {
  beforeEach(() => {
    // Backend unreachable → the degradation contract yields the static
    // routes minus the content-gated editorial indexes (task 1.1:
    // catalog/list/blog/guide fetches fail ⇒ /blogi and /oppaat
    // omitted).
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes /tietoja and /yhteystiedot for the default locale (localized fi segments, unprefixed)', async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain(`${SITE}/tietoja`);
    expect(urls).toContain(`${SITE}/yhteystiedot`);
  });

  it('includes /about and /contact for the en locale (/en prefix, internal route names)', async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain(`${SITE}/en/about`);
    expect(urls).toContain(`${SITE}/en/contact`);
  });
});

/**
 * The public static routes a crawler may be advertised, independent of
 * sitemap.ts's own list: every non-dynamic page route that is neither
 * session-scoped (account), a gate prompt (age-gate), an auth/transactional
 * flow (login, register, newsletter), the operator console (ops), nor
 * token-scoped (share). The group-order create page is a public static
 * route (consumer-clarity-and-discovery 4.1) — its dynamic [token] session
 * pages stay excluded by the bracket filter below. Task 6.2 pins the
 * sitemap to this inventory so a new public route cannot ship
 * unadvertised — the same filesystem scan layout.ssr.test.tsx uses for
 * the chrome contract.
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
  '/group-order',
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
 * task 1.1): a locale's editorial index appears only when that locale's
 * slug fetch returned published posts/guides.
 */
const UNCONDITIONAL_STATIC_ROUTES = PUBLIC_STATIC_ROUTES.filter(
  (route) => route !== '/blog' && route !== '/guides',
);

/** Route prefixes that are public pages but never sitemap entries. */
const NON_ADVERTISED_PREFIXES = [
  '/account',
  '/age-gate',
  '/login',
  '/register',
  '/newsletter',
  '/ops',
  '/share',
] as const;

/**
 * Prefix-stripped static paths advertised for one URL space.
 */
function advertisedPaths(entries: { url: string }[], prefix: UrlSpace): Set<string> {
  return new Set(
    entries
      .map((entry) => entry.url)
      .filter((url) => url.startsWith(`${SITE}${prefix}`))
      .map((url) => {
        const stripped = new URL(url).pathname.slice(prefix.length);
        return stripped === '' ? '/' : stripped;
      }),
  );
}

/**
 * Stub the backend the way the sitemap reads it: per-locale blog and
 * guide slug lists keyed by locale, served with `{ ok, json }` — the
 * surface the slug fetchers consume. Optionally serves curated lists
 * (by slug) and products (by id) for the dynamic-URL coverage; every
 * other endpoint returns an empty payload, the inert-shape degradation.
 */
function stubEditorialContent(options: {
  blog?: Record<string, string[]>;
  guides?: Record<string, string[]>;
  lists?: string[];
  products?: string[];
}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/api/v1/blog/posts')) {
        const slugs = options.blog?.[url.searchParams.get('locale') ?? ''] ?? [];
        return {
          ok: true,
          json: async () => ({ items: slugs.map((slug) => ({ slug })) }),
        };
      }
      if (url.pathname.endsWith('/api/v1/guides')) {
        const slugs = options.guides?.[url.searchParams.get('locale') ?? ''] ?? [];
        return {
          ok: true,
          json: async () => ({ items: slugs.map((slug) => ({ slug })) }),
        };
      }
      if (url.pathname.endsWith('/api/v1/lists')) {
        const lists = options.lists ?? [];
        return {
          ok: true,
          json: async () => ({
            lists: lists.map((slug) => ({ slug, title: slug })),
          }),
        };
      }
      if (url.pathname.endsWith('/api/v1/products')) {
        const products = options.products ?? [];
        return {
          ok: true,
          json: async () => ({ items: products.map((id) => ({ id })) }),
        };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    }),
  );
}

describe('sitemap vs the public route inventory (task 6.2)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the on-disk public page inventory is exactly the pinned route list', () => {
    expect(publicPageRoutesFromDisk().sort()).toEqual([...PUBLIC_STATIC_ROUTES].sort());
  });

  it.each(['', '/en'] as const)('every unconditional public route is advertised for the "%s" URL space', async (prefix) => {
    const entries = await sitemap();
    const advertised = advertisedPaths(entries, prefix);

    for (const route of UNCONDITIONAL_STATIC_ROUTES) {
      const localized = localizedRoute(route, prefix);
      expect(
        advertised,
        `${prefix || '/'}${localized} is in the sitemap`,
      ).toContain(localized);
    }
  });

  it('every emitted URL maps to a defined pathnames entry that serves a page (no dead entries)', async () => {
    const entries = await sitemap();
    const pages = new Set(allPageRoutesFromDisk());

    for (const entry of entries) {
      const { route } = vocabularyRouteOf(entry.url);
      expect(pages, `${entry.url} resolves to a page`).toContain(route);
    }
  });
});

/**
 * Content-aware index advertisement (change
 * sitemap-content-aware-advertisement, task 1.1). The per-locale blog
 * and guides index URLs derive from the slug fetches the sitemap
 * already performs — advertised only for locales with published
 * content, omitted otherwise, so every advertised URL serves. A
 * degraded fetch obeys the same contract as before (the sitemap never
 * fails) and additionally omits that locale's editorial indexes.
 * Task 2.1 localizes the URL text (fi /blogi and /oppaat) without
 * touching the gates.
 */
describe('sitemap content-aware index advertisement (task 1.1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('empty blog slugs for a locale → that locale\'s /blogi omitted, other static routes remain', async () => {
    stubEditorialContent({ blog: { fi: [] }, guides: { fi: ['kusikki'] } });
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).not.toContain(`${SITE}/blogi`);
    // The guide gate is independent: with guides present, /oppaat stays.
    expect(urls).toContain(`${SITE}/oppaat`);
    expect(urls).toContain(`${SITE}/saastolista`);
    expect(urls).toContain(`${SITE}/tuotteet`);
    expect(urls).toContain(`${SITE}/tietoja`);
  });

  it('non-empty blog slugs → /blogi advertised alongside its slug URLs', async () => {
    stubEditorialContent({ blog: { fi: ['olutreissu'] } });
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain(`${SITE}/blogi`);
    expect(urls).toContain(`${SITE}/blogi/olutreissu`);
  });

  it('guide-family parity: empty → /oppaat omitted, non-empty → advertised alongside slug URLs', async () => {
    stubEditorialContent({ guides: { fi: [] } });
    let urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).not.toContain(`${SITE}/oppaat`);

    stubEditorialContent({ guides: { fi: ['kusikki'] } });
    urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain(`${SITE}/oppaat`);
    expect(urls).toContain(`${SITE}/oppaat/kusikki`);
  });

  it('per-locale independence: a post in fi advertises /blogi but not /en/blog', async () => {
    stubEditorialContent({ blog: { fi: ['olutreissu'], en: [] } });
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain(`${SITE}/blogi`);
    expect(urls).not.toContain(`${SITE}/en/blog`);
    expect(urls).toContain(`${SITE}/blogi/olutreissu`);
    expect(urls).not.toContain(`${SITE}/en/blog/olutreissu`);
  });

  it('degraded blog/guide fetch (reject or !ok) → indexes omitted, sitemap stays valid', async () => {
    // Backend unreachable — the suite-wide degradation posture.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const degraded = (await sitemap()).map((entry) => entry.url);
    for (const url of [
      `${SITE}/blogi`,
      `${SITE}/en/blog`,
      `${SITE}/oppaat`,
      `${SITE}/en/guides`,
    ]) {
      expect(degraded).not.toContain(url);
    }
    // The non-editorial static surface remains advertised.
    for (const url of [
      SITE,
      `${SITE}/saastolista`,
      `${SITE}/tuotteet`,
      `${SITE}/en/about`,
    ]) {
      expect(degraded).toContain(url);
    }

    // A !ok response degrades identically.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const notOk = (await sitemap()).map((entry) => entry.url);
    expect(notOk).not.toContain(`${SITE}/blogi`);
    expect(notOk).not.toContain(`${SITE}/en/guides`);
  });

  it('with published content for both locales, the full public route inventory is advertised', async () => {
    stubEditorialContent({
      blog: { fi: ['olutreissu'], en: ['brew-trip'] },
      guides: { fi: ['kusikki'], en: ['party-guide'] },
    });

    for (const prefix of ['', '/en'] as const) {
      const advertised = advertisedPaths(await sitemap(), prefix);
      for (const route of PUBLIC_STATIC_ROUTES) {
        const localized = localizedRoute(route, prefix);
        expect(
          advertised,
          `${prefix || '/'}${localized} is in the sitemap`,
        ).toContain(localized);
      }
    }
  });
});

/**
 * Localized URL text and hreflang alternates (task 2.1, design D6): fi
 * URLs use the localized vocabulary segments bare (`/tuotteet`, never
 * the internal `/products`), en URLs keep the internal names under /en,
 * and every emitted URL pairs its localized variants as hreflang
 * alternates with x-default → the negotiating bare (fi) URL. Pairing
 * respects the content gates: an alternates map never points at a URL
 * the sitemap omits.
 */
describe('sitemap localized URLs and hreflang alternates (task 2.1)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('advertises the Finnish catalog at /tuotteet — never the bare internal /products', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain(`${SITE}/tuotteet`);
    expect(urls).toContain(`${SITE}/tuotteet?category=beer`);
    expect(urls).not.toContain(`${SITE}/products`);
    expect(urls).not.toContain(`${SITE}/products?category=beer`);
  });

  it('keeps the English catalog at /en/products', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain(`${SITE}/en/products`);
    expect(urls).toContain(`${SITE}/en/products?category=beer`);
  });

  it('pairs the localized catalog variants as hreflang alternates with x-default → the bare fi URL', async () => {
    const byUrl = new Map(
      (await sitemap()).map((entry) => [entry.url, entry] as const),
    );
    const expected = {
      'x-default': `${SITE}/tuotteet`,
      fi: `${SITE}/tuotteet`,
      en: `${SITE}/en/products`,
    };
    expect(byUrl.get(`${SITE}/tuotteet`)?.alternates?.languages).toEqual(expected);
    expect(byUrl.get(`${SITE}/en/products`)?.alternates?.languages).toEqual(expected);
  });

  it('every alternates map is honest: targets emitted, self-reference included, x-default the bare fi URL', async () => {
    const entries = await sitemap();
    const emitted = new Set(entries.map((entry) => entry.url));

    for (const entry of entries) {
      const { route } = vocabularyRouteOf(entry.url);
      const languages = entry.alternates?.languages ?? {};
      for (const target of Object.values(languages)) {
        expect(
          emitted,
          `alternate ${target} of ${entry.url} is emitted`,
        ).toContain(target);
      }
      expect(
        Object.values(languages),
        `${entry.url} lists itself as an alternate`,
      ).toContain(entry.url);
      // x-default is the fi variant of the same route (same query).
      const search = new URL(entry.url).search;
      expect(languages['x-default'], `${entry.url} x-default → bare fi`).toBe(
        `${siteUrl(localizedRoute(route, ''))}${search}`,
      );
    }
  });

  it('a content-gated variant is omitted from the pairing too (fi-only blog content)', async () => {
    stubEditorialContent({ blog: { fi: ['olutreissu'], en: [] } });
    const byUrl = new Map(
      (await sitemap()).map((entry) => [entry.url, entry] as const),
    );

    // /en/blog is gated off, so the fi /blogi pairing carries no en
    // alternate — and no x-default beyond the fi URL itself.
    expect(byUrl.get(`${SITE}/blogi`)?.alternates?.languages).toEqual({
      'x-default': `${SITE}/blogi`,
      fi: `${SITE}/blogi`,
    });
  });

  it('with published content in both locales, the editorial indexes pair fully', async () => {
    stubEditorialContent({
      blog: { fi: ['olutreissu'], en: ['brew-trip'] },
      guides: { fi: ['kusikki'], en: ['party-guide'] },
    });
    const byUrl = new Map(
      (await sitemap()).map((entry) => [entry.url, entry] as const),
    );
    const expectedBlog = {
      'x-default': `${SITE}/blogi`,
      fi: `${SITE}/blogi`,
      en: `${SITE}/en/blog`,
    };
    expect(byUrl.get(`${SITE}/blogi`)?.alternates?.languages).toEqual(expectedBlog);
    expect(byUrl.get(`${SITE}/en/blog`)?.alternates?.languages).toEqual(expectedBlog);
  });

  it('every emitted URL — dynamic slugs included — maps to a pathnames entry that serves, with emitted alternates', async () => {
    stubEditorialContent({
      blog: { fi: ['olutreissu'], en: ['brew-trip'] },
      guides: { fi: ['kusikki'], en: ['party-guide'] },
      lists: ['jouluset'],
      products: ['kapinalla-olut'],
    });
    const entries = await sitemap();
    const pages = new Set(allPageRoutesFromDisk());
    const emitted = new Set(entries.map((entry) => entry.url));

    for (const entry of entries) {
      const { route } = vocabularyRouteOf(entry.url);
      expect(pages, `${entry.url} resolves to a page`).toContain(route);
      for (const target of Object.values(entry.alternates?.languages ?? {})) {
        expect(
          emitted,
          `alternate ${target} of ${entry.url} is emitted`,
        ).toContain(target);
      }
    }

    // The dynamic templates were actually exercised.
    expect(emitted).toContain(`${SITE}/blogi/olutreissu`);
    expect(emitted).toContain(`${SITE}/en/products/kapinalla-olut`);
    expect(emitted).toContain(`${SITE}/listat/jouluset`);
  });
});

/**
 * Every page route under [locale], scanned from disk (internal route
 * names, dynamic [param] segments included) — the serve-invariant set.
 */
function allPageRoutesFromDisk(): string[] {
  const appDir = path.dirname(fileURLToPath(import.meta.url));
  const localeDir = path.join(appDir, '[locale]');
  return collectPageRoutes(localeDir, localeDir);
}

/**
 * The public static subset of the disk inventory: no dynamic segments
 * and none of the never-advertised prefixes (session-scoped account,
 * gates, auth/transactional flows, ops console, token-scoped share).
 */
function publicPageRoutesFromDisk(): string[] {
  return allPageRoutesFromDisk().filter(
    (route) =>
      !route.includes('[') &&
      !(NON_ADVERTISED_PREFIXES as readonly string[]).some((prefix) =>
        route === prefix || route.startsWith(`${prefix}/`),
      ),
  );
}

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
