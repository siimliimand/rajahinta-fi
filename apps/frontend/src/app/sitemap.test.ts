/**
 * Sitemap tree tests (task 3.3; inventory pin task 6.2; content-gated
 * index advertisement task 1.1; localized URLs + hreflang alternates
 * task 2.1, change localize-fi-route-pathnames; index tree + route
 * handlers task 2.2, change sitemap-tree-coverage).
 *
 * `/sitemap.xml` is a sitemapindex over the descriptive tree
 * (`app/sitemap.xml/route.ts`); `/sitemaps/[tree]`
 * (`app/sitemaps/[tree]/route.ts`) serves the `pages` and `editorial`
 * urlsets plus the `products-N` paired chunks (task 2.3: one
 * 5,000-product id-ordered slice per chunk, fi+en URLs of the same
 * slice in one file, the endpoint's truthful lastmod, honest absence
 * past the chunk count, an honest empty urlset on a degraded read).
 * The suites below assert
 * against those handlers: with every backend fetch degraded (the
 * sitemap's own degradation contract), the `pages` tree still emits
 * the static destinations for both URL spaces — Finnish serves the
 * localized routing-vocabulary segments bare (`/tuotteet`,
 * `/laskuri`, …), English keeps the internal route names under /en
 * (`/en/products`, …). Every emitted URL maps back to a defined
 * `routing.pathnames` entry that serves a page, every entry pairs its
 * localized variants as hreflang alternates with x-default → the bare
 * fi URL, and every pair is co-located inside one document (design
 * D1/D6). The index references only children that serve: an empty
 * editorial store omits the `editorial` child, a degraded
 * enumeration omits the `products-N` children, and `pages` always
 * serves (D4).
 *
 * @module SitemapTreeTest
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GET as indexGET } from './sitemap.xml/route';
import { GET as treeGET } from './sitemaps/[tree]/route';
import { routing } from '@/i18n/routing';
import { PRODUCT_CHUNK_SIZE } from '@/lib/sitemap-xml';

// notFound() in a real request aborts with Next's 404 fallback — a
// throw is the observable equivalent outside a Next runtime.
const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

/** The deployment origin (mirrors SITE_URL's default). */
const SITE = 'https://rajahinta.fi';

/** The tree-document origin paths the index references. */
const TREE = {
  pages: `${SITE}/sitemaps/pages`,
  editorial: `${SITE}/sitemaps/editorial`,
  products: (chunk: number) => `${SITE}/sitemaps/products-${chunk}`,
};

/** URL space under test: bare (fi, default locale) or /en-prefixed. */
type UrlSpace = '' | '/en';

type PathnamesEntry = string | { fi: string; en: string };

/**
 * The tax-change calendar pair (tax-change-calendar task 4.4): its two
 * physical folders sit deliberately OUTSIDE routing.pathnames — the
 * pages hand-write their canonical/hreflang pair (calendar-page design
 * D6) — so the vocabulary lookup below extends the map by hand with
 * exactly that pair. Each folder's disk route resolves to the same two
 * localized variants, mirroring what the pages actually render.
 */
const CALENDAR_PAIR: PathnamesEntry = { fi: '/veromuutokset', en: '/tax-changes' };

/** routing.pathnames plus the hand-written calendar pair (see above). */
const PATHNAMES = new Map<string, PathnamesEntry>([
  ...Object.entries(routing.pathnames),
  ['/tax-changes', CALENDAR_PAIR],
  ['/veromuutokset', CALENDAR_PAIR],
]);

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
 * The bracket-parameter values of one emitted URL against its route
 * template in one URL space — the substitution input for computing the
 * same resource's variant in the other locale (same route, same
 * params, same query — the builder's grouping key).
 */
function templateParams(
  url: string,
  route: string,
  prefix: UrlSpace,
): Record<string, string> {
  const entry = PATHNAMES.get(route) ?? route;
  const template =
    typeof entry === 'string' ? entry : entry[localeFor(prefix)];
  const segments = new URL(url).pathname.slice(prefix.length).split('/');
  const params: Record<string, string> = {};
  template.split('/').forEach((part, index) => {
    if (part.startsWith('[') && part.endsWith(']')) {
      params[part.slice(1, -1)] = decodeURIComponent(segments[index] ?? '');
    }
  });
  return params;
}

