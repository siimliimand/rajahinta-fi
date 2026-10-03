/**
 * Payload budget + per-route namespace split (first-impression-pass task
 * 2.3, design D6; web-application spec "Per-route message payload
 * budget").
 *
 * Four layers, mirroring how the app actually renders (only Next server
 * plumbing is mocked — the layout.ssr.test.tsx / crawlability harness
 * lineage):
 *
 *   1. Catalog payload budget — the real /products route renders with
 *      its production provider chain (root chrome subset → route
 *      segment subset → page) in BOTH locales, and the uncompressed
 *      payload stays under a ceiling pinned from the achieved baseline
 *      (never tuned to pass; exceeding fails with the observed size).
 *      renderToString does not emit Next's flight stream, so the two
 *      provider bundles the production HTML inlines as flight data are
 *      counted byte-for-byte alongside the SSR markup.
 *
 *   2. Namespace exactness — the catalog page's client bundle carries
 *      exactly the chrome plus its own namespaces; strangers (ranking,
 *      event calculator, what-if, …) are absent from the payload.
 *
 *   3. No raw translation keys — every golden route (home, products,
 *      product detail, ranking, what-if, calculator, contact) renders
 *      server HTML in both locales with not a single catalog key path
 *      rendered as literal text — the prod symptom of a namespace-map
 *      omission.
 *
 *   4. Enumeration tripwire — the split table
 *      (`@/lib/i18n/route-namespaces`) is recomputed from the source
 *      tree (every `use client` component, every `useTranslations`
 *      call) and must match exactly, in both directions: a route whose
 *      client tree needs a namespace without an entry fails (empty
 *      strings in prod), and a stale entry nothing uses fails too.
 *
 * @module PayloadBudgetTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import RootLayout from '../layout';
import HomePage from '../page';
import ContactPage from '../contact/page';
import ProductsPage from '../products/page';
import ProductsRouteLayout from '../products/layout';
import ProductPage from '../products/[id]/page';
import ProductDetailRouteLayout from '../products/[id]/layout';
import RankingPage from '../ranking/page';
import RankingRouteLayout from '../ranking/layout';
import WhatIfPage from '../what-if/page';
import WhatIfRouteLayout from '../what-if/layout';
import CalculatorPage from '../calculator/page';
import CalculatorRouteLayout from '../calculator/layout';
import fiMessages from '@/messages/fi.json';
import enMessages from '@/messages/en.json';
import {
  ROUTE_CLIENT_NAMESPACES,
  SHARED_CHROME_NAMESPACES,
  type MessageNamespace,
} from '@/lib/i18n/route-namespaces';
import { getClientMessages } from '@/lib/i18n/client-messages';
import { request, getServerProductDetail, getAccuracyStatistic } from '@/lib/api';
import type {
  PriceHistoryResponse,
  ProductDetailResponse,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — locale steerable through this hoisted object.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  locale: 'fi' as string,
  pathname: '/' as string,
  ageCookie: null as string | null,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'age_confirmed' && state.ageCookie !== null
        ? { name, value: state.ageCookie }
        : undefined,
  }),
}));

// Server copy resolves straight from the catalogs with {param}
// interpolation — the crawlability harness's resolver, locale-steered.
vi.mock('next-intl/server', () => ({
  getMessages: async () =>
    (await import(`@/messages/${state.locale}.json`)).default,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const locale = (typeof opts === 'object' && opts.locale) || state.locale;
    const table = (await import(`@/messages/${locale}.json`)).default as Record<
      string,
      unknown
    >;
    return (key: string, values?: Record<string, unknown>) => {
      // Dotted keys walk the namespace table (dynamic keys like
      // `category.${category}` are nested objects in the catalogs).
      const value = key.split('.').reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        ns ? table[ns] : table,
      );
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
  getLocale: async () => state.locale,
  setRequestLocale: () => undefined,
}));

vi.mock('next/font/google', () => ({
  Inter: () => Object.assign(() => null, { variable: '__variable_mock_inter' }),
}));

// Classic-JSX bridge: ui primitives resolve React from the global scope
// under vitest's esbuild transform (layout.ssr.test.tsx precedent).
(globalThis as { React?: typeof React }).React = React;

// The pages' server fetches stay offline and deterministic; everything
// else in the module keeps its real shape (crawlability precedent).
// getServerProductDetail/getAccuracyStatistic are overridden at module
// level because their internal request binding does not route through
// the mocked export.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
    getServerProductDetail: vi.fn(),
    getAccuracyStatistic: vi.fn(),
  };
});

// Chrome is byte-counted as its markers here — the real header/footer are
// pinned by layout.ssr.test.tsx, and the footer's publication-count
// fetches would make the budget nondeterministic.
vi.mock('../components/SiteHeader', () => ({
  default: () => React.createElement('header', { 'data-testid': 'site-header' }, 'CHROME-HEADER'),
}));
vi.mock('../components/SiteFooter', () => ({
  default: () => React.createElement('footer', { 'data-testid': 'site-footer' }, 'CHROME-FOOTER'),
}));

// The product detail page composes async server sub-panels (they fetch
// their own data); async components cannot pass through renderToString
// (products/[id]/page.test.tsx precedent — markers, exactly as there).
vi.mock('../products/[id]/components/ProductDupesPanel', () => ({
  default: () =>
    React.createElement('section', { 'data-testid': 'product-dupes-panel' }, 'DUPE-SHELL'),
}));
vi.mock('../products/[id]/components/ProductPriceContextLine', () => ({
  default: () =>
    React.createElement('p', { 'data-testid': 'price-context-line' }, 'PRICE-CONTEXT-SHELL'),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: (props: { href?: unknown; children?: React.ReactNode } & Record<string, unknown>) => {
    const { href, children, ...rest } = props;
    const target = String(href ?? '');
    const prefixed =
      state.locale === 'en' && target.startsWith('/') ? `/en${target}` : target;
    return React.createElement('a', { ...rest, href: prefixed }, children);
  },
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: () => undefined }),
}));

const mockedRequest = vi.mocked(request);

// ---------------------------------------------------------------------------
// Fixtures — shapes mirror the API contracts (crawlability / products
// page tests). Never asserted as copy; they only feed the render.
// ---------------------------------------------------------------------------

const CATALOG_ITEM = {
  id: 42,
  name: 'Fixture Beer',
  brand: 'Fixture Brewery',
  category: 'beer',
  alcoholByVolume: 0.375,
  unitVolume: '0,33 l',
  lowestPriceCents: 299,
  merchantCount: 2,
};

const DETAIL_RESPONSE: ProductDetailResponse = {
  product: {
    id: 42,
    name: 'Kotikalja 0.5 l',
    manufacturer: 'Panimo A',
    brand: 'Panimo A',
    category: 'beer',
    alcoholByVolume: 0.047,
    unitVolume: '0.5',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: false,
    ean: null,
  },
  offers: [
    {
      id: 12,
      merchant: 'alko',
      country: 'FI',
      priceCents: 1999,
      currency: 'EUR',
      availability: 'in_stock',
      sourceUrl: null,
      observedAt: '2026-09-10T06:00:00.000Z',
      reliabilityStatus: 'VERIFIED',
    },
  ],
};

const HISTORY_RESPONSE: PriceHistoryResponse = {
  productId: 42,
  merchant: null,
  metric: 'price',
  granularity: 'day',
  from: '2026-09-10',
  to: '2026-09-10',
  series: [
    {
      periodStart: '2026-09-10',
      openCents: 500,
      closeCents: 500,
      minCents: 450,
      maxCents: 550,
      avgCents: 500,
      observationCount: 2,
      reliability: 'VERIFIED' as const,
    },
  ],
  attribution: [],
  earliestAvailableObservationDate: '2026-09-10',
};

/** Route the mocked request by API path prefix; unplanned fetch throws. */
function mockServerFetches(): void {
  mockedRequest.mockImplementation(async (path: string): Promise<unknown> => {
    if (path.startsWith('/api/v1/products')) {
      return { items: [CATALOG_ITEM], total: 1, page: 1, limit: 24, totalPages: 1 };
    }
    if (path.startsWith('/api/v1/guides')) return { items: [], total: 0 };
    throw new Error(`unexpected server fetch in payload-budget test: ${path}`);
  });
  vi.mocked(getServerProductDetail).mockResolvedValue(DETAIL_RESPONSE);
  vi.mocked(getAccuracyStatistic).mockResolvedValue({
    count: 12,
    withinMarginShare: 0.83,
    asOf: '2026-09-10T06:00:00.000Z',
    label: { fi: 'käyttäjäilmoituksia', en: 'user reports' },
  });
  // The product page's price-history read rides global fetch directly.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/price-history')) {
        return { ok: true, json: async () => HISTORY_RESPONSE };
      }
      // Home's savings-overview and FAQ reads degrade honestly.
      throw new Error(`offline fetch in payload-budget test: ${url}`);
    }),
  );
}

