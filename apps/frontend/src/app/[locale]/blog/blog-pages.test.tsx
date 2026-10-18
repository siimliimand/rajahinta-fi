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
 *   2. Zero published posts → notFound() — a crawler-honest 404, no
 *      empty shell (honest-trust-surfaces task 4.1, design D5).
 *   3. Fetch failure → the unavailable state, no crash (a fetch failure
 *      is not evidence of zero posts).
 *
 *   Slug (/blog/:slug):
 *   4. A published post renders its title, bullet-list body lines, and
 *      the back link; bullet lines render as list items, never raw "- ".
 *   5. Unknown slug AND draft → the SAME notFound() (no existence
 *      leakage for drafts).
 *   6. generateMetadata: post-specific title/description when ok,
 *      generic fallback when not.
 *   7. The detail page embeds a BlogPosting JSON-LD graph from the
 *      fetched post's stored fields, in both locales (seo-aeo-agent-
 *      surfaces task 1.2); the index page embeds none.
 *
 * @module BlogPagesTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BlogIndexPage, {
  generateMetadata as blogIndexMetadata,
} from './page';
import BlogPostPage, { generateMetadata } from './[slug]/page';
import { parsePostBody } from './blog-post-body';
import { request } from '@/lib/api';
import type { ApiError } from '@/lib/types';

/**
 * Both blog pages embed the newsletter client island (task 5.4), so the
 * real component trees need the client-intl context the [locale] layout
 * provides in the app (SiteHeader/SiteFooter SSR precedent).
 */
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

/** The EN fixture — the same contract, one English-language row. */
const POST_EN = {
  slug: 'tax-change-2026-2',
  locale: 'en',
  title: 'Tax dataset 2026-2',
  rateDatasetVersion: '2026-2',
  publishedAt: '2026-09-01T09:00:00.000Z',
  bodyMarkdown: 'The rate dataset 2026-2 takes effect on 1 Oct 2026.',
};