/** The bare-fi URL of the same resource (route + params + query). */
function fiVariantOf(url: string, route: string): string {
  const search = new URL(url).search;
  const params = templateParams(url, route, '/en');
  const fiPath = localizedRoute(route, '')
    .split('/')
    .map((part) =>
      part.startsWith('[') && part.endsWith(']')
        ? encodeURIComponent(params[part.slice(1, -1)] ?? '')
        : part,
    )
    .join('/');
  return `${siteUrl(fiPath)}${search}`;
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

// ---------------------------------------------------------------------------
// Route-handler invocation + document parsing
// ---------------------------------------------------------------------------

/** Invoke the index handler (GET /sitemap.xml). */
function fetchIndex(): Promise<Response> {
  return indexGET();
}

/** Invoke the tree handler for one tree slug (GET /sitemaps/[tree]). */
function fetchTree(tree: string): Promise<Response> {
  return treeGET(new Request(`${SITE}/sitemaps/${tree}`), {
    params: Promise.resolve({ tree }),
  });
}

/** All `<loc>` values of a sitemap document, in document order. */
function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
}

/** One parsed `<url>` of a urlset document. */
interface ParsedUrlEntry {
  url: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
  alternates: Record<string, string>;
}

/** Parse a urlset document back into entries (serializer shape). */
function parseUrlset(xml: string): ParsedUrlEntry[] {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => {
    const block = match[1];
    const url = block.match(/<loc>(.*?)<\/loc>/)![1];
    const lastmod = block.match(/<lastmod>(.*?)<\/lastmod>/)?.[1];
    const alternates: Record<string, string> = {};
    for (const link of block.matchAll(
      /<xhtml:link rel="alternate" hreflang="(.*?)" href="(.*?)" \/>/g,
    )) {
      alternates[link[1]] = link[2];
    }
    const changefreq = block.match(/<changefreq>(.*?)<\/changefreq>/)?.[1];
    const priority = block.match(/<priority>(.*?)<\/priority>/)?.[1];
    return { url, lastmod, changefreq, priority, alternates };
  });
}

/**
 * Fetch one tree child and assert it serves: 200 and
 * `application/xml` — the contract every index-referenced child must
 * hold (spec: Index lists live children only).
 */
async function treeDocument(tree: string): Promise<{
  xml: string;
  urls: string[];
  entries: ParsedUrlEntry[];
}> {
  const res = await fetchTree(tree);
  expect(res.status, `${tree} serves`).toBe(200);
  expect(
    res.headers.get('content-type'),
    `${tree} serves application/xml`,
  ).toBe('application/xml');
  const xml = await res.text();
  return { xml, urls: locs(xml), entries: parseUrlset(xml) };
}

// ---------------------------------------------------------------------------
// Backend stubs
// ---------------------------------------------------------------------------

/**
 * Stub the backend the way the sitemap reads it: per-locale blog and
 * guide slug lists keyed by locale, served with `{ ok, json }` — the
 * surface the slug fetchers consume. Optionally serves curated lists
 * (by slug), products (by id) for the dynamic-URL coverage, and the
 * enumeration endpoint's total for the products-N chunk references;
 * every other endpoint returns an empty payload, the inert-shape
 * degradation.
 */
function stubEditorialContent(options: {
  blog?: Record<string, string[]>;
  guides?: Record<string, string[]>;
  lists?: string[];
  products?: string[];
  productTotal?: number;
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
      if (url.pathname.endsWith('/api/v1/products/ids')) {
        return {
          ok: true,
          json: async () => ({ items: [], total: options.productTotal ?? 0 }),
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

/** Stub every backend read as unreachable — the suite-wide degradation posture. */
function stubBackendDown(): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
}

/** One enumerated catalog row, as `/api/v1/products/ids` serves it (task 1.1). */
interface FixtureProduct {
  id: number;
  lastmod: string;
}

/** Ascending-id fixture catalog with a distinct truthful lastmod per row. */
function productCatalog(count: number, firstId = 1): FixtureProduct[] {
  return Array.from({ length: count }, (_, index) => ({
    id: firstId + index,
    lastmod: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));
}

/**
 * Stub the enumeration endpoint (GET /api/v1/products/ids, tasks
 * 1.1/2.3) with a real id-ordered slice implementation: `offset` and
 * `limit` honored, `limit` clamped at the endpoint's 5,000 cap, `total`
 * the catalog length. `catalog === null` stubs every read as
 * unreachable — the degraded-read shape getServerProductIds translates
 * to null. `options.omitTotal` serves the items without a `total` (a
 * misbehaving endpoint); `options.total` overrides the served total.
 * Any other endpoint answers empty — the inert-shape degradation.
 */
function stubProductEnumeration(
  catalog: readonly FixtureProduct[] | null,
  options?: { total?: number; omitTotal?: boolean },
): void {
  if (catalog === null) {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    return;
  }
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/api/v1/products/ids')) {
        const offset = Number(url.searchParams.get('offset') ?? '0');
        const limit = Math.min(
          Number(url.searchParams.get('limit') ?? '5'),
          PRODUCT_CHUNK_SIZE,
        );
        const body: Record<string, unknown> = {
          items: catalog.slice(offset, offset + limit),
        };
        if (!options?.omitTotal) {
          body.total = options?.total ?? catalog.length;
        }
        return { ok: true, json: async () => body };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    }),
  );
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sitemap static paths (task 3.3)', () => {
  beforeEach(() => {
    // Backend unreachable → the degradation contract yields the pages
    // tree's unconditional static destinations (task 1.1: fetches fail
    // ⇒ no editorial URLs; D4: the index still references `pages`).
    stubBackendDown();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes /tietoja and /yhteystiedot for the default locale (localized fi segments, unprefixed)', async () => {
    const { urls } = await treeDocument('pages');

    expect(urls).toContain(`${SITE}/tietoja`);
    expect(urls).toContain(`${SITE}/yhteystiedot`);
  });

  it('includes /about and /contact for the en locale (/en prefix, internal route names)', async () => {
    const { urls } = await treeDocument('pages');

    expect(urls).toContain(`${SITE}/en/about`);
    expect(urls).toContain(`${SITE}/en/contact`);
  });

  it('includes the tax-change calendar pair: /veromuutokset (fi) and /en/tax-changes (en variant)', async () => {
    // The calendar folders sit outside the localized-pathnames
    // vocabulary, so the sitemap advertises the pair by hand
    // (tax-change-calendar task 4.4) — this pin keeps it listed.
    const urls = (await treeDocument('pages')).urls;

    expect(urls).toContain(`${SITE}/veromuutokset`);
    expect(urls).toContain(`${SITE}/en/tax-changes`);
    // The cross-negotiation URLs never appear: each folder redirects
    // there (one URL per locale — the pages' own canonical rule).
    expect(urls).not.toContain(`${SITE}/en/veromuutokset`);
    expect(urls).not.toContain(`${SITE}/tax-changes`);
  });
});