// ---------------------------------------------------------------------------
// Production-wired render helper
// ---------------------------------------------------------------------------

type RouteLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

/** Segment layout component type (the ones the golden routes use). */
type RouteLayout = (props: RouteLayoutProps) => Promise<React.ReactNode>;

async function renderRouteWired(
  locale: 'fi' | 'en',
  page: () => Promise<React.ReactNode>,
  routeLayout?: RouteLayout,
): Promise<string> {
  state.locale = locale;
  state.pathname = '/';
  state.ageCookie = null;
  const pageElement = await page();
  const subtree = routeLayout
    ? await routeLayout({
        children: pageElement,
        params: Promise.resolve({ locale }),
      })
    : pageElement;
  return renderToString(
    await RootLayout({
      children: subtree as React.ReactNode,
      params: Promise.resolve({ locale }),
    }),
  );
}

/** The exact client message payload a production page request ships. */
async function pageMessagePayload(locale: 'fi' | 'en', routeKey: keyof typeof ROUTE_CLIENT_NAMESPACES | null) {
  const chrome = await getClientMessages(locale, SHARED_CHROME_NAMESPACES);
  const route = routeKey
    ? await getClientMessages(locale, ROUTE_CLIENT_NAMESPACES[routeKey])
    : {};
  return { chrome, route };
}

