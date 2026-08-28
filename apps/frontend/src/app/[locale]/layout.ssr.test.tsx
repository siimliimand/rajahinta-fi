/**
 * Layout SSR tests (task 9.6, change technical-assessment-remediation;
 * web-application spec).
 *
 * Two layers, both rendering real components to HTML strings the way the
 * server would (only Next server plumbing is mocked):
 *
 *   1. Chrome components — the REAL SiteHeader and SiteFooter render the
 *      five destinations, the disclaimer, and the methodology link from
 *      each locale's catalog. SiteFooter is an async server component,
 *      awaited before stringification (exactly what Next's RSC runtime
 *      does); SiteHeader is a client component and renders inside the
 *      real NextIntlClientProvider with the locale's catalog — the same
 *      context the [locale] layout provides in the app.
 *   2. Layout composition — the REAL [locale] layout renders with the
 *      chrome replaced by markers (async components cannot pass through
 *      renderToString), pinning that every route's initial HTML carries
 *      the chrome slots, the correct `lang` attribute, the age-gate
 *      placeholder instead of page content, and server-resolved
 *      (inlined) feature-flag states with no client fetch.
 *
 * @module LayoutSsrTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import RootLayout from './layout';
import { FeatureFlagsProvider, useFeatureFlags } from '@/lib/feature-flags';
import type { FeatureFlagsResponse } from '@/lib/types';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — locale and flag state are steerable per
// test through this hoisted object.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  locale: 'fi' as string,
  // Steers the mocked usePathname — SiteHeader marks the active
  // destination from it.
  pathname: '/' as string,
  flags: {
    flags: {
      HISTORICAL_PRICE_INTELLIGENCE: true,
      BASKET_OPTIMIZATION: true,
      ADVANCED_FEATURES: true,
    },
  } as { flags: Record<string, boolean> },
  flagsCalls: 0,
}));

vi.mock('next-intl/server', () => ({
  getMessages: async () => (await import(`@/messages/${state.locale}.json`)).default,
  getTranslations: async (opts: string | { locale?: string; namespace?: string }) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const locale = (typeof opts === 'object' && opts.locale) || state.locale;
    const table = ((await import(`@/messages/${locale}.json`)).default as Record<
      string,
      Record<string, string>
    >)[ns];
    return (key: string) =>
      typeof table?.[key] === 'string' ? table[key] : `__MISSING_${ns}.${key}__`;
  },
  setRequestLocale: () => undefined,
}));

// next/font/google is a Next build-time transform with no runtime under
// vitest — stub the loader with the shape layout.tsx consumes: calling
// Inter() returns the font object whose `.variable` is a class string.
vi.mock('next/font/google', () => ({
  Inter: () => Object.assign(() => null, { variable: '__variable_mock_inter' }),
}));

// The ui primitives (Button, Card) ship Next-automatic JSX — no `import
// React` — while vitest's esbuild transform still emits classic
// `React.createElement` calls for them (tsconfig jsx: preserve). Classic
// JSX resolves React from the global scope at render time, so exposing
// it here lets the REAL chrome components render instead of mocks.
(globalThis as { React?: typeof React }).React = React;

vi.mock('@/lib/api', () => ({
  SITE_URL: 'https://rajahinta.test',
  getServerFeatureFlags: async () => {
    state.flagsCalls += 1;
    return state.flags;
  },
}));

// Link applies the routing config's localePrefix: 'as-needed' — Finnish
// serves bare paths, English gets the /en prefix. usePathname follows
// state.pathname (locale-stripped, like the real next-intl hook).
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

// Async server components cannot pass through renderToString inside the
// layout tree; the composition tests replace them with markers while the
// real components are tested directly below (via importActual).
vi.mock('./components/SiteHeader', () => ({
  default: () => React.createElement('header', { 'data-testid': 'site-header' }, 'CHROME-HEADER'),
}));
vi.mock('./components/SiteFooter', () => ({
  default: () => React.createElement('footer', { 'data-testid': 'site-footer' }, 'CHROME-FOOTER'),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The five primary destinations (web-application spec: shared navigation). */
const DESTINATIONS = [
  { href: '/calculator', fi: 'Laskuri', en: 'Calculator' },
  { href: '/compare', fi: 'Vertailu', en: 'Compare' },
  { href: '/basket', fi: 'Ostoskori', en: 'Basket' },
  { href: '/account', fi: 'Oma tili', en: 'My account' },
  { href: '/ranking', fi: 'Miten järjestäminen toimii', en: 'How ranking works' },
] as const;