/**
 * The public static routes a crawler may be advertised, independent of
 * the pages tree's own list: every non-dynamic page route that is
 * neither session-scoped (account), a gate prompt (age-gate), an
 * auth/transactional flow (login, register, newsletter), the operator
 * console (ops), nor token-scoped (share). The group-order create page
 * is a public static route (consumer-clarity-and-discovery 4.1) — its
 * dynamic [token] session pages stay excluded by the bracket filter
 * below. Task 6.2 pins the sitemap to this inventory so a new public
 * route cannot ship unadvertised — the same filesystem scan
 * layout.ssr.test.tsx uses for the chrome contract. The two editorial
 * indexes live in the `editorial` tree (task 2.2), not `pages`.
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
  '/tax-changes',
  '/trip',
  '/value',
  '/veromuutokset',
  '/what-if',
] as const;

/**
 * The public static routes the `pages` tree advertises unconditionally,
 * independent of backend content — every route above except the two
 * editorial indexes, which the `editorial` tree carries, content-gated
 * per locale (sitemap-content-aware-advertisement task 1.1): a
 * locale's editorial index appears only when that locale's slug fetch
 * returned published posts/guides.
 */
const UNCONDITIONAL_STATIC_ROUTES = PUBLIC_STATIC_ROUTES.filter(
  (route) => route !== '/blog' && route !== '/guides',
);

/** Route prefixes that are public pages but never sitemap entries. */
const NON_ADVERTISED_PREFIXES = [
  '/account',
  '/age-gate',
  '/login',
  '/onboarding',
  '/register',
  '/newsletter',
  '/ops',
  '/share',
] as const;

/**
 * Prefix-stripped static paths advertised for one URL space.
 */
