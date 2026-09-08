/**
 * Blog page tests (trust-and-reach-roadmap task 5.2, spec
 * content-publication).
 *
 * Renders the REAL async server components the way Next's RSC runtime
 * would (only Next server plumbing is mocked — the curated-list page
 * test precedent), pinning the committed 5.1 API contract:
 *
 *   Index (/blog):
 *   1. Published posts render title, publication date, dataset version,
 *      and a per-post link to /blog/:slug.
 *   2. Zero published posts → the explicit empty state.
 *   3. Fetch failure → the unavailable state, no crash.
 *
 *   Slug (/blog/:slug):
 *   4. A published post renders its title, bullet-list body lines, and
 *      the back link; bullet lines render as list items, never raw "- ".
 *   5. Unknown slug AND draft → the SAME notFound() (no existence
 *      leakage for drafts).
 *   6. generateMetadata: post-specific title/description when ok,
 *      generic fallback when not.
 *
 * @module BlogPagesTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BlogIndexPage from './page';
import BlogPostPage, { generateMetadata } from './[slug]/page';
import { parsePostBody } from './blog-post-body';
import { request } from '@/lib/api';
import type { ApiError } from '@/lib/types';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — next-intl/server resolved straight from the
// Finnish catalog, with {param} interpolation.
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

vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<
      string,
      unknown
    >,
  ) => {
    const { href, children, ...rest } = props;
    return React.createElement(
      'a',
      { ...rest, href: String(href ?? '') },
      children,
    );
  },
}));

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
// Fixtures
// ---------------------------------------------------------------------------

const POST_OK = {
  slug: 'veromuutos-2026-2',
  locale: 'fi',
  title: 'Veromuutus 2026-2',
  rateDatasetVersion: '2026-2',
  publishedAt: '2026-09-01T09:00:00.000Z',
  bodyMarkdown: [
    'Veroaineiston versio 2026-2 tulee voimaan 1.10.2026.',
    '',
    'Mitä muuttuu:',
    '- olut (valmistevero): 40,0 → 42,0',
    '- viini (valmistevero): 55,0 → 57,0',
    '',
    'Muutos on esimerkkikorissa arviolta 0,35 €.',
  ].join('\n'),
};

function apiError(status: number): ApiError {
  return {
    statusCode: status,
    message: 'error',
    error: 'Error',
    timestamp: '2026-09-08T10:00:00.000Z',
    path: '/api/v1/blog/posts',
  };
}

// ---------------------------------------------------------------------------
// Index page
// ---------------------------------------------------------------------------

describe('BlogIndexPage', () => {
  it('renders published posts with per-post links', async () => {
    mockedRequest.mockResolvedValue({
      items: [POST_OK],
      total: 1,
    });

    const element = await BlogIndexPage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    const html = renderToString(element);

    expect(html).toContain('Veromuutus 2026-2');
    expect(html).toContain('href="/blog/veromuutos-2026-2"');
    expect(html).toContain('Veroaineiston versio 2026-2');
  });

  it('renders the explicit empty state when nothing is published', async () => {
    mockedRequest.mockResolvedValue({ items: [], total: 0 });

    const element = await BlogIndexPage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    const html = renderToString(element);

    expect(html).toContain('Ei vielä julkaisuja');
  });

  it('renders the unavailable state on fetch failure', async () => {
    mockedRequest.mockRejectedValue(new Error('backend down'));

    const element = await BlogIndexPage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    const html = renderToString(element);

    expect(html).toContain('Blogi ei ole juuri nyt saatavilla');
  });
});

// ---------------------------------------------------------------------------
// Slug page
// ---------------------------------------------------------------------------

describe('BlogPostPage', () => {
  it('renders the post body: paragraphs and list items, no raw markers', async () => {
    mockedRequest.mockResolvedValue(POST_OK);

    const element = await BlogPostPage({
      params: Promise.resolve({ locale: 'fi', slug: 'veromuutos-2026-2' }),
    });
    const html = renderToString(element);

    expect(html).toContain('Veromuutus 2026-2');
    expect(html).toContain('tulee voimaan 1.10.2026.');
    // List items render as <li>, the "- " marker never shows.
    expect(html).toContain('<li');
    expect(html).toContain('olut (valmistevero): 40,0 → 42,0');
    expect(html).not.toContain('>- ');
    expect(html).toContain('Kaikki julkaisut');
  });

  it('answers the same not-found for unknown slug and draft', async () => {
    const { notFound } = await import('next/navigation');
    mockedRequest.mockRejectedValue(
      new (await import('@/lib/api')).ApiFetchError(404, apiError(404), null),
    );

    await expect(
      BlogPostPage({
        params: Promise.resolve({ locale: 'fi', slug: 'ei-olemassa' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(vi.mocked(notFound)).toHaveBeenCalled();
  });

  it('renders the unavailable state on a backend failure', async () => {
    mockedRequest.mockRejectedValue(new Error('backend down'));

    const element = await BlogPostPage({
      params: Promise.resolve({ locale: 'fi', slug: 'veromuutos-2026-2' }),
    });
    const html = renderToString(element);

    expect(html).toContain('Blogi ei ole juuri nyt saatavilla');
  });

  it('generates post-specific metadata when ok and generic otherwise', async () => {
    mockedRequest.mockResolvedValue(POST_OK);
    const ok = await generateMetadata({
      params: Promise.resolve({ locale: 'fi', slug: 'veromuutos-2026-2' }),
    });
    expect(ok.title).toContain('Veromuutus 2026-2');

    mockedRequest.mockRejectedValue(
      new (await import('@/lib/api')).ApiFetchError(404, apiError(404), null),
    );
    const fallback = await generateMetadata({
      params: Promise.resolve({ locale: 'fi', slug: 'ei-olemassa' }),
    });
    expect(fallback.title).toBe('Blogi');
  });
});

// ---------------------------------------------------------------------------
// Body parser (unit)
// ---------------------------------------------------------------------------

describe('parsePostBody', () => {
  it('splits paragraphs and bullet blocks deterministically', () => {
    const blocks = parsePostBody(POST_OK.bodyMarkdown);
    // Lead paragraph; the label line ("Mitä muuttuu:") directly before
    // the list; the two list items; the closing impact paragraph.
    expect(blocks).toHaveLength(4);
    expect(blocks[0].kind).toBe('paragraph');
    expect(blocks[1].kind).toBe('paragraph');
    expect(blocks[1].lines[0]).toBe('Mitä muuttuu:');
    expect(blocks[2].kind).toBe('list');
    expect(blocks[2].lines).toHaveLength(2);
    expect(blocks[3].kind).toBe('paragraph');
  });
});