const FLAGS_ON: FeatureFlagsResponse = {
  flags: {
    HISTORICAL_PRICE_INTELLIGENCE: true,
    BASKET_OPTIMIZATION: true,
    ADVANCED_FEATURES: true,
  },
};

const FLAGS_OFF: FeatureFlagsResponse = {
  flags: {
    HISTORICAL_PRICE_INTELLIGENCE: false,
    BASKET_OPTIMIZATION: false,
    ADVANCED_FEATURES: false,
  },
};

/** Render the real layout for a locale, the way the server would. */
async function renderLayout(
  locale: 'fi' | 'en',
  children: React.ReactNode = <div data-testid="page-body">PAGE-BODY-MARKER</div>,
): Promise<string> {
  state.locale = locale;
  state.pathname = '/';
  return renderToString(
    await RootLayout({ children, params: Promise.resolve({ locale }) }),
  );
}

/** A flag-gated consumer — visibility must follow the inlined flag state. */
function FlagGatedProbe() {
  const { flags } = useFeatureFlags();
  return (
    <div>{flags.ADVANCED_FEATURES ? <p>GATED-UI-VISIBLE</p> : null}</div>
  );
}

// ---------------------------------------------------------------------------
// 1. Real chrome components — both locales
// ---------------------------------------------------------------------------

describe('SiteHeader SSR — five destinations, both locales', () => {
  /** Render the real header the way the layout does: inside the
      client-intl context for the steered locale and pathname. */
  async function renderHeaderHtml(locale: 'fi' | 'en'): Promise<string> {
    state.locale = locale;
    const { default: SiteHeader } = await vi.importActual<
      typeof import('./components/SiteHeader')
    >('./components/SiteHeader');
    const messages = (await import(`@/messages/${locale}.json`)).default;
    return renderToString(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <SiteHeader />
      </NextIntlClientProvider>,
    );
  }

  it.each(['fi', 'en'] as const)('renders the five localized destinations (%s)', async (locale) => {
    state.pathname = '/';
    const html = await renderHeaderHtml(locale);

    expect(html).toContain('<header');
    expect(html).not.toContain('__MISSING_');
    for (const dest of DESTINATIONS) {
      const href = locale === 'en' ? `/en${dest.href}` : dest.href;
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(dest[locale]);
    }
  });

  it('the nav landmarks are labelled from the catalog', async () => {
    state.pathname = '/';
    const html = await renderHeaderHtml('fi');
    expect(html).toContain('Päävalikko');
  });

  it('the mobile menu toggle is wired to a panel that is closed by default', async () => {
    state.pathname = '/';
    const html = await renderHeaderHtml('fi');

    // Disclosure wiring: the toggle names the panel it controls and
    // reports its closed state. The closed panel is display:none in the
    // server payload, so its links cannot take focus (no focus trap).
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="site-header-mobile-nav"');
    expect(html).toContain('id="site-header-mobile-nav"');
  });

  it('exactly the active destination carries aria-current, in both navs', async () => {
    // Desktop row and mobile panel both mark the current page: one
    // destination, marked twice.
    state.pathname = '/calculator';
    const html = await renderHeaderHtml('fi');
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(2);

    // A deeper segment marks its root destination and nothing else.
    state.pathname = '/account/saved-baskets';
    const segmentHtml = await renderHeaderHtml('fi');
    expect((segmentHtml.match(/aria-current="page"/g) ?? []).length).toBe(2);

    // The home route is not one of the five destinations: no indicator.
    state.pathname = '/';
    const homeHtml = await renderHeaderHtml('fi');
    expect(homeHtml).not.toContain('aria-current="page"');
  });
});