function advertisedPaths(entries: ParsedUrlEntry[], prefix: UrlSpace): Set<string> {
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

describe('sitemap vs the public route inventory (task 6.2)', () => {
  beforeEach(() => {
    stubBackendDown();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the on-disk public page inventory is exactly the pinned route list', () => {
    expect(publicPageRoutesFromDisk().sort()).toEqual([...PUBLIC_STATIC_ROUTES].sort());
  });

  it.each(['', '/en'] as const)('every unconditional public route is advertised in the pages tree for the "%s" URL space', async (prefix) => {
    const { entries } = await treeDocument('pages');
    const advertised = advertisedPaths(entries, prefix);

    for (const route of UNCONDITIONAL_STATIC_ROUTES) {
      const localized = localizedRoute(route, prefix);
      expect(
        advertised,
        `${prefix || '/'}${localized} is in the pages tree`,
      ).toContain(localized);
    }
  });

  it('every emitted URL — pages and editorial trees alike — maps to a defined pathnames entry that serves a page (no dead entries)', async () => {
    stubEditorialContent({ lists: ['jouluset'], blog: { fi: ['olutreissu'] } });
    const pages = new Set(allPageRoutesFromDisk());

    for (const tree of ['pages', 'editorial'] as const) {
      const { entries } = await treeDocument(tree);
      for (const entry of entries) {
        const { route } = vocabularyRouteOf(entry.url);
        expect(pages, `${entry.url} (${tree}) resolves to a page`).toContain(route);
      }
    }
  });
});

/**
 * Content-aware index advertisement (change
 * sitemap-content-aware-advertisement, task 1.1; sitemap-tree-coverage
 * task 2.2 lifts it one level, design D4). The per-locale blog and
 * guides index URLs derive from the slug fetches the builder already
 * performs — advertised only for locales with published content,
 * omitted otherwise, so every advertised URL serves. The `editorial`
 * TREE still serves an honest (empty) urlset when its stores are
 * empty or degraded — the sitemap never fails — but the INDEX omits
 * the child entirely while no store holds published entries.
 */
describe('sitemap content-aware index advertisement (task 1.1, lifted to the tree — task 2.2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('empty editorial stores → /blogi and /oppaat absent from the editorial tree, which still serves', async () => {
    stubEditorialContent({ blog: { fi: [] }, guides: { fi: [] } });
    const { urls } = await treeDocument('editorial');

    expect(urls).not.toContain(`${SITE}/blogi`);
    expect(urls).not.toContain(`${SITE}/oppaat`);
  });

  it('non-empty blog slugs → /blogi advertised alongside its slug URLs', async () => {
    stubEditorialContent({ blog: { fi: ['olutreissu'] } });
    const urls = (await treeDocument('editorial')).urls;

    expect(urls).toContain(`${SITE}/blogi`);
    expect(urls).toContain(`${SITE}/blogi/olutreissu`);
  });

  it('guide-family parity: empty → /oppaat omitted, non-empty → advertised alongside slug URLs', async () => {
    stubEditorialContent({ guides: { fi: [] } });
    let urls = (await treeDocument('editorial')).urls;
    expect(urls).not.toContain(`${SITE}/oppaat`);

    stubEditorialContent({ guides: { fi: ['kusikki'] } });
    urls = (await treeDocument('editorial')).urls;
    expect(urls).toContain(`${SITE}/oppaat`);
    expect(urls).toContain(`${SITE}/oppaat/kusikki`);
  });

  it('per-locale independence: a post in fi advertises /blogi but not /en/blog', async () => {
    stubEditorialContent({ blog: { fi: ['olutreissu'], en: [] } });
    const urls = (await treeDocument('editorial')).urls;

    expect(urls).toContain(`${SITE}/blogi`);
    expect(urls).not.toContain(`${SITE}/en/blog`);
    expect(urls).toContain(`${SITE}/blogi/olutreissu`);
    expect(urls).not.toContain(`${SITE}/en/blog/olutreissu`);
  });

  it('degraded blog/guide fetch (reject or !ok) → indexes omitted, editorial tree stays a valid urlset', async () => {
    // Backend unreachable — the suite-wide degradation posture.
    stubBackendDown();
    let { urls } = await treeDocument('editorial');
    for (const url of [
      `${SITE}/blogi`,
      `${SITE}/en/blog`,
      `${SITE}/oppaat`,
      `${SITE}/en/guides`,
    ]) {
      expect(urls).not.toContain(url);
    }

    // A !ok response degrades identically.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    ({ urls } = await treeDocument('editorial'));
    expect(urls).not.toContain(`${SITE}/blogi`);
    expect(urls).not.toContain(`${SITE}/en/guides`);
  });

  it('with published content for both locales, the editorial indexes pair into the editorial tree and the pages tree keeps the unconditional inventory', async () => {
    stubEditorialContent({
      blog: { fi: ['olutreissu'], en: ['brew-trip'] },
      guides: { fi: ['kusikki'], en: ['party-guide'] },
    });

    // The pages tree carries every unconditional route, both locales.
    for (const prefix of ['', '/en'] as const) {
      const advertised = advertisedPaths((await treeDocument('pages')).entries, prefix);
      for (const route of UNCONDITIONAL_STATIC_ROUTES) {
        const localized = localizedRoute(route, prefix);
        expect(
          advertised,
          `${prefix || '/'}${localized} is in the pages tree`,
        ).toContain(localized);
      }
    }

    // The editorial indexes live in the editorial tree, never pages.
    const pagesUrls = (await treeDocument('pages')).urls;
    const editorialUrls = (await treeDocument('editorial')).urls;
    for (const url of [
      `${SITE}/blogi`,
      `${SITE}/en/blog`,
      `${SITE}/oppaat`,
      `${SITE}/en/guides`,
    ]) {
      expect(pagesUrls).not.toContain(url);
      expect(editorialUrls).toContain(url);
    }
  });
});

