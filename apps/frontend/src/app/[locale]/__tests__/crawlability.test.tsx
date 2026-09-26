/**
 * Crawlability regression test (price-intelligence-roadmap task 1.3).
 *
 * Serves the public routes the way a cookie-less crawler's request
 * reaches them: the REAL [locale] layout (server-side age-gate decision
 * from the mocked cookies()) with each route's REAL page component as
 * its children, rendered to an HTML string — only Next server plumbing
 * is mocked (layout.ssr.test.tsx harness). Pins the crawlability
 * contract end to end: the first HTML carries each page's stable
 * catalog copy AND the age-gate dialog as a fixed overlay, so the gate
 * never cloaks content (enforcement stays in the gated APIs' 403s).
 * The server fetches the pages make are routed through a mocked
 * `request`, keeping the render deterministic and offline.
 *
 * @module CrawlabilityTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RootLayout from '../layout';
import HomePage from '../page';
import BlogIndexPage from '../blog/page';
import ProductsPage from '../products/page';
import CalculatorPage from '../calculator/page';
import { request } from '@/lib/api';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — locale steerable through this hoisted object.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  locale: 'fi' as string,
  // Steers the mocked usePathname (AgeGate marks the declined route
  // from it); the crawler lands on the bare locale root.
  pathname: '/' as string,
  // Cookie-less: what a first-time crawler's request carries.
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

// Locale-steerable catalog resolution: namespace lookups, root-scoped
// dotted keys (homepage trust row), and {param} interpolation (blog and
// catalog labels) — the union of what the layout and these pages call.
vi.mock('next-intl/server', () => ({
  getMessages: async () => (await import(`@/messages/${state.locale}.json`)).default,
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
      const value = ns
        ? (table[ns] as Record<string, unknown> | undefined)?.[key]
        : key.split('.').reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            table,
          );
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
  setRequestLocale: () => undefined,
}));

// next/font/google is a Next build-time transform with no runtime under
// vitest — same stub shape as layout.ssr.test.tsx.
vi.mock('next/font/google', () => ({
  Inter: () => Object.assign(() => null, { variable: '__variable_mock_inter' }),
}));

// The ui primitives (Button, Card) ship Next-automatic JSX — no `import
// React` — while vitest's esbuild transform emits classic
// `React.createElement` for them (tsconfig jsx: preserve). Same global
// exposure as layout.ssr.test.tsx so the real components render.
(globalThis as { React?: typeof React }).React = React;

// Real module, only `request` mocked: the pages' server fetches must
// stay offline while the rest of the export surface (the age
// confirmation token, ApiFetchError, the client islands' helpers) keeps
// its real shape — the blog page test precedent.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

// Chrome is covered by layout.ssr.test.tsx, and SiteFooter is an async
// server component that cannot pass through renderToString — markers,
// exactly as there.
vi.mock('../components/SiteHeader', () => ({
  default: () => React.createElement('header', { 'data-testid': 'site-header' }, 'CHROME-HEADER'),
}));
vi.mock('../components/SiteFooter', () => ({
  default: () => React.createElement('footer', { 'data-testid': 'site-footer' }, 'CHROME-FOOTER'),
}));

// Link applies localePrefix 'as-needed' (English gets /en);
// usePathname/useRouter stubs serve the AgeGate and the client islands.
vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<string, unknown>,
  ) => {
    const { href, children, ...rest } = props;
    const target = String(href ?? '');
    const prefixed =
      state.locale === 'en' && target.startsWith('/') ? `/en${target}` : target;
    return React.createElement('a', { ...rest, href: prefixed }, children);
  },
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: () => undefined }),
}));

// ---------------------------------------------------------------------------
// Fixtures — shapes mirror the API contracts (blog-pages / products page
// tests). Only the stable catalog copy is asserted, never these values.
// ---------------------------------------------------------------------------

const BLOG_POST = {
  slug: 'veromuutos-2026-2',
  locale: 'en',
  title: 'Rate dataset update 2026-2',
  rateDatasetVersion: '2026-2',
  publishedAt: '2026-09-01T09:00:00.000Z',
};

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

// ---------------------------------------------------------------------------
// Route table — the routes a crawler hits: the unprefixed Finnish root,
// the EnglishPrefixed public pages, and the calculator.
// ---------------------------------------------------------------------------

interface CrawlRoute {
  /** The route as the crawler requests it (documentation only). */
  route: string;
  locale: 'fi' | 'en';
  /** Stable catalog copy that must be in the cookie-less HTML. */
  markers: string[];
  /** Localized gate dialog title proving the overlay ships. */
  dialogTitle: string;
  /** API path prefixes the route's server fetch must have hit. */
  fetched: string[];
  /** Every route here is an async server component, awaited the way
      Next's RSC runtime would before stringification. */
  page: () => Promise<React.ReactElement>;
}

