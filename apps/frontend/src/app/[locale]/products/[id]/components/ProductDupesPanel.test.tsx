/**
 * ProductDupesPanel SSR tests (task 6.4, change
 * product-roadmap-phases-1-4).
 *
 * Renders the REAL async server component to an HTML string the way
 * Next's RSC runtime would (only Next server plumbing is mocked — the
 * page.ssr.test.tsx precedent), pinning the R9/R13 contract:
 *
 *   1. Flag off → renders nothing, fires no dupes request.
 *   2. Flag on, dupes fetch fails (403 — flag flipped server-side) →
 *      renders nothing.
 *   3. Flag on, empty curated list → renders nothing (no empty shell).
 *   4. Flag on + curated links → every row shows the WHY (producer key,
 *      manufacturer) and the source link is a DIRECT external anchor
 *      with the app's outbound-link treatment (new tab,
 *      nofollow/noopener — no offer id exists to route through the
 *      offer-keyed outbound redirect controller), next to the sibling's
 *      local product-page link.
 *
 * @module ProductDupesPanelTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDupesPanel from './ProductDupesPanel';
import { ApiFetchError, request } from '@/lib/api';
import type { ApiError, FeatureFlagsResponse } from '@/lib/types';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — next-intl/server resolved straight from the
// Finnish catalog, with {param} interpolation for the evidence lines.
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

/** Flags payload with every known flag on and the dupe flag ABSENT. */
function flagsWith(
  producerDupeFinder: boolean | undefined,
): FeatureFlagsResponse {
  return {
    flags: {
      HISTORICAL_PRICE_INTELLIGENCE: false,
      BASKET_OPTIMIZATION: false,
      ADVANCED_FEATURES: false,
      UNIT_PRICE_EUR_PER_GRAM: false,
      ...(producerDupeFinder === undefined
        ? {}
        : { PRODUCER_DUPE_FINDER: producerDupeFinder }),
    },
  };
}

function dupe(overrides: Partial<{
  siblingProductId: number;
  producerKey: string;
  manufacturer: string;
  sourceUrl: string;
  reviewer: string;
  reviewedAt: string;
}> = {}) {
  return {
    siblingProductId: 7,
    producerKey: 'highland distillery',
    manufacturer: 'Highland Distillery Co',
    sourceUrl: 'https://example-shop.example/products/highland-single',
    reviewer: 'ops@example.fi',
    reviewedAt: '2026-08-30T10:00:00.000Z',
    ...overrides,
  };
}

function apiError(status: number, message: string): ApiError {
  return {
    statusCode: status,
    message,
    error: 'Error',
    timestamp: '2026-09-01T10:00:00.000Z',
    path: '/api/v1/products/42/dupes',
  };
}

const PRODUCT_ID = 42;

async function renderPanel(): Promise<string> {
  const element = await ProductDupesPanel({ productId: PRODUCT_ID });
  return renderToString(element);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProductDupesPanel gating (R13, server-resolved)', () => {
  it('flag off → renders nothing and never fetches', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(undefined));

    expect(await renderPanel()).toBe('');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('flag explicitly false → renders nothing', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(false));

    expect(await renderPanel()).toBe('');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('flag on but dupes fetch 403s (flag flipped mid-revalidate) → renders nothing', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(true));
    mockedRequest.mockRejectedValue(
      new ApiFetchError(
        403,
        apiError(403, 'Feature flag PRODUCER_DUPE_FINDER is disabled'),
        'req-1',
      ),
    );

    expect(await renderPanel()).toBe('');
  });

  it('flag on, empty curated list → renders nothing (no empty shell)', async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(true));
    mockedRequest.mockResolvedValue({ dupes: [] });

    expect(await renderPanel()).toBe('');
  });
});

describe('ProductDupesPanel evidence rendering (R9)', () => {
  let html = '';

  beforeEach(async () => {
    mockedGetServerFeatureFlags.mockResolvedValue(flagsWith(true));
    mockedRequest.mockResolvedValue({
      dupes: [
        dupe(),
        dupe({
          siblingProductId: 9,
          producerKey: 'highland distillery',
          manufacturer: 'Highland Distillery Co',
          sourceUrl: 'https://other-shop.example/highland',
        }),
      ],
    });
    html = await renderPanel();
  });

  it('fetches the committed 6.3 dupes endpoint', () => {
    expect(mockedRequest).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/dupes`,
      expect.objectContaining({ next: { revalidate: 900 } }),
    );
  });

  it('renders the panel once per product with one row per sibling', () => {
    expect(html).toContain('data-testid="product-dupes-panel"');
    expect(html.match(/data-testid="product-dupe-item"/g)).toHaveLength(2);
  });

  it('shows the WHY: producer key, producer-key label, manufacturer', () => {
    expect(html).toContain('highland distillery');
    expect(html).toContain('Valmistaja-avain');
    expect(html).toContain('Valmistaja: Highland Distillery Co');
  });

  it('links the sibling to its local product page', () => {
    expect(html).toContain('href="/products/7"');
    expect(html).toContain('href="/products/9"');
    expect(html).toContain('Tuotesivu #7');
  });

  it('renders the source as a DIRECT external anchor with the outbound-link treatment', () => {
    expect(html).toContain('href="https://example-shop.example/products/highland-single"');
    expect(html).toContain('href="https://other-shop.example/highland"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="nofollow noopener"');
    // The source link is the evidence link label, not a raw URL dump.
    expect(html).toContain('Lähde');
  });
});
