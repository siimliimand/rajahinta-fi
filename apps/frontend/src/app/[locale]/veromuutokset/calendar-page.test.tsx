/**
 * @vitest-environment jsdom
 */
/**
 * Tax-change calendar page tests (task 4.1, change tax-change-calendar).
 *
 * Two route folders share one body module (`calendar-page.tsx`):
 *
 *   Server shells (renderToString, Next server plumbing mocked):
 *   1. The fi route `/veromuutokset` renders the editorial rhythm copy,
 *      the year navigation as URL-state anchors around the resolved
 *      year (default: the server's current year, junk falls back), the
 *      client island's loading state, and the cross-links to the
 *      what-if simulator and the rate-change blog (localized hrefs).
 *   2. The en route `/tax-changes` renders the English variant with its
 *      own base path in the year links.
 *   3. Cross-folder locale mismatches redirect to the locale's
 *      canonical URL (one URL per locale — no duplicate content).
 *
 *   Metadata:
 *   4. The localized canonical + hreflang pair (design D6) for both
 *      routes.
 *
 * Message catalogs (task 4.3 owns the real entries): the mocked
 * next-intl/server resolves against a TEST-LOCAL two-locale stub, the
 * same dot-path walker the savings/blog page tests use.
 */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import VeroMuutoksetPage, {
  generateMetadata as veroMetadata,
} from './page';
import TaxChangesPage, {
  generateMetadata as taxChangesMetadata,
} from '../tax-changes/page';
import {
  FI_CATALOG_STUB,
  EN_CATALOG_STUB,
  type CalendarCatalogStub,
} from './test-catalog';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — next-intl/server resolved from the
// test-local two-locale stub, with {param} interpolation (the
// savings/blog test precedent; the real catalog entries are task 4.3's).
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const locale = typeof opts === 'string' ? 'fi' : (opts?.locale ?? 'fi');
    const table =
      locale === 'en'
        ? await import('./test-catalog').then((m) => m.EN_CATALOG_STUB)
        : await import('./test-catalog').then((m) => m.FI_CATALOG_STUB);
    return (key: string, values?: Record<string, unknown>) => {
      // Walk dot-paths so nested keys resolve like the real lookup.
      let value: unknown = table[ns];
      for (const part of key.split('.')) {
        if (typeof value !== 'object' || value === null) {
          value = undefined;
          break;
        }
        value = (value as Record<string, unknown>)[part];
      }
      if (typeof value !== 'string') return `__MISSING_${locale}.${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
}));

// The i18n Link double serializes typed href objects through the real
// routing vocabulary; the locale getter steers the /en prefix per suite.
const linkLocale = vi.hoisted(() => ({ value: 'fi' as 'fi' | 'en' }));
vi.mock('@/i18n/navigation', async () => {
  const { createTestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: createTestI18nLink(() => linkLocale.value) };
});

// redirect() in a real render aborts with Next's redirect response — a
// throw carrying the target URL is the observable equivalent here.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

function catalog(locale: 'fi' | 'en'): CalendarCatalogStub {
  return locale === 'fi' ? FI_CATALOG_STUB : EN_CATALOG_STUB;
}

/** Render one page element through the provider with its stub catalog. */
async function renderPage(
  element: Promise<React.ReactElement>,
  locale: 'fi' | 'en',
): Promise<string> {
  const messages = catalog(locale);
  return renderToString(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {await element}
    </NextIntlClientProvider>,
  );
}

function pageProps(
  locale: string,
  query: Record<string, string | string[] | undefined> = {},
) {
  return {
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(query),
  };
}

beforeEach(() => {
  linkLocale.value = 'fi';
});

// ---------------------------------------------------------------------------
// Fi shell — /veromuutokset
// ---------------------------------------------------------------------------

describe('VeroMuutoksetPage shell (fi)', () => {
  it('renders the rhythm copy, resolved year, URL-state year links, and the loading island', async () => {
    const html = await renderPage(
      VeroMuutoksetPage(pageProps('fi', { year: '2026' })),
      'fi',
    );

    // Editorial rhythm framing (the catalog stub's grounded copy).
    expect(html).toContain('saman rytmin');
    expect(html).toContain('maalis- ja syyskuun lopussa');
    // Timeline heading and year navigation — URL-state anchors.
    expect(html).toContain('Vuosi 2026');
    expect(html).toContain('href="/veromuutokset?year=2025"');
    expect(html).toContain('href="/veromuutokset?year=2027"');
    // The age-gated listing stays a client island: the server HTML
    // ships its loading state (no fabricated events server-side).
    expect(html).toContain('Ladataan veromuutoksia…');
  });

  it('defaults to the current year and falls back on junk years', async () => {
    const currentYear = new Date().getFullYear();

    const defaulted = await renderPage(
      VeroMuutoksetPage(pageProps('fi')),
      'fi',
    );
    expect(defaulted).toContain(`Vuosi ${currentYear}`);
    expect(defaulted).toContain(`href="/veromuutokset?year=${currentYear - 1}"`);
    expect(defaulted).toContain(`href="/veromuutokset?year=${currentYear + 1}"`);

    const junk = await renderPage(
      VeroMuutoksetPage(pageProps('fi', { year: 'abcd' })),
      'fi',
    );
    expect(junk).toContain(`Vuosi ${currentYear}`);

    const outOfBounds = await renderPage(
      VeroMuutoksetPage(pageProps('fi', { year: '1999' })),
      'fi',
    );
    expect(outOfBounds).toContain(`Vuosi ${currentYear}`);
  });

  it('cross-links the what-if simulator and the rate-change blog (localized hrefs)', async () => {
    const html = await renderPage(
      VeroMuutoksetPage(pageProps('fi', { year: '2026' })),
      'fi',
    );

    // The typed Link double resolves through the routing vocabulary:
    // fi serves /skenaario and /blogi bare.
    expect(html).toContain('href="/skenaario"');
    expect(html).toContain('href="/blogi"');
    expect(html).toContain('Avaa skenaariolaskuri');
    expect(html).toContain('Lue veromuutosblogia');
  });

  it('redirects the English negotiation to the en canonical', async () => {
    await expect(
      VeroMuutoksetPage(pageProps('en', { year: '2026' })),
    ).rejects.toThrow('NEXT_REDIRECT /en/tax-changes?year=2026');
  });
});

// ---------------------------------------------------------------------------
// En shell — /tax-changes
// ---------------------------------------------------------------------------

describe('TaxChangesPage shell (en)', () => {
  it('renders the English variant with its own base path in the year links', async () => {
    linkLocale.value = 'en';
    const html = await renderPage(
      TaxChangesPage(pageProps('en', { year: '2026' })),
      'en',
    );

    expect(html).toContain('Tax changes');
    expect(html).toContain('Year 2026');
    expect(html).toContain('href="/en/tax-changes?year=2025"');
    expect(html).toContain('href="/en/tax-changes?year=2027"');
    // English island loading copy from the en stub.
    expect(html).toContain('Loading tax changes…');
    // The en Link double localizes the typed cross-link hrefs exactly
    // as the real next-intl Link would: localized segments under /en.
    expect(html).toContain('href="/en/skenaario"');
    expect(html).toContain('href="/en/blogi"');
  });

  it('redirects the default-locale path to the Finnish canonical', async () => {
    // The bare /tax-changes negotiates to fi — one URL per locale.
    await expect(
      TaxChangesPage(pageProps('fi', { year: '2026' })),
    ).rejects.toThrow('NEXT_REDIRECT /veromuutokset?year=2026');
  });
});

// ---------------------------------------------------------------------------
// Localized metadata (design D6)
// ---------------------------------------------------------------------------

describe('Tax-change calendar metadata', () => {
  it('emits the localized canonical and hreflang pair for both routes', async () => {
    const fi = await veroMetadata();
    expect(fi.alternates?.canonical).toBe('/veromuutokset');
    expect(fi.alternates?.languages).toEqual({
      fi: '/veromuutokset',
      en: '/en/tax-changes',
      'x-default': '/veromuutokset',
    });

    const en = await taxChangesMetadata();
    expect(en.alternates?.canonical).toBe('/en/tax-changes');
    expect(en.alternates?.languages).toEqual({
      fi: '/veromuutokset',
      en: '/en/tax-changes',
      'x-default': '/veromuutokset',
    });
    expect(en.title).toBe('Tax changes and the annual price-change rhythm');
  });
});