/**
 * The sitemap index (`/sitemap.xml`, task 2.2, design D4/D6): a
 * sitemapindex referencing only children that serve — `pages` always,
 * `editorial` while its stores hold published entries, `products-N`
 * from the enumerated total — with ISR revalidate 900 s and the
 * crawler-honest 404 outside the tree vocabulary.
 */
describe('sitemap index tree (task 2.2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('every referenced child serves 200 application/xml', async () => {
    stubEditorialContent({
      lists: ['jouluset'],
      blog: { fi: ['olutreissu'], en: ['brew-trip'] },
      guides: { fi: ['kusikki'], en: ['party-guide'] },
      productTotal: 12_345, // ceil(12 345 / 5 000) → products-0..2
    });
    const indexRes = await fetchIndex();
    expect(indexRes.status).toBe(200);
    expect(indexRes.headers.get('content-type')).toBe('application/xml');
    const children = locs(await indexRes.text());

    expect(new Set(children)).toEqual(
      new Set([TREE.pages, TREE.editorial, TREE.products(0), TREE.products(1), TREE.products(2)]),
    );
    for (const child of children) {
      const slug = child.replace(`${SITE}/sitemaps/`, '');
      await treeDocument(slug); // asserts 200 + application/xml
    }
  });

  it('empty editorial stores → the editorial child is absent from the index', async () => {
    // Stores reachable but empty, catalog total 0 — nothing to reference
    // beyond the static tree (D4: no dead or empty-store references).
    stubEditorialContent({ productTotal: 0 });
    const children = locs(await (await fetchIndex()).text());

    expect(children).toEqual([TREE.pages]);
    expect(children).not.toContain(TREE.editorial);
  });

  it('a degraded backend read keeps the static tree: the index references exactly pages', async () => {
    stubBackendDown();
    const children = locs(await (await fetchIndex()).text());

    expect(children).toEqual([TREE.pages]);
  });

  it('the products chunk count derives from the enumerated total at the 5,000 chunk size (D2)', async () => {
    stubEditorialContent({ productTotal: 20_839 }); // production-scale → 5 chunks
    const children = locs(await (await fetchIndex()).text());

    expect(children).toEqual([
      TREE.pages,
      TREE.products(0),
      TREE.products(1),
      TREE.products(2),
      TREE.products(3),
      TREE.products(4),
    ]);
  });

  it('any path outside the tree vocabulary 404s — never an empty or guessed sitemap', async () => {
    stubBackendDown();
    for (const slug of [
      'unknown',
      'editorials',
      'products',
      'products-',
      'products-1x',
      'products-0x1',
      'Pages',
    ]) {
      await expect(fetchTree(slug), `sitemaps/${slug} 404s`).rejects.toBe(NOT_FOUND);
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
 * the document omits — and every pair sits inside ONE document of the
 * tree (bi-locale co-location, design D1).
 */
describe('sitemap localized URLs and hreflang alternates (task 2.1, on the tree — task 2.2)', () => {
  beforeEach(() => {
    stubBackendDown();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('advertises the Finnish catalog at /tuotteet — never the bare internal /products', async () => {
    const urls = (await treeDocument('pages')).urls;

    expect(urls).toContain(`${SITE}/tuotteet`);
    expect(urls).toContain(`${SITE}/tuotteet?category=beer`);
    expect(urls).not.toContain(`${SITE}/products`);
    expect(urls).not.toContain(`${SITE}/products?category=beer`);
  });

  it('keeps the English catalog at /en/products', async () => {
    const urls = (await treeDocument('pages')).urls;

    expect(urls).toContain(`${SITE}/en/products`);
    expect(urls).toContain(`${SITE}/en/products?category=beer`);
  });

  it('pairs the localized catalog variants as hreflang alternates with x-default → the bare fi URL', async () => {
    const entries = (await treeDocument('pages')).entries;
    const byUrl = new Map(entries.map((entry) => [entry.url, entry] as const));
    const expected = {
      'x-default': `${SITE}/tuotteet`,
      fi: `${SITE}/tuotteet`,
      en: `${SITE}/en/products`,
    };
    expect(byUrl.get(`${SITE}/tuotteet`)?.alternates).toEqual(expected);
    expect(byUrl.get(`${SITE}/en/products`)?.alternates).toEqual(expected);
  });

  it('pairs the calendar variants with the exact hreflang symmetry the pages render', async () => {
    // The sitemap's pair must equal the canonical/hreflang metadata the
    // two calendar pages hand-write (calendar-page design D6) — the
    // crawler-visible pairing cannot drift from the documents it pairs.
    const entries = (await treeDocument('pages')).entries;
    const byUrl = new Map(entries.map((entry) => [entry.url, entry] as const));
    const expected = {
      'x-default': `${SITE}/veromuutokset`,
      fi: `${SITE}/veromuutokset`,
      en: `${SITE}/en/tax-changes`,
    };
    expect(byUrl.get(`${SITE}/veromuutokset`)?.alternates).toEqual(expected);
    expect(byUrl.get(`${SITE}/en/tax-changes`)?.alternates).toEqual(expected);
  });

  it('bi-locale alternates are co-located: every alternates target of an entry sits in the SAME document', async () => {
    // design D1: the tree is uniformly bi-locale per document — no
    // alternate may point into another file of the tree.
    stubEditorialContent({
      blog: { fi: ['olutreissu'], en: ['brew-trip'] },
      guides: { fi: ['kusikki'], en: ['party-guide'] },
      lists: ['jouluset'],
    });
    for (const tree of ['pages', 'editorial'] as const) {
      const { urls, entries } = await treeDocument(tree);
      const emitted = new Set(urls);
      for (const entry of entries) {
        for (const [hreflang, target] of Object.entries(entry.alternates)) {
          expect(
            emitted,
            `${tree}: alternate ${hreflang}=${target} of ${entry.url} is emitted in the same document`,
          ).toContain(target);
        }
      }
    }
  });

  it('every alternates map is honest: targets emitted, self-reference included, x-default the bare fi URL', async () => {
    stubEditorialContent({
      blog: { fi: ['olutreissu'], en: ['brew-trip'] },
      guides: { fi: ['kusikki'], en: ['party-guide'] },
      lists: ['jouluset'],
    });
    for (const tree of ['pages', 'editorial'] as const) {
      const { entries } = await treeDocument(tree);
      const emitted = new Set(entries.map((entry) => entry.url));

      for (const entry of entries) {
        const { route } = vocabularyRouteOf(entry.url);
        for (const target of Object.values(entry.alternates)) {
          expect(
            emitted,
            `alternate ${target} of ${entry.url} (${tree}) is emitted`,
          ).toContain(target);
        }
        expect(
          Object.values(entry.alternates),
          `${entry.url} (${tree}) lists itself as an alternate`,
        ).toContain(entry.url);
        // x-default is the negotiating bare (fi) URL: on fi-space
        // entries it is the URL itself; on en-space entries it is the
        // same resource's fi variant when that is emitted, and absent
        // otherwise (per-locale editorial slugs with no fi variant —
        // no alternate may point at a URL the document omits).
        const xdefault = entry.alternates['x-default'];
        const enSpace =
          entry.url === `${SITE}/en` || entry.url.startsWith(`${SITE}/en/`);
        if (!enSpace) {
          expect(xdefault, `${entry.url} (fi) x-default → itself`).toBe(entry.url);
        } else {
          const fiVariant = fiVariantOf(entry.url, route);
          if (emitted.has(fiVariant)) {
            expect(xdefault, `${entry.url} x-default → its fi variant`).toBe(fiVariant);
          } else {
            expect(xdefault, `${entry.url} has no fi variant → no x-default`).toBeUndefined();
          }
        }
      }
    }
  });

  it('a content-gated variant is omitted from the pairing too (fi-only blog content)', async () => {
    stubEditorialContent({ blog: { fi: ['olutreissu'], en: [] } });
    const entries = (await treeDocument('editorial')).entries;
    const byUrl = new Map(entries.map((entry) => [entry.url, entry] as const));

    // /en/blog is gated off, so the fi /blogi pairing carries no en
    // alternate — and no x-default beyond the fi URL itself.
    expect(byUrl.get(`${SITE}/blogi`)?.alternates).toEqual({
      'x-default': `${SITE}/blogi`,
      fi: `${SITE}/blogi`,
    });
  });

  it('with published content in both locales, the editorial indexes pair fully', async () => {
    stubEditorialContent({
      blog: { fi: ['olutreissu'], en: ['brew-trip'] },
      guides: { fi: ['kusikki'], en: ['party-guide'] },
    });
    const entries = (await treeDocument('editorial')).entries;
    const byUrl = new Map(entries.map((entry) => [entry.url, entry] as const));
    const expectedBlog = {
      'x-default': `${SITE}/blogi`,
      fi: `${SITE}/blogi`,
      en: `${SITE}/en/blog`,
    };
    expect(byUrl.get(`${SITE}/blogi`)?.alternates).toEqual(expectedBlog);
    expect(byUrl.get(`${SITE}/en/blog`)?.alternates).toEqual(expectedBlog);
  });

  it('every emitted editorial URL — dynamic slugs included — maps to a pathnames entry that serves, with emitted alternates', async () => {
    stubEditorialContent({
      blog: { fi: ['olutreissu'], en: ['brew-trip'] },
      guides: { fi: ['kusikki'], en: ['party-guide'] },
      lists: ['jouluset'],
    });
    const { urls, entries } = await treeDocument('editorial');
    const pages = new Set(allPageRoutesFromDisk());
    const emitted = new Set(urls);

    for (const entry of entries) {
      const { route } = vocabularyRouteOf(entry.url);
      expect(pages, `${entry.url} resolves to a page`).toContain(route);
      for (const target of Object.values(entry.alternates)) {
        expect(
          emitted,
          `alternate ${target} of ${entry.url} is emitted`,
        ).toContain(target);
      }
    }

    // The dynamic templates were actually exercised.
    expect(emitted).toContain(`${SITE}/blogi/olutreissu`);
    expect(emitted).toContain(`${SITE}/listat/jouluset`);
  });

  it('product-detail URLs stay out of the pages and editorial trees (task 2.3 owns the products-N chunks)', async () => {
    // The builder still enumerates the listing page; the tree split
    // must not leak product URLs into the wrong children — the interim
    // honesty until task 2.3 fills the chunks.
    stubEditorialContent({ products: ['1487', '1488'] });
    const pagesUrls = new Set((await treeDocument('pages')).urls);
    const editorialUrls = new Set((await treeDocument('editorial')).urls);

    for (const url of [
      `${SITE}/tuotteet/1487`,
      `${SITE}/tuotteet/1488`,
      `${SITE}/en/products/1487`,
      `${SITE}/en/products/1488`,
    ]) {
      expect(pagesUrls, `${url} not in pages`).not.toContain(url);
      expect(editorialUrls, `${url} not in editorial`).not.toContain(url);
    }
    // The catalog base and category views remain in pages.
    expect(pagesUrls.has(`${SITE}/tuotteet`)).toBe(true);
  });
});

/**
 * The products-N paired chunks (task 2.3, design D1/D2/D3/D5): one
 * 5,000-product id-ordered offset slice per chunk, the fi+en URLs of
 * the same slice in ONE file (alternates stay in-chunk, D1), the
 * enumeration endpoint's truthful lastmod per URL (D5 — passthrough,
 * never fabricated), and the range honesty that keeps the index's
 * child list truthful (D4): a chunk at or past the enumerated chunk
 * count does not exist (404, the same convention as any slug outside
 * the served vocabulary), while a degraded enumeration read serves the
 * honest empty urlset — the sitemap never fails.
 */
describe('products-N paired chunks (task 2.3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves the fi+en pair of every product in its id-ordered slice with the endpoint’s truthful lastmod', async () => {
    const catalog = productCatalog(3, 11);
    stubProductEnumeration(catalog);
    const { entries } = await treeDocument('products-0');

    expect(entries.map((entry) => entry.url)).toEqual([
      `${SITE}/tuotteet/11`,
      `${SITE}/en/products/11`,
      `${SITE}/tuotteet/12`,
      `${SITE}/en/products/12`,
      `${SITE}/tuotteet/13`,
      `${SITE}/en/products/13`,
    ]);
    // Truthful passthrough: each emitted lastmod is exactly the value
    // the endpoint served for that product — never generation time (D5).
    const lastmodById = new Map(catalog.map((product) => [product.id, product.lastmod]));
    for (const entry of entries) {
      const id = Number(new URL(entry.url).pathname.split('/').pop());
      expect(entry.lastmod, `${entry.url} carries its product's lastmod`).toBe(
        lastmodById.get(id),
      );
    }
  });

  it('chunk membership is stable across regenerations — same slice read, byte-identical document', async () => {
    stubProductEnumeration(productCatalog(3, 11));
    const first = await (await fetchTree('products-0')).text();
    const second = await (await fetchTree('products-0')).text();
    expect(second).toBe(first);
  });

  it('reads the id-ordered offset slice: chunk N requests offset N·5,000 at the 5,000 limit (D2/D3)', async () => {
    stubProductEnumeration(productCatalog(3, 11));
    await treeDocument('products-0');
    // In-range check happens after the read, so the request of an
    // out-of-range chunk is observable too.
    await expect(fetchTree('products-1')).rejects.toBe(NOT_FOUND);

    const slices = vi
      .mocked(fetch)
      .mock.calls.map((call) => String(call[0]))
      .filter((url) => url.includes('/api/v1/products/ids'))
      .map((url) => {
        const parsed = new URL(url);
        return `${parsed.searchParams.get('offset')}+${parsed.searchParams.get('limit')}`;
      });
    expect(slices).toEqual(['0+5000', '5000+5000']);
  });

  it('keeps alternates in-chunk: x-default → the bare fi URL, the same set on the fi and en entries', async () => {
    const catalog = productCatalog(3, 11);
    stubProductEnumeration(catalog);
    const { xml, entries } = await treeDocument('products-0');
    const emitted = new Set(entries.map((entry) => entry.url));

    const linkLines = (block: string): string =>
      block
        .split('\n')
        .filter((line) => line.startsWith('<xhtml:link'))
        .join('\n');
    const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(
      (match) => match[1],
    );

    for (let index = 0; index < catalog.length; index += 1) {
      const product = catalog[index];
      const fi = `${SITE}/tuotteet/${product.id}`;
      const en = `${SITE}/en/products/${product.id}`;
      const expected = { 'x-default': fi, fi, en };
      const fiEntry = entries[index * 2];
      const enEntry = entries[index * 2 + 1];
      expect(fiEntry.url, `product ${product.id} fi entry first`).toBe(fi);
      expect(enEntry.url, `product ${product.id} en entry second`).toBe(en);
      expect(fiEntry.alternates).toEqual(expected);
      expect(enEntry.alternates).toEqual(expected);
      for (const target of Object.values(expected)) {
        expect(
          emitted,
          `${target} is emitted in the same chunk as its pair`,
        ).toContain(target);
      }
      // Full-document pairing honesty: the x-default/fi/en set is
      // byte-identical across the product's fi and en entries.
      expect(linkLines(blocks[index * 2 + 1])).toBe(linkLines(blocks[index * 2]));
    }
  });

  it('a degraded enumeration read → honest empty urlset, 200 xml, no fabricated lastmod (D5)', async () => {
    stubProductEnumeration(null);
    const res = await fetchTree('products-0');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml');
    const xml = await res.text();
    expect(xml).not.toContain('<url>');
    expect(xml).not.toContain('<lastmod>');
    expect(xml).toContain('</urlset>');
  });

  it('a chunk at or past the enumerated chunk count 404s — the index never references one (D4)', async () => {
    stubProductEnumeration(productCatalog(3, 11)); // total 3 → one chunk
    await expect(
      fetchTree('products-1'),
      'products-1 at the chunk count 404s',
    ).rejects.toBe(NOT_FOUND);
    await expect(
      fetchTree('products-99'),
      'products-99 far past the chunk count 404s',
    ).rejects.toBe(NOT_FOUND);
  });

  it('an empty catalog enumerates zero chunks — even products-0 is absent', async () => {
    stubProductEnumeration([]);
    await expect(fetchTree('products-0')).rejects.toBe(NOT_FOUND);
  });

  it('a total the endpoint never supplies counts as zero chunks — no guessed chunk (D4)', async () => {
    stubProductEnumeration(productCatalog(1, 500), { omitTotal: true });
    await expect(fetchTree('products-0')).rejects.toBe(NOT_FOUND);
  });

  it('the last partial chunk serves its remainder at the 5,000 boundary', async () => {
    stubProductEnumeration(productCatalog(5_001));
    const { entries } = await treeDocument('products-1');

    expect(entries.map((entry) => entry.url)).toEqual([
      `${SITE}/tuotteet/5001`,
      `${SITE}/en/products/5001`,
    ]);
  });

  it('chunks partition the catalog — every id exactly once, ascending, no 100-item cap', async () => {
    const catalog = productCatalog(5_001);
    stubProductEnumeration(catalog);
    const fiIds: number[] = [];
    const enUrls = new Set<string>();
    for (const chunk of ['products-0', 'products-1']) {
      const { entries } = await treeDocument(chunk);
      for (const entry of entries) {
        const pathname = new URL(entry.url).pathname;
        if (pathname.startsWith('/en/')) enUrls.add(entry.url);
        else fiIds.push(Number(pathname.split('/').pop()));
      }
    }

    // No listing-page cap: the first, the 101st, and the tail id all emit.
    expect(fiIds).toContain(1);
    expect(fiIds).toContain(101);
    expect(fiIds).toContain(5_001);
    // Partition: the ascending fi URLs are exactly the catalog, no overlap.
    expect(fiIds).toEqual(catalog.map((product) => product.id));
    expect(new Set(fiIds).size).toBe(fiIds.length);
    expect(enUrls.size).toBe(catalog.length);
  });

  it('the index references exactly the serving chunks: each 200s, the next one 404s (D4)', async () => {
    stubProductEnumeration(productCatalog(5_001));
    const children = locs(await (await fetchIndex()).text());

    expect(children).toEqual([TREE.pages, TREE.products(0), TREE.products(1)]);
    for (const child of children) {
      await treeDocument(child.replace(`${SITE}/sitemaps/`, ''));
    }
    await expect(fetchTree('products-2')).rejects.toBe(NOT_FOUND);
  });
});