/** The one ld+json script the detail page renders, parsed. */
function extractArticleJsonLd(html: string): Record<string, unknown> {
  const match = html.match(
    /<script type="application\/ld\+json">(.*?)<\/script>/,
  );
  expect(match).not.toBeNull();
  return JSON.parse(match![1]) as Record<string, unknown>;
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
    const html = await renderPageHtml(element);

    expect(html).toContain('Veromuutus 2026-2');
    // The typed href renders the localized segment (/blogi, design D1).
    expect(html).toContain('href="/blogi/veromuutos-2026-2"');
    expect(html).toContain('Veroaineiston versio 2026-2');
  });

  it('emits the localized canonical and hreflang pair for the index (design D6)', async () => {
    const fi = await blogIndexMetadata({
      params: Promise.resolve({ locale: 'fi' }),
    });
    expect(fi.alternates?.canonical).toBe('/blogi');
    expect(fi.alternates?.languages).toEqual({
      fi: '/blogi',
      en: '/en/blog',
      'x-default': '/blogi',
    });

    const en = await blogIndexMetadata({
      params: Promise.resolve({ locale: 'en' }),
    });
    expect(en.alternates?.canonical).toBe('/en/blog');
  });

  it('answers a crawler-honest 404 when nothing is published (task 4.1)', async () => {
    const { notFound } = await import('next/navigation');
    mockedRequest.mockResolvedValue({ items: [], total: 0 });

    // notFound() aborts the render — no empty-state shell is served.
    await expect(
      BlogIndexPage({
        params: Promise.resolve({ locale: 'fi' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(vi.mocked(notFound)).toHaveBeenCalledTimes(1);
  });

  it('renders the unavailable state on fetch failure', async () => {
    mockedRequest.mockRejectedValue(new Error('backend down'));

    const element = await BlogIndexPage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    const html = await renderPageHtml(element);

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
    const html = await renderPageHtml(element);

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
    const html = await renderPageHtml(element);

    expect(html).toContain('Blogi ei ole juuri nyt saatavilla');
  });

  it('generates post-specific metadata when ok and generic otherwise', async () => {
    mockedRequest.mockResolvedValue(POST_OK);
    const ok = await generateMetadata({
      params: Promise.resolve({ locale: 'fi', slug: 'veromuutos-2026-2' }),
    });
    expect(ok.title).toContain('Veromuutus 2026-2');
    // Localized canonical + hreflang pair (design D6), in both branches.
    expect(ok.alternates?.canonical).toBe('/blogi/veromuutos-2026-2');
    expect(ok.alternates?.languages).toEqual({
      fi: '/blogi/veromuutos-2026-2',
      en: '/en/blog/veromuutos-2026-2',
      'x-default': '/blogi/veromuutos-2026-2',
    });

    mockedRequest.mockRejectedValue(
      new (await import('@/lib/api')).ApiFetchError(404, apiError(404), null),
    );
    const fallback = await generateMetadata({
      params: Promise.resolve({ locale: 'fi', slug: 'ei-olemassa' }),
    });
    expect(fallback.title).toBe('Blogi');
    expect(fallback.alternates?.canonical).toBe('/blogi/ei-olemassa');
  });
});

// ---------------------------------------------------------------------------
// Article JSON-LD (seo-aeo-agent-surfaces task 1.2)
// ---------------------------------------------------------------------------

describe('BlogPostPage JSON-LD', () => {
  it('embeds a BlogPosting graph from the fetched post, in Finnish', async () => {
    mockedRequest.mockResolvedValue(POST_OK);

    const element = await BlogPostPage({
      params: Promise.resolve({ locale: 'fi', slug: 'veromuutos-2026-2' }),
    });
    const jsonLd = extractArticleJsonLd(await renderPageHtml(element));

    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd['@type']).toBe('BlogPosting');
    // Stored fields, verbatim — headline and the publication date the
    // row carries; no dateModified exists on the post contract.
    expect(jsonLd.headline).toBe('Veromuutus 2026-2');
    expect(jsonLd.datePublished).toBe('2026-09-01T09:00:00.000Z');
    expect(jsonLd).not.toHaveProperty('dateModified');
    expect(jsonLd.inLanguage).toBe('fi');
    // Author is the site Organization, and the graph's page reference
    // is the canonical serving URL (the localized /blogi segment).
    expect(jsonLd.author).toEqual({
      '@type': 'Organization',
      name: 'Rajahinta.fi',
      url: 'https://rajahinta.fi',
    });
    expect(jsonLd.mainEntityOfPage).toEqual({
      '@type': 'WebPage',
      '@id': 'https://rajahinta.fi/blogi/veromuutos-2026-2',
    });
  });

  it('embeds the same graph for the EN serving locale', async () => {
    mockedRequest.mockResolvedValue(POST_EN);

    const element = await BlogPostPage({
      params: Promise.resolve({ locale: 'en', slug: 'tax-change-2026-2' }),
    });
    const jsonLd = extractArticleJsonLd(await renderPageHtml(element));

    expect(jsonLd['@type']).toBe('BlogPosting');
    expect(jsonLd.headline).toBe('Tax dataset 2026-2');
    expect(jsonLd.inLanguage).toBe('en');
    expect(jsonLd.mainEntityOfPage).toEqual({
      '@type': 'WebPage',
      '@id': 'https://rajahinta.fi/en/blog/tax-change-2026-2',
    });
  });

  it('omits datePublished when the stored post carries no date', async () => {
    mockedRequest.mockResolvedValue({ ...POST_OK, publishedAt: null });

    const element = await BlogPostPage({
      params: Promise.resolve({ locale: 'fi', slug: 'veromuutos-2026-2' }),
    });
    const jsonLd = extractArticleJsonLd(await renderPageHtml(element));

    expect(jsonLd).not.toHaveProperty('datePublished');
    expect(jsonLd.headline).toBe('Veromuutus 2026-2');
  });

  it('embeds no JSON-LD on the index page', async () => {
    mockedRequest.mockResolvedValue({ items: [POST_OK], total: 1 });

    const element = await BlogIndexPage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    const html = await renderPageHtml(element);

    expect(html).not.toContain('application/ld+json');
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
