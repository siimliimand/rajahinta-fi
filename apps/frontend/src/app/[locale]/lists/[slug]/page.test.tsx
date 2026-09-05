/**
 * Curated list page tests (task 7.3, change product-roadmap-phases-1-4).
 *
 * Renders the REAL async server component the way Next's RSC runtime
 * would (only Next server plumbing is mocked — the ProductDupesPanel
 * 6.4 test precedent), pinning the committed 7.2 API contract:
 *
 *   1. CURATED_LISTS off (absent key or explicit false) → the
 *      feature-unavailable state renders and no list request fires.
 *   2. Flag on, unknown slug → API 404 → notFound().
 *   3. Flag on, known slug with zero published entries → criteria
 *      render + the explicit empty state, no entry rows.
 *   4. Flag on, published entries → every entry shows its mandatory
 *      rationale; evidence links are DIRECT external anchors with the
 *      outbound treatment (new tab, nofollow/noopener — no offer id
 *      exists to route through the offer-keyed redirect controller);
 *      productId entries link to the local product page; externalRef
 *      entries render the reference without a local link; the
 *      CollectionPage/ItemList JSON-LD carries absolute factual URLs.
 *   5. Flag on, fetch 403s (flag flipped off mid-revalidate) → the
 *      unavailable state, no crash.
 *   6. generateMetadata: list-specific title/description when ok,
 *      generic fallback when flag off or unknown slug.
 *
 * @module CuratedListPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CuratedListPage, { generateMetadata } from './page';
import { request } from '@/lib/api';
import type { ApiError, FeatureFlagsResponse } from '@/lib/types';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — next-intl/server resolved straight from the
// Finnish catalog, with {param} interpolation.
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (await import('@/messages/fi.json')).default as Record<
      string,
      unknown
    >;
    return (key: string, values?: Record<string, unknown>) => {
      const value = (
        table[ns] as Record<string, unknown> | undefined
      )?.[key];
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
}));

// The i18n Link is a Next router-aware component; under renderToString it
// renders as a plain anchor with the href it was given (fi needs no prefix).
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
    getServerFeatureFlags: vi.fn(),
    request: vi.fn(),
  };
});

import { getServerFeatureFlags } from '@/lib/api';
const mockedGetServerFeatureFlags = vi.mocked(getServerFeatureFlags);
const mockedRequest = vi.mocked(request);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLUG = 'alkon-hylkaamat';

/** Flags payload with every known flag off and CURATED_LISTS controllable. */
function flagsWith(curatedLists: boolean | undefined): FeatureFlagsResponse {
  return {
    flags: {
      HISTORICAL_PRICE_INTELLIGENCE: false,
      BASKET_OPTIMIZATION: false,
      ADVANCED_FEATURES: false,
      UNIT_PRICE_EUR_PER_GRAM: false,
      ...(curatedLists === undefined
        ? {}
        : { CURATED_LISTS: curatedLists }),
    },
  } as FeatureFlagsResponse;
}

/** GET /api/v1/lists/:slug — one local entry, one externalRef-only entry. */
const LIST_OK = {
  slug: SLUG,
  title: 'Alkon hylkäämät',
  criteria: ['Kriteeri yksi.', 'Kriteeri kaksi.'],
  entries: [
    {
      id: 1,
      productId: 7,
      externalRef: null,
      rationale: 'Perustelu ensimmäiselle listaukselle.',
      evidenceLinks: [
        { label: 'Arvio', url: 'https://esimerkki.example/arvio' },
        { label: 'Palkinto', url: 'https://esimerkki.example/palkinto' },
      ],
    },
    {
      id: 2,
      productId: null,
      externalRef: 'EXT-42',
      rationale: 'Perustelu toiselle listaukselle.',
      evidenceLinks: [
        { label: 'Lähde', url: 'https://esimerkki.example/lahde' },
      ],
    },
  ],
};

const LIST_EMPTY = { ...LIST_OK, entries: [] };

function apiError(status: number, message: string): ApiError {
  return {
    statusCode: status,
    message,
    error: 'Error',
    timestamp: '2026-09-05T10:00:00.000Z',
    path: `/api/v1/lists/${SLUG}`,
  };
}

async function renderPage(): Promise<string> {
  const element = await CuratedListPage({
    params: Promise.resolve({ locale: 'fi', slug: SLUG }),
  });
  return renderToString(element);
}

function jsonLdOf(html: string): Record<string, unknown> {
  const match =
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CuratedListPage flag gate (server-resolved)', () => {
  it('CURATED_LISTS absent (off) → the unavailable state renders and no list request fires', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(undefined));

    const html = await renderPage();

    expect(html).toContain('data-testid="lists-unavailable"');
    expect(html).not.toContain('data-testid="lists-criteria"');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('CURATED_LISTS explicitly false → the unavailable state renders', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(false));

    const html = await renderPage();

    expect(html).toContain('data-testid="lists-unavailable"');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('flag on but list fetch 403s (flag flipped mid-revalidate) → the unavailable state', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(true));
    mockedRequest.mockRejectedValue(
      new (await import('@/lib/api')).ApiFetchError(
        403,
        apiError(403, 'Feature flag is off'),
        'req-1',
      ),
    );

    const html = await renderPage();

    expect(html).toContain('data-testid="lists-unavailable"');
    expect(html).not.toContain('data-testid="lists-entries"');
  });
});