const ROUTES: readonly CrawlRoute[] = [
  {
    route: '/',
    locale: 'fi',
    markers: ['Laske alkoholin todellinen kokonaishinta Suomeen'],
    dialogTitle: 'Ikätarkistus',
    fetched: ['/api/v1/guides'],
    page: async () =>
      HomePage({ params: Promise.resolve({ locale: 'fi' }) }),
  },
  {
    route: '/en/blog',
    locale: 'en',
    markers: [
      'Blog',
      'Announcements about official rate dataset versions and information on the calculation method.',
      'Rate dataset update 2026-2',
      'Read the post',
    ],
    dialogTitle: 'Age verification',
    fetched: ['/api/v1/blog/posts'],
    page: async () =>
      BlogIndexPage({ params: Promise.resolve({ locale: 'en' }) }),
  },
  {
    route: '/en/products',
    locale: 'en',
    markers: [
      'Products',
      'The product catalog behind the landed-cost calculator, with observed prices.',
      'All products',
    ],
    dialogTitle: 'Age verification',
    fetched: ['/api/v1/products'],
    page: async () =>
      ProductsPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
  },
  {
    route: '/calculator',
    locale: 'fi',
    markers: [
      'Kokonaiskustannuslaskuri',
      'Hae tuote, valitse määrä ja saat eritellyn kokonaiskustannusarvion Suomeen.',
      'Miten laskenta toimii',
    ],
    dialogTitle: 'Ikätarkistus',
    fetched: [],
    page: async () =>
      CalculatorPage({ params: Promise.resolve({ locale: 'fi' }) }),
  },
];

/**
 * Render one route's full server HTML the way the server would: the
 * real layout around the real page, with the mocked cookies() carrying
 * no age confirmation — the crawler's request.
 */
async function renderRouteHtml(route: CrawlRoute): Promise<string> {
  state.locale = route.locale;
  state.pathname = '/';
  state.ageCookie = null;
  const element = await route.page();
  return renderToString(
    await RootLayout({
      children: element,
      params: Promise.resolve({ locale: route.locale }),
    }),
  );
}

// ---------------------------------------------------------------------------
// The regression: content and overlay, both in the cookie-less HTML
// ---------------------------------------------------------------------------

describe('crawlability — cookie-less server HTML of the public routes (task 1.3)', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    mockedRequest.mockImplementation(async (path: string): Promise<unknown> => {
      if (path.startsWith('/api/v1/blog/posts')) {
        return { items: [BLOG_POST], total: 1 };
      }
      if (path.startsWith('/api/v1/products')) {
        return {
          items: [CATALOG_ITEM],
          total: 1,
          page: 1,
          limit: 24,
          totalPages: 1,
        };
      }
      if (path.startsWith('/api/v1/guides')) {
        return { items: [], total: 0 };
      }
      // Any unplanned fetch fails loudly instead of reaching a backend.
      throw new Error(`unexpected server fetch in crawlability test: ${path}`);
    });
  });

  it.each(ROUTES)(
    '$route ships its content AND the age-gate overlay without cookies',
    async (route) => {
      const html = await renderRouteHtml(route);

      // (a) The real page copy is in the first HTML — the gate is a
      // fixed overlay on top, never a placeholder replacement.
      for (const marker of route.markers) {
        expect(html).toContain(marker);
      }
      // Every catalog key resolved (a dropped key would break silently).
      expect(html).not.toContain('__MISSING_');

      // The server fetch happened for the data-backed routes, and only
      // the expected endpoints — an unplanned fetch throws in the mock.
      expect(mockedRequest).toHaveBeenCalledTimes(route.fetched.length);
      for (const prefix of route.fetched) {
        expect(
          mockedRequest.mock.calls.some(([p]) => String(p).startsWith(prefix)),
        ).toBe(true);
      }

      // (b) The age-gate dialog ships as an overlay in the same HTML,
      // with its localized copy.
      expect(html).toContain('data-age-gate-overlay');
      expect(html).toContain('role="dialog"');
      expect(html).toContain(route.dialogTitle);
    },
  );
});