describe('SiteFooter SSR — disclaimer and methodology, both locales', () => {
  it.each(['fi', 'en'] as const)('carries the localized disclaimer and methodology link (%s)', async (locale) => {
    state.locale = locale;
    const { default: SiteFooter } = await vi.importActual<
      typeof import('./components/SiteFooter')
    >('./components/SiteFooter');
    const html = renderToString(await SiteFooter());

    expect(html).toContain('<footer');
    expect(html).not.toContain('__MISSING_');
    const methodologyHref = locale === 'en' ? 'href="/en/ranking"' : 'href="/ranking"';
    expect(html).toContain(methodologyHref);
    if (locale === 'fi') {
      expect(html).toContain('Rajahinta.fi on riippumaton hintavertailu-');
      expect(html).toContain('Tarkista ajantasaiset tiedot aina viranomaislähteistä');
    } else {
      expect(html).toContain('independent price comparison and landed-cost calculator');
      expect(html).toContain('Always verify current details with official sources');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Real layout composition — chrome slots, lang, age gate, flags
// ---------------------------------------------------------------------------

describe('[locale] layout SSR — composition', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state.flagsCalls = 0;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  it.each(['fi', 'en'] as const)('renders the chrome slots and the locale lang attribute (%s)', async (locale) => {
    const html = await renderLayout(locale);

    expect(html).toContain('<header');
    expect(html).toContain('CHROME-HEADER');
    expect(html).toContain('<footer');
    expect(html).toContain('CHROME-FOOTER');
    expect(html).toContain(`lang="${locale}"`);
    // Chrome needs no client-side data fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the [locale] layout is the chrome for every page route in the app', () => {
    // Next applies the [locale] layout to every route below it; the
    // assertions above prove the layout renders the chrome slots. Pin the
    // page inventory so the five destinations (and the rest) stay inside
    // the layout's reach.
    const localeDir = import.meta.dirname;
    const pages = collectPageRoutes(localeDir, localeDir).sort();

    expect(pages).toEqual(
      expect.arrayContaining([
        '/',
        '/account',
        '/basket',
        '/calculator',
        '/compare',
        '/ranking',
        '/products/[id]',
        '/age-gate/declined',
      ]),
    );
  });
});

describe('[locale] layout SSR — age gate leaks nothing', () => {
  it.each(['fi', 'en'] as const)('page content is absent and the placeholder is present (%s)', async (locale) => {
    const html = await renderLayout(locale);

    expect(html).toContain('data-age-gate-placeholder');
    expect(html).not.toContain('PAGE-BODY-MARKER');
  });

  it('the age-gate dialog copy itself is absent from the SSR output', async () => {
    // Not even the gate question ships in the server payload — only the
    // inert placeholder does. The gate renders after mount, client-side.
    const html = await renderLayout('fi');

    expect(html).not.toContain('Ikätarkistus');
    expect(html).not.toContain('Olen 18 vuotta täyttänyt');
  });
});

describe('[locale] layout SSR — feature flags inline (no flash)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state.flagsCalls = 0;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  it('the layout resolves flag states server-side exactly once per render', async () => {
    expect(state.flagsCalls).toBe(0);
    await renderLayout('fi');
    expect(state.flagsCalls).toBe(1);
    // Inline bootstrap — no client fetch for flags anywhere in the paint.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a flag-gated consumer renders at its final visibility in the first paint', () => {
    const onHtml = renderToString(
      <FeatureFlagsProvider flags={FLAGS_ON}>
        <FlagGatedProbe />
      </FeatureFlagsProvider>,
    );
    const offHtml = renderToString(
      <FeatureFlagsProvider flags={FLAGS_OFF}>
        <FlagGatedProbe />
      </FeatureFlagsProvider>,
    );

    // First-render visibility equals the inlined flag state: visible from
    // the first paint, never appearing late, never flashing away.
    expect(onHtml).toContain('GATED-UI-VISIBLE');
    expect(offHtml).not.toContain('GATED-UI-VISIBLE');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('flag-off is the degrade path — gated UI stays hidden, never shows-then-hides', () => {
    // The layout's server-side failure fallback inlines the all-off
    // default; the first client render then matches the served HTML
    // instead of showing gated UI and hiding it after a fetch resolves.
    const html = renderToString(
      <FeatureFlagsProvider flags={FLAGS_OFF}>
        <FlagGatedProbe />
      </FeatureFlagsProvider>,
    );
    expect(html).not.toContain('GATED-UI-VISIBLE');
  });
});

/** Recursively collect [locale]-relative routes from page.tsx files. */
function collectPageRoutes(dir: string, root: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...collectPageRoutes(full, root));
    } else if (entry.name === 'page.tsx') {
      const rel = path.relative(root, dir);
      const route = rel === '' ? '/' : `/${rel.split(path.sep).join('/')}`;
      routes.push(route);
    }
  }
  return routes;
}
