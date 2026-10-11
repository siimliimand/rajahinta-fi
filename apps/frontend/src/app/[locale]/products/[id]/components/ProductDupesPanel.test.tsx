/**
 * ProductDupesPanel SSR tests (task 6.4, change
 * product-roadmap-phases-1-4; props-based surface in
 * price-history-latency 3.2).
 *
 * Renders the REAL async server component to an HTML string the way
 * Next's RSC runtime would (only Next server plumbing is mocked — the
 * page.ssr.test.tsx precedent), pinning the R9 contract:
 *
 *   1. Null dupes payload — the page's fetch failed — renders nothing.
 *   2. Empty curated list → renders nothing (no empty shell).
 *   3. Curated links → every row shows the WHY (producer key,
 *      manufacturer) and the source link is a DIRECT external anchor
 *      with the app's outbound-link treatment (new tab,
 *      nofollow/noopener — no offer id exists to route through the
 *      offer-keyed outbound redirect controller), next to the sibling's
 *      local product-page link.
 *
 * The page owns the dupes fetch since price-history-latency 3.1 (all
 * four of its server reads start concurrently and the panel receives
 * the resolved payload as a prop). The fetch-side contract that used to
 * be exercised through the panel — endpoint URL, revalidate, failure →
 * null — is pinned below against getServerProductDupes, the pure fetch
 * the page calls.
 *
 * @module ProductDupesPanelTest
 */
// @vitest-environment jsdom

import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDupesPanel from './ProductDupesPanel';
import { getServerProductDupes } from '../product-dupes';
import type { ProductDupe, ProductDupesResponse } from '../product-dupes';
import { ApiFetchError, request } from '@/lib/api';
import type { ApiError } from '@/lib/types';

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
// renders as a plain anchor with the href next-intl would produce —
// typed href objects resolve through the shared testing double.
vi.mock('@/i18n/navigation', async () => {
  const { TestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: TestI18nLink };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function dupe(overrides: Partial<ProductDupe> = {}): ProductDupe {
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

/** Render the panel from the payload the page passes down (3.1). */
async function renderPanel(
  dupes: ProductDupesResponse | null,
): Promise<string> {
  const element = await ProductDupesPanel({ dupes });
  return renderToString(element);
}

describe('ProductDupesPanel degradation', () => {
  it('null dupes payload (page fetch failed) → renders nothing', async () => {
    expect(await renderPanel(null)).toBe('');
  });

  it('empty curated list → renders nothing (no empty shell)', async () => {
    expect(await renderPanel({ dupes: [] })).toBe('');
  });
});

describe('ProductDupesPanel evidence rendering (R9)', () => {
  let html = '';

  beforeEach(async () => {
    html = await renderPanel({
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
    expect(html).toContain('href="/tuotteet/7"');
    expect(html).toContain('href="/tuotteet/9"');
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

// ---------------------------------------------------------------------------
// The page-owned fetch (price-history-latency 3.1): the endpoint URL,
// revalidate, and failure → null degradation this file used to pin through
// the panel are getServerProductDupes's contract now.
// ---------------------------------------------------------------------------

describe('getServerProductDupes (the page-owned dupes fetch)', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  it('fetches the committed 6.3 dupes endpoint with the panel revalidate', async () => {
    mockedRequest.mockResolvedValue({ dupes: [] });

    await getServerProductDupes(PRODUCT_ID);

    expect(mockedRequest).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/dupes`,
      expect.objectContaining({ next: { revalidate: 900 } }),
    );
  });

  it('a failed fetch (403) degrades to null so the panel stays absent', async () => {
    mockedRequest.mockRejectedValue(
      new ApiFetchError(
        403,
        apiError(403, 'Forbidden'),
        'req-1',
      ),
    );

    await expect(getServerProductDupes(PRODUCT_ID)).resolves.toBeNull();
  });
});
