/**
 * SiteFooter blog/guides link visibility tests (honest-trust-surfaces
 * task 4.1, design D5; specs content-publication + guides-hub).
 *
 * Renders the REAL async footer component the way the [locale] layout
 * does (only Next server plumbing is mocked — the layout.ssr.test
 * harness precedent), pinning the request-time visibility contract:
 *
 *   1. Published items in both indexes → both links render.
 *   2. Zero published posts → the blog link is omitted; the guides link
 *      follows its own count independently.
 *   3. A count resolution failure hides both links (the honest default)
 *      while the rest of the footer renders untouched.
 *   4. The counts are fetched for the CURRENT locale — fi and en are
 *      independent.
 *
 * @module SiteFooterTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SiteFooter from './SiteFooter';
import { request } from '@/lib/api';

// Classic-JSX vitest runtime: the newsletter client island renders
// through the global React binding (layout.ssr.test precedent).
(globalThis as { React?: typeof React }).React = React;

const state = vi.hoisted(() => ({ locale: 'fi' as string }));

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => {
    const table = (await import(`@/messages/${state.locale}.json`)).default as Record<
      string,
      Record<string, string>
    >;
    const ns = table[namespace] ?? {};
    return (key: string) => ns[key] ?? `__MISSING_${namespace}.${key}__`;
  },
  getMessages: async () =>
    (await import(`@/messages/${state.locale}.json`)).default,
  getLocale: async () => state.locale,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<
      string,
      unknown
    >,
  ) => {
    const { href, children, ...rest } = props;
    // localePrefix 'as-needed': Finnish serves bare paths, English gets
    // the /en prefix (crawlability harness precedent).
    const target = String(href ?? '');
    const prefixed =
      state.locale === 'en' && target.startsWith('/') ? `/en${target}` : target;
    return React.createElement('a', { ...rest, href: prefixed }, children);
  },
}));

const mockedRequest = vi.mocked(request);

const POST_OK = {
  slug: 'veromuutos-2026-2',
  locale: 'fi',
  title: 'Veromuutus 2026-2',
  rateDatasetVersion: '2026-2',
  publishedAt: '2026-09-01T09:00:00.000Z',
};

const GUIDE_OK = {
  slug: 'tullivapaat-maarat',
  locale: 'fi',
  title: 'Tullivapaat määrät',
  rateDatasetVersion: null,
  publishedAt: '2026-09-01T09:00:00.000Z',
};

/** Route the two count endpoints; anything else fails loudly. */
function mockCounts(blog: number, guides: number, locale = 'fi'): void {
  mockedRequest.mockImplementation(async (path: string) => {
    if (path === `/api/v1/blog/posts?locale=${locale}`) {
      return { items: Array.from({ length: blog }, () => POST_OK), total: blog };
    }
    if (path === `/api/v1/guides?locale=${locale}`) {
      return {
        items: Array.from({ length: guides }, () => GUIDE_OK),
        total: guides,
      };
    }
    throw new Error(`unexpected server fetch: ${path}`);
  });
}

beforeEach(() => {
  state.locale = 'fi';
  mockedRequest.mockReset();
});

async function renderFooterHtml(): Promise<string> {
  const messages = (await import(`@/messages/${state.locale}.json`)).default;
  return renderToString(
    <NextIntlClientProvider locale={state.locale} messages={messages}>
      {await SiteFooter()}
    </NextIntlClientProvider>,
  );
}

describe('SiteFooter blog/guides link visibility (task 4.1)', () => {
  it('renders both links when both indexes have published items', async () => {
    mockCounts(1, 1);
    const html = await renderFooterHtml();

    expect(html).toContain('href="/blog"');
    expect(html).toContain('href="/guides"');
    // The rest of the footer is untouched by the gating.
    expect(html).toContain('href="/ranking"');
    expect(html).toContain('href="/what-if"');
    expect(html).toContain('data-testid="newsletter-subscribe"');
  });

  it('omits the blog link while the locale has zero published posts', async () => {
    mockCounts(0, 1);
    const html = await renderFooterHtml();

    expect(html).not.toContain('href="/blog"');
    expect(html).toContain('href="/guides"');
  });

  it('omits the guides link while zero published guides', async () => {
    mockCounts(1, 0);
    const html = await renderFooterHtml();

    expect(html).toContain('href="/blog"');
    expect(html).not.toContain('href="/guides"');
  });

  it('hides both links when the counts cannot be resolved (honest default)', async () => {
    mockedRequest.mockRejectedValue(new Error('backend down'));
    const html = await renderFooterHtml();

    expect(html).not.toContain('href="/blog"');
    expect(html).not.toContain('href="/guides"');
    // The ungated chrome still renders.
    expect(html).toContain('href="/ranking"');
    // The scenario calculator link is publication-independent too.
    expect(html).toContain('href="/what-if"');
    expect(html).toContain('Rajahinta.fi on riippumaton hintavertailu-');
  });

  it('resolves the counts for the current locale — fi and en are independent', async () => {
    state.locale = 'en';
    // English has a published post; the Finnish guides list is queried
    // for the English page only through the en endpoints below.
    mockCounts(1, 0, 'en');
    const html = await renderFooterHtml();

    expect(html).toContain('href="/en/blog"');
    expect(html).toContain('href="/en/what-if"');
    expect(html).not.toContain('href="/guides"');
    expect(html).not.toContain('href="/en/guides"');
    const paths = mockedRequest.mock.calls.map(([p]) => String(p));
    expect(paths).toContain('/api/v1/blog/posts?locale=en');
    expect(paths).toContain('/api/v1/guides?locale=en');
  });
});