// ---------------------------------------------------------------------------
// 1 + 2. Catalog payload budget and namespace exactness
// ---------------------------------------------------------------------------

/**
 * Payload ceiling for /products, per locale, in BYTES.
 *
 * Pinned from the achieved post-split baseline (task 2.3), measured with
 * this exact harness on `feature/first-impression-pass` (2026-10-03):
 *
 *   fi: 15,244 B  (SSR HTML 7,211 + chrome bundle 4,021 + route bundle 4,012)
 *   en: 14,918 B  (SSR HTML 7,188 + chrome bundle 3,892 + route bundle 3,838)
 *
 * Ceiling = ceil(baseline × 1.25) — headroom for copy and fixture
 * growth, NOT a target to tune to. Reintroducing the full-catalog
 * provider adds ~100 KB per page and fails loudly below; a wholesale
 * catalog inline cannot return silently (web-application spec).
 */
const CATALOG_PAYLOAD_CEILING_BYTES: Record<'fi' | 'en', number> = {
  fi: Math.ceil(15244 * 1.25),
  en: Math.ceil(14918 * 1.25),
};

describe('catalog payload budget — /products, both locales (task 2.3, design D6)', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    mockServerFetches();
  });

  it.each(['fi', 'en'] as const)(
    'uncompressed payload stays under the pinned ceiling (%s)',
    async (locale) => {
      const html = await renderRouteWired(
        locale,
        () =>
          ProductsPage({
            params: Promise.resolve({ locale }),
            searchParams: Promise.resolve({ category: 'beer' }),
          }),
        ProductsRouteLayout,
      );

      const { chrome, route } = await pageMessagePayload(locale, '/products');
      const payloadBytes =
        Buffer.byteLength(html) +
        Buffer.byteLength(JSON.stringify(chrome)) +
        Buffer.byteLength(JSON.stringify(route));

      // The page rendered real copy, not a degenerate shell.
      expect(html).toContain('data-age-gate-overlay');
      expect(html).not.toContain('__MISSING_');

      expect(payloadBytes).toBeLessThan(CATALOG_PAYLOAD_CEILING_BYTES[locale]);
    },
  );
});

