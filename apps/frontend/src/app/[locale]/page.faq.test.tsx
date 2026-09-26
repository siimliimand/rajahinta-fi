/**
 * Homepage FAQ section tests (price-intelligence-roadmap task 3.4, D4).
 *
 * Renders the REAL server component to an HTML string (page.ssr.test.tsx
 * precedent; only Next server plumbing is mocked), pinning the
 * degradation contract the section shares with the sitemap's guide
 * slugs:
 *
 *   1. Guides fetch fails  → NO FAQ section in the HTML.
 *   2. No PUBLISHED entries → NO FAQ section in the HTML (the state
 *      that ships until task 5.3 authors the entries).
 *   3. Published entries    → the section lists each entry, linking its
 *      /guides/:slug route with the entry title.
 *
 * @module HomePageFaqTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomePage from './page';
import { getServerGuidesIndex } from './guides/guides.server';
import type { BlogPostIndexItem } from '@/lib/types';

vi.mock('./guides/guides.server', () => ({
  getServerGuidesIndex: vi.fn(),
}));

// Mocked Next server plumbing — next-intl/server resolved straight from
// the Finnish catalog (page.ssr.test.tsx precedent).
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
    return (key: string) => {
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
      return typeof value === 'string' ? value : `__MISSING_${ns}.${key}__`;
    };
  },
}));

// The i18n Link renders as a plain anchor under renderToString.
vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<string, unknown>,
  ) => {
    const { href, children, ...rest } = props;
    return React.createElement(
      'a',
      { ...rest, href: String(href ?? '') },
      children,
    );
  },
}));

// Self-contained client island with its own fetch — stub it (SSR stays
// offline, page.ssr.test.tsx precedent).
vi.mock('./components/AccuracyStat', () => ({
  default: () => React.createElement('div'),
}));

const mockedGetServerGuidesIndex = vi.mocked(getServerGuidesIndex);

function guideItem(slug: string, title: string): BlogPostIndexItem {
  return { slug, locale: 'fi', title, rateDatasetVersion: null, publishedAt: null };
}

async function renderHome(): Promise<string> {
  const element = await HomePage({
    params: Promise.resolve({ locale: 'fi' }),
  });
  return renderToString(element);
}

describe('HomePage FAQ section (task 3.4)', () => {
  it('renders NO FAQ section when the guides fetch fails', async () => {
    mockedGetServerGuidesIndex.mockResolvedValue({ kind: 'unavailable' });
    const html = await renderHome();
    expect(html).not.toContain('Usein kysytyt kysymykset');
    expect(html).not.toContain('/guides/');
  });

  it('renders NO FAQ section when no guides are PUBLISHED (initial state)', async () => {
    mockedGetServerGuidesIndex.mockResolvedValue({ kind: 'ok', items: [] });
    const html = await renderHome();
    expect(html).not.toContain('Usein kysytyt kysymykset');
    expect(html).not.toContain('/guides/');
  });

  it('links each PUBLISHED guide entry when entries exist', async () => {
    mockedGetServerGuidesIndex.mockResolvedValue({
      kind: 'ok',
      items: [
        guideItem('miten-laskenta-toimii', 'Miten laskenta toimii?'),
        guideItem('miteiston-tunnisteet', 'Mistä tiedot tulevat?'),
      ],
    });
    const html = await renderHome();

    expect(html).toContain('Usein kysytyt kysymykset');
    expect(html).toContain('href="/guides/miten-laskenta-toimii"');
    expect(html).toContain('Miten laskenta toimii?');
    expect(html).toContain('href="/guides/miteiston-tunnisteet"');
    expect(html).toContain('Mistä tiedot tulevat?');
  });
});
