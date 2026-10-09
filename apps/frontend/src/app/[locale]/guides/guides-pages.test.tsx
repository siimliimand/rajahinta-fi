/**
 * Guides page tests (honest-trust-surfaces task 4.1, spec guides-hub —
 * zero-publication visibility gating).
 *
 * Renders the REAL async server component the way Next's RSC runtime
 * would (only Next server plumbing is mocked — the blog-pages test
 * precedent), pinning:
 *
 *   1. Published guides render title and a per-guide link to
 *      /guides/:slug.
 *   2. Zero published guides → notFound() — a crawler-honest 404, no
 *      empty shell.
 *   3. Fetch failure → the unavailable state, no crash (a fetch failure
 *      is not evidence of zero guides).
 *
 * @module GuidesPagesTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GuidesIndexPage, {
  generateMetadata as guidesIndexMetadata,
} from './page';
import { request } from '@/lib/api';

async function renderPageHtml(element: React.ReactElement): Promise<string> {
  const messages = (await import('@/messages/fi.json')).default;
  return renderToString(
    <NextIntlClientProvider locale="fi" messages={messages}>
      {element}
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — next-intl/server resolved straight from the
// Finnish catalog, with {param} interpolation (blog-pages harness).
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (await import('@/messages/fi.json')).default as Record<
      string,
      unknown
    >;
    return (key: string, values?: Record<string, unknown>) => {
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
}));

// The i18n Link double serializes typed href objects through the real
// routing vocabulary (the shared testing double).
vi.mock('@/i18n/navigation', async () => {
  const { TestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: TestI18nLink };
});

// notFound() in a real render aborts with Next's 404 fallback — a throw is
// the observable equivalent under renderToString.
const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// Fixtures — the index-item shape the guides.server structural guard
// accepts; guides carry no rate-version provenance (always null).
// ---------------------------------------------------------------------------

const GUIDE_OK = {
  slug: 'tullivapaat-maarat',
  locale: 'fi',
  title: 'Tullivapaat määrät',
  rateDatasetVersion: null,
  publishedAt: '2026-09-01T09:00:00.000Z',
};

describe('GuidesIndexPage', () => {
  it('renders published guides with per-guide links', async () => {
    mockedRequest.mockResolvedValue({
      items: [GUIDE_OK],
      total: 1,
    });

    const element = await GuidesIndexPage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    const html = await renderPageHtml(element);

    expect(html).toContain('Tullivapaat määrät');
    // The typed href renders the localized segment (/oppaat, design D1).
    expect(html).toContain('href="/oppaat/tullivapaat-maarat"');
  });

  it('emits the localized canonical and hreflang pair for the index (design D6)', async () => {
    const fi = await guidesIndexMetadata({
      params: Promise.resolve({ locale: 'fi' }),
    });
    expect(fi.alternates?.canonical).toBe('/oppaat');
    expect(fi.alternates?.languages).toEqual({
      fi: '/oppaat',
      en: '/en/guides',
      'x-default': '/oppaat',
    });
  });

  it('answers a crawler-honest 404 when nothing is published (task 4.1)', async () => {
    const { notFound } = await import('next/navigation');
    mockedRequest.mockResolvedValue({ items: [], total: 0 });

    await expect(
      GuidesIndexPage({
        params: Promise.resolve({ locale: 'fi' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(vi.mocked(notFound)).toHaveBeenCalledTimes(1);
  });

  it('renders the unavailable state on fetch failure', async () => {
    mockedRequest.mockRejectedValue(new Error('backend down'));

    const element = await GuidesIndexPage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    const html = await renderPageHtml(element);

    expect(html).toContain('Oppaita ei ole juuri nyt saatavilla');
  });
});