describe('catalog namespace exactness — spec scenario (task 2.3)', () => {
  it('the catalog page ships exactly chrome + its own namespaces', async () => {
    const { chrome, route } = await pageMessagePayload('fi', '/products');
    const bundleKeys = [...new Set([...Object.keys(chrome), ...Object.keys(route)])].sort();

    // Exactly the chrome subset plus the catalog route's own namespaces —
    // nothing else reaches the client payload.
    expect(bundleKeys).toEqual([
      'AccuracyStat',
      'AgeGate',
      'AuthNav',
      'Common',
      'Newsletter',
      'NotFound',
      'PriceAlerts',
      'SiteHeader',
    ]);

    // The spec's named strangers are absent from the client bundle.
    for (const stranger of ['Ranking', 'EventPage', 'WhatIfPage', 'TripPage', 'Compare', 'OperatorConsole', 'Home']) {
      expect(bundleKeys).not.toContain(stranger);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. No raw translation keys across the golden route set
// ---------------------------------------------------------------------------

/** Every string leaf of a catalog, as its dotted key path. */
function leafKeyPaths(
  node: unknown,
  prefix = '',
  out: string[] = [],
): string[] {
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const keyPath = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') {
        if (keyPath.includes('.')) out.push(keyPath);
      } else if (value && typeof value === 'object') {
        leafKeyPaths(value, keyPath, out);
      }
    }
  }
  return out;
}

const CATALOG_KEY_PATHS = [
  ...new Set([...leafKeyPaths(fiMessages), ...leafKeyPaths(enMessages)]),
];

/** Key-shaped tokens in rendered text, e.g. `products.foo.bar`. */
const KEY_SHAPED_TOKEN = /\b[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+){2,}\b/g;

const GOLDEN_ROUTES: readonly {
  route: string;
  page: () => Promise<React.ReactNode>;
  routeLayout?: RouteLayout;
}[] = [
  { route: '/', page: () => HomePage({ params: Promise.resolve({ locale: state.locale }) }) },
  {
    route: '/products',
    page: () =>
      ProductsPage({
        params: Promise.resolve({ locale: state.locale }),
        searchParams: Promise.resolve({ category: 'beer' }),
      }) as Promise<React.ReactNode>,
    routeLayout: ProductsRouteLayout as unknown as RouteLayout,
  },
  {
    route: '/products/42',
    page: () =>
      ProductPage({
        params: Promise.resolve({ locale: state.locale, id: '42' }),
      }),
    routeLayout: ProductDetailRouteLayout,
  },
  {
    route: '/ranking',
    page: () => RankingPage({ params: Promise.resolve({ locale: state.locale }) }),
    routeLayout: RankingRouteLayout,
  },
  {
    route: '/what-if',
    page: () => WhatIfPage({ params: Promise.resolve({ locale: state.locale }) }),
    routeLayout: WhatIfRouteLayout,
  },
  {
    route: '/calculator',
    page: () => CalculatorPage({ params: Promise.resolve({ locale: state.locale }) }),
    routeLayout: CalculatorRouteLayout,
  },
  {
    route: '/contact',
    page: () =>
      ContactPage({
        params: Promise.resolve({ locale: state.locale }),
        searchParams: Promise.resolve({}),
      }),
  },
];

describe('no raw translation keys render across the golden route set (task 2.3)', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    mockServerFetches();
  });

  for (const golden of GOLDEN_ROUTES) {
    it.each(['fi', 'en'] as const)(`%s renders only resolved copy on ${golden.route}`, async (locale) => {
      const html = await renderRouteWired(locale, golden.page, golden.routeLayout);

      expect(html).not.toContain('__MISSING_');

      // Scan rendered copy only: inline scripts (the age-gate pre-paint
      // reader, JSON-LD) carry JS and data, not translated copy — and
      // production flight data is not part of a renderToString payload.
      const rendered = html.replace(/<script\b[\s\S]*?<\/script>/g, '');

      // (a) No catalog key path appears as literal text — the exact
      // production symptom of a namespace-map omission.
      const renderedKeys = CATALOG_KEY_PATHS.filter((keyPath) => rendered.includes(keyPath));

      // (b) Belt and braces: no key-shaped token either (catches keys
      // missing from the catalog scan, e.g. a brand-new file).
      const shaped = [...rendered.matchAll(KEY_SHAPED_TOKEN)].map((m) => m[0]);

      expect(
        { route: golden.route, locale, renderedKeys, shaped },
        `raw translation keys rendered on ${golden.route} (${locale})`,
      ).toEqual({
        route: golden.route,
        locale,
        renderedKeys: [],
        shaped: [],
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Enumeration tripwire — the split table matches the source tree
// ---------------------------------------------------------------------------

/** Recursively collect *.tsx/*.ts source files (tests excluded). */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

/** True when the file's first statement is the 'use client' directive. */
function isClientFile(file: string): boolean {
  return /^\s*['"]use client['"];?\s*(\n|$)/.test(readSource(file));
}

/** The file's import specifiers (static + dynamic). */
function importSpecs(src: string): string[] {
  return [...src.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function readSource(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Strip comments so documented examples never count as code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Namespaces a client file's useTranslations calls resolve against. */
function namespacesOf(src: string): string[] {
  const code = stripComments(src);
  const found = [
    ...code.matchAll(/useTranslations\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g),
  ].map((m) => (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : 'Common'));
  return [...new Set(found)];
}

/**
 * Walk the import tree of an entry file, returning the client components
 * reachable through it and the namespaces they use.
 */
function enumerateClientTree(
  srcRoot: string,
  entry: string,
): { clientFiles: Set<string>; namespaces: Set<string> } {
  const fileSet = new Set(collectSourceFiles(srcRoot));
  const resolve = (from: string, spec: string): string | null => {
    let target: string | null = null;
    if (spec.startsWith('@/')) target = path.join(srcRoot, spec.slice(2));
    else if (spec.startsWith('.')) target = path.resolve(path.dirname(from), spec);
    else return null;
    for (const candidate of [
      target,
      `${target}.tsx`,
      `${target}.ts`,
      path.join(target, 'index.tsx'),
      path.join(target, 'index.ts'),
    ]) {
      if (fileSet.has(candidate)) return candidate;
    }
    return null;
  };

  const clientFiles = new Set<string>();
  const namespaces = new Set<string>();
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let src: string;
    try {
      src = readSource(file);
    } catch {
      continue;
    }
    if (isClientFile(file)) {
      clientFiles.add(file);
      for (const ns of namespacesOf(src)) namespaces.add(ns);
    }
    for (const spec of importSpecs(src)) {
      const dep = resolve(file, spec);
      if (dep !== null && !seen.has(dep)) stack.push(dep);
    }
  }
  return { clientFiles, namespaces };
}

/** [locale] segment-relative route keys of every page in the app. */
function pageRoutes(localeDir: string): string[] {
  const routes: string[] = [];
  for (const file of collectSourceFiles(localeDir)) {
    if (!file.endsWith(`${path.sep}page.tsx`)) continue;
    const rel = path.relative(localeDir, path.dirname(file));
    const route =
      rel === ''
        ? '/'
        : ('/' + rel.split(path.sep).join('/'))
            .replace('[...rest]', '*')
            .replace(/\[([a-zA-Z]+)\]/g, ':$1');
    routes.push(route);
  }
  return routes.sort();
}

describe('enumeration tripwire — split table matches the client source tree (design D6)', () => {
  const LOCALE_DIR = path.resolve(import.meta.dirname, '..');
  const SRC_ROOT = path.resolve(LOCALE_DIR, '../..');

  it('every map key is a real page route (typo guard)', () => {
    const routes = pageRoutes(LOCALE_DIR);
    for (const key of Object.keys(ROUTE_CLIENT_NAMESPACES)) {
      expect(routes, `map key "${key}" matches no page route`).toContain(key);
    }
  });

  it('every namespace in the table exists in BOTH catalogs', () => {
    const fi = fiMessages as unknown as Record<string, unknown>;
    const en = enMessages as unknown as Record<string, unknown>;
    const all: MessageNamespace[] = [
      ...SHARED_CHROME_NAMESPACES,
      ...(Object.values(ROUTE_CLIENT_NAMESPACES).flat() as MessageNamespace[]),
    ];
    for (const ns of all) {
      expect(fi, `${ns} missing from fi.json`).toHaveProperty(ns);
      expect(en, `${ns} missing from en.json`).toHaveProperty(ns);
    }
  });

  it('the chrome subset covers the layout tree, the 404 boundary, and the home island', () => {
    const chrome = enumerateClientTree(SRC_ROOT, path.join(LOCALE_DIR, 'layout.tsx'));
    const needs = new Set([...chrome.namespaces, 'NotFound']);
    // Home rides in chrome: its route has no segment layout (documented
    // deviation in route-namespaces.ts).
    const home = enumerateClientTree(SRC_ROOT, path.join(LOCALE_DIR, 'page.tsx'));
    for (const ns of home.namespaces) needs.add(ns);

    const missing = [...needs].filter(
      (ns) => !(SHARED_CHROME_NAMESPACES as readonly string[]).includes(ns),
    );
    expect(missing, 'namespaces the chrome provider must carry').toEqual([]);
  });

  it('every route without a table entry needs nothing beyond chrome — and vice versa', () => {
    const routes = pageRoutes(LOCALE_DIR);
    const chromeSet = new Set<string>(SHARED_CHROME_NAMESPACES);

    for (const route of routes) {
      // Map keys use site-path spellings; the FS uses segment brackets.
      const pagePath =
        route === '/'
          ? path.join(LOCALE_DIR, 'page.tsx')
          : path.join(
              LOCALE_DIR,
              `${route.replace('*', '[...rest]').replace(/:([a-zA-Z]+)/g, '[$1]')}/page.tsx`,
            );
      const tree = enumerateClientTree(SRC_ROOT, pagePath);
      const extra = [...tree.namespaces].filter((ns) => !chromeSet.has(ns));
      const entry = ROUTE_CLIENT_NAMESPACES[route as keyof typeof ROUTE_CLIENT_NAMESPACES];

      if (entry === undefined) {
        expect(
          { route, extra },
          `route ${route} uses namespaces beyond chrome without a split-table entry`,
        ).toEqual({ route, extra: [] });
        continue;
      }

      // The entry covers exactly what the tree needs beyond chrome:
      // nothing missing…
      const missing = extra.filter((ns) => !(entry as readonly string[]).includes(ns));
      expect(missing, `route ${route} is missing namespaces in its table entry`).toEqual([]);
      // …and nothing stale (a namespace no client component uses would
      // ship dead weight on every request).
      const used = new Set(tree.namespaces);
      const stale = (entry as readonly string[]).filter((ns) => !used.has(ns));
      expect(stale, `route ${route}'s table entry carries unused namespaces`).toEqual([]);
    }
  });
});