describe('CuratedListPage slug outcomes', () => {
  it('unknown slug (API 404) → notFound()', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(true));
    mockedRequest.mockRejectedValue(
      new (await import('@/lib/api')).ApiFetchError(
        404,
        apiError(404, `List "${SLUG}" not found`),
        'req-1',
      ),
    );

    await expect(renderPage()).rejects.toBe(NOT_FOUND);
  });

  it('known slug, zero published entries → criteria + explicit empty state, no entries', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(true));
    mockedRequest.mockResolvedValue(LIST_EMPTY);

    const html = await renderPage();

    expect(html).toContain('data-testid="lists-criteria"');
    expect(html).toContain('Kriteeri yksi.');
    expect(html).toContain('Kriteeri kaksi.');
    expect(html).toContain('data-testid="lists-empty"');
    expect(html).not.toContain('data-testid="list-entry"');
  });

  it('fetches the committed 7.2 endpoint at the sitemap revalidation cadence', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(true));
    mockedRequest.mockResolvedValue(LIST_EMPTY);

    await renderPage();

    expect(mockedRequest).toHaveBeenCalledWith(
      `/api/v1/lists/${SLUG}`,
      expect.objectContaining({ next: { revalidate: 900 } }),
    );
  });
});

describe('CuratedListPage entry rendering', () => {
  let html = '';

  beforeEach(async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(true));
    mockedRequest.mockResolvedValue(LIST_OK);
    html = await renderPage();
  });

  it('renders title, criteria, and one row per published entry', () => {
    expect(html).toContain('Alkon hylkäämät');
    expect(html).toContain('data-testid="lists-criteria"');
    expect(html.match(/data-testid="list-entry"/g)).toHaveLength(2);
    expect(html).not.toContain('data-testid="lists-empty"');
  });

  it('shows the mandatory rationale per entry', () => {
    expect(html).toContain('Perustelu ensimmäiselle listaukselle.');
    expect(html).toContain('Perustelu toiselle listaukselle.');
    expect(html).toContain('Perustelu');
  });

  it('renders evidence links as DIRECT external anchors with the outbound treatment', () => {
    expect(html).toContain('href="https://esimerkki.example/arvio"');
    expect(html).toContain('href="https://esimerkki.example/palkinto"');
    expect(html).toContain('href="https://esimerkki.example/lahde"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="nofollow noopener"');
    // Labels, not raw URL dumps.
    expect(html).toContain('Arvio');
    expect(html).toContain('Lähde');
  });

  it('links productId entries to the local product page', () => {
    expect(html).toContain('href="/products/7"');
  });

  it('renders externalRef-only entries without a local link, showing the reference', () => {
    expect(html).toContain('data-testid="list-entry-external-ref"');
    expect(html).toContain('EXT-42');
    expect(html).not.toContain('href="/products/EXT-42"');
  });

  it('embeds CollectionPage/ItemList JSON-LD with absolute factual URLs', () => {
    const jsonLd = jsonLdOf(html);
    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd['@type']).toBe('CollectionPage');
    expect(jsonLd['name']).toBe('Alkon hylkäämät');

    const mainEntity = jsonLd['mainEntity'] as Record<string, unknown>;
    expect(mainEntity['@type']).toBe('ItemList');

    const items = mainEntity['itemListElement'] as Array<
      Record<string, unknown>
    >;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      '@type': 'ListItem',
      position: 1,
      url: 'https://rajahinta.fi/products/7',
    });
    // The externalRef-only entry contributes a position, never a
    // fabricated URL.
    expect(items[1]).toMatchObject({ '@type': 'ListItem', position: 2 });
    expect(items[1]['url']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateMetadata
// ---------------------------------------------------------------------------

function metadataParams(): { params: Promise<{ locale: string; slug: string }> } {
  return { params: Promise.resolve({ locale: 'fi', slug: SLUG }) };
}

describe('CuratedListPage generateMetadata', () => {
  it('flag off → generic fallback metadata', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(undefined));

    const meta = await generateMetadata(metadataParams());

    expect(meta.title).toBe('Listausta ei löytynyt');
    expect(meta.description).toContain('Kuratoidut tuotelistaukset');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('flag on, list ok → list-specific title and description', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(true));
    mockedRequest.mockResolvedValue(LIST_OK);

    const meta = await generateMetadata(metadataParams());

    expect(meta.title).toBe('Alkon hylkäämät — kuratoitu listaus');
    expect(meta.description).toContain('Alkon hylkäämät');
    expect(meta.description).toContain('todistelulinkit');
  });

  it('unknown slug (404) → generic fallback metadata', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(true));
    mockedRequest.mockRejectedValue(
      new (await import('@/lib/api')).ApiFetchError(
        404,
        apiError(404, `List "${SLUG}" not found`),
        'req-1',
      ),
    );

    const meta = await generateMetadata(metadataParams());

    expect(meta.title).toBe('Listausta ei löytynyt');
  });
});
