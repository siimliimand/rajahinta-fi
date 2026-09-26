/**
 * Product detail page tests (task 4.3, change
 * 2026-09-13-daily-scrape-cadence-current-offers).
 *
 * Renders the REAL async server component the way Next's RSC runtime
 * would — the page is awaited first, then the resolved element tree goes
 * through Testing Library (the catalog page.test.tsx /
 * ProductHistoryPanel.test.tsx precedent; only Next server plumbing and
 * the fetch-holding child panels are mocked).
 *
 * The API contract upstream of this page is already deduped — findOffers
 * returns the latest row per (product, merchant) — so the page contract
 * pinned here is the rendering one: the Retail prices table shows exactly
 * one body row per offer (one per merchant), each carrying that offer's
 * observed date, and the count line reflects the deduped array.
 *
 * @module ProductDetailPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductPage, { generateMetadata } from '../page';
import { getServerProductDetail } from '@/lib/api';
import type { PriceHistoryResponse, ProductDetailResponse } from '@/lib/types';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — next-intl/server resolved from the fi
// catalog (the ICU offerCount plural needs real plural handling, so the
// count line is rendered from the values the page passes), next/navigation
// degraded to a spy, and the fetch-holding child panels stubbed out —
// their contracts have their own test files.
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (await import('@/messages/fi.json'))
      .default as Record<string, unknown>;
    return (key: string, values?: Record<string, unknown>) => {
      // Common.offerCount is an ICU plural — resolve it from the count
      // the page actually passes (fi plural forms, source of truth).
      if (ns === 'Common' && key === 'offerCount') {
        const count = typeof values?.count === 'number' ? values.count : 0;
        return count === 1 ? '1 tarjous' : `${count} tarjousta`;
      }
      const value = key
        .split('.')
        .reduce<unknown>(
          (node, part) =>
            node !== null && typeof node === 'object'
              ? (node as Record<string, unknown>)[part]
              : undefined,
          table[ns],
        );
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      if (values === undefined) return value;
      return value.replace(/\{(\w+)\}/g, (_, k: string) => {
        const replacement = values[k];
        if (typeof replacement === 'number') {
          return new Intl.NumberFormat('fi-FI').format(replacement);
        }
        return replacement === undefined ? `{${k}}` : String(replacement);
      });
    };
  },
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getServerProductDetail: vi.fn(),
  };
});

// The price-history section (task 5.1) is a client island fed by a
// server fetch; its contract has its own test file. The mock keeps the
// pass-through observable via the testid below.
vi.mock('../components/PriceHistoryChart', () => ({
  default: ({ history }: { history: PriceHistoryResponse }) =>
    history.series.length === 0
      ? null
      : React.createElement('section', {
          'data-testid': 'price-history-section',
        }),
}));

// Three levels up: the notice lives in [locale]/components/, sibling of products/.
vi.mock('../../../components/MerchantWarningNotice', () => ({
  default: () => null,
}));
vi.mock('../components/ProductAlertAction', () => ({ default: () => null }));
vi.mock('../components/ProductDupesPanel', () => ({ default: () => null }));
vi.mock('../components/ProductPriceContextLine', () => ({
  default: () => null,
}));

const mockedGetServerProductDetail = vi.mocked(getServerProductDetail);

/** A price-history payload the page can pass straight through. */
function historyResponse(days: number): PriceHistoryResponse {
  const to = '2026-09-10';
  return {
    productId: 42,
    merchant: null,
    metric: 'price',
    granularity: 'day',
    from: to,
    to,
    series:
      days === 0
        ? []
        : [
            {
              periodStart: to,
              openCents: 500,
              closeCents: 500,
              minCents: 450,
              maxCents: 550,
              avgCents: 500,
              observationCount: 2,
              reliability: 'VERIFIED' as const,
            },
          ],
    attribution: [],
    earliestAvailableObservationDate: days === 0 ? null : to,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A detail payload as the deduped API delivers it: one offer per merchant. */
function detailResponse(
  offers: ProductDetailResponse['offers'],
): ProductDetailResponse {
  return {
    product: {
      id: 42,
      name: 'Kotikalja 0.5 l',
      manufacturer: 'Panimo A',
      brand: 'Panimo A',
      category: 'beer',
      alcoholByVolume: 0.047,
      // Canonical litre-denominated text (unit-integrity task 1.3).
      unitVolume: '0.5',
      containerType: 'can',
      regulatoryClassification: 'beer',
      depositSystemStatus: false,
      ean: null,
    },
    offers,
  };
}

function offer(
  overrides: Partial<ProductDetailResponse['offers'][number]> = {},
): ProductDetailResponse['offers'][number] {
  return {
    id: 12,
    merchant: 'alko',
    country: 'FI',
    priceCents: 1999,
    currency: 'EUR',
    availability: 'in_stock',
    sourceUrl: null,
    observedAt: '2026-09-10T06:00:00.000Z',
    reliabilityStatus: 'VERIFIED',
    ...overrides,
  };
}

/** The default detail payload with product fields overridden. */
function detailWith(
  product: Partial<ProductDetailResponse['product']>,
): ProductDetailResponse {
  const base = detailResponse([offer()]);
  return { ...base, product: { ...base.product, ...product } };
}

beforeEach(() => {
  mockedGetServerProductDetail.mockReset();
  // The server-side price-history read rides global fetch; default to
  // the degradation path (section absent) — history tests override it.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('history fetch not mocked')),
  );
});

describe('ProductPage price-history section (task 5.1)', () => {
  it('renders the section when the server fetch delivers history', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse([offer()]));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => historyResponse(1),
      }),
    );

    render(
      await ProductPage({ params: Promise.resolve({ locale: 'fi', id: '42' }) }),
    );

    expect(screen.getByTestId('price-history-section')).toBeInTheDocument();
  });

  it('renders WITHOUT the section when the history fetch fails or is empty', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse([offer()]));

    render(
      await ProductPage({ params: Promise.resolve({ locale: 'fi', id: '42' }) }),
    );
    expect(screen.queryByTestId('price-history-section')).not.toBeInTheDocument();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => historyResponse(0),
      }),
    );
    render(
      await ProductPage({ params: Promise.resolve({ locale: 'fi', id: '42' }) }),
    );
    expect(screen.queryByTestId('price-history-section')).not.toBeInTheDocument();
  });
});

describe('ProductPage master data', () => {
  it('renders volume and ABV through the shared formatters (task 4.1)', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse([offer()]));

    render(
      await ProductPage({ params: Promise.resolve({ locale: 'fi', id: '42' }) }),
    );

    // formatVolume: sub-litre canonical text renders labelled in cl.
    expect(screen.getByText('50 cl')).toBeInTheDocument();
    // formatAbv: the stored fraction 0.047 renders "4.7 %", never the
    // raw fraction, and carries the localized Alkoholipitoisuus label.
    expect(screen.getByText('4.7 %')).toBeInTheDocument();
    expect(screen.getByText('Alkoholipitoisuus')).toBeInTheDocument();
  });

  it('renders category and container type through the catalog labels (task 4.2)', async () => {
    // Fixture product: category 'beer', containerType 'can'.
    mockedGetServerProductDetail.mockResolvedValue(detailResponse([offer()]));

    render(
      await ProductPage({ params: Promise.resolve({ locale: 'fi', id: '42' }) }),
    );

    expect(screen.getByText('Olut')).toBeInTheDocument();
    expect(screen.getByText('Tölkki')).toBeInTheDocument();
    // The raw storage keys never surface as values.
    expect(screen.queryByText('beer')).not.toBeInTheDocument();
    expect(screen.queryByText('can')).not.toBeInTheDocument();
  });

  it('renders the spec-scenario enums localized (other_fermented / plastic)', async () => {
    mockedGetServerProductDetail.mockResolvedValue(
      detailWith({ category: 'other_fermented', containerType: 'plastic' }),
    );

    render(
      await ProductPage({ params: Promise.resolve({ locale: 'fi', id: '42' }) }),
    );

    expect(screen.getByText('Siideri ja pitkäjuoma')).toBeInTheDocument();
    expect(screen.getByText('Muovi')).toBeInTheDocument();
  });

  it('drops the category and container rows for unknown storage keys — no raw-key fallback', async () => {
    mockedGetServerProductDetail.mockResolvedValue(
      detailWith({ category: 'mystery_category', containerType: 'drum' }),
    );

    render(
      await ProductPage({ params: Promise.resolve({ locale: 'fi', id: '42' }) }),
    );

    expect(screen.queryByText('mystery_category')).not.toBeInTheDocument();
    expect(screen.queryByText('drum')).not.toBeInTheDocument();
    // The labelled rows are absent; the other master rows still render.
    expect(screen.queryByText('Kategoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Pakkaustyyppi')).not.toBeInTheDocument();
    expect(screen.getByText('Tuotemerkki')).toBeInTheDocument();
  });
});

describe('ProductPage metadata (task 4.2)', () => {
  it('describes the product with the localized category label, never the raw key', async () => {
    mockedGetServerProductDetail.mockResolvedValue(
      detailWith({ category: 'other_fermented' }),
    );

    const meta = await generateMetadata({
      params: Promise.resolve({ locale: 'fi', id: '42' }),
    });

    expect(meta.description).toContain('Siideri ja pitkäjuoma');
    expect(meta.description).not.toContain('other_fermented');
  });
});

describe('ProductPage Retail prices table', () => {
  it('renders exactly one row per merchant of the deduped payload, each with its latest observed date', async () => {
    mockedGetServerProductDetail.mockResolvedValue(
      detailResponse([
        // Latest per merchant: alko superseded its 2026-09-05 scrape with
        // the 2026-09-10 one; saksoinet has its own older observation.
        offer(),
        offer({
          id: 13,
          merchant: 'saksoinet',
          priceCents: 1500,
          observedAt: '2026-09-05T06:00:00.000Z',
        }),
      ]),
    );

    render(
      await ProductPage({ params: Promise.resolve({ locale: 'fi', id: '42' }) }),
    );

    const table = screen.getByText('Myyjä').closest('table');
    expect(table).not.toBeNull();
    const rows = within(table!.querySelector('tbody')!).getAllByRole('row');
    // One row per merchant — never one per scrape.
    expect(rows).toHaveLength(2);

    const alkoRow = rows.find((row) => row.textContent?.includes('alko'));
    const saksoinetRow = rows.find((row) =>
      row.textContent?.includes('saksoinet'),
    );
    // Each row carries the CURRENT price and the LATEST observed date.
    expect(alkoRow).toHaveTextContent('19.99 €');
    expect(alkoRow).toHaveTextContent('10.9.2026');
    expect(saksoinetRow).toHaveTextContent('15.00 €');
    expect(saksoinetRow).toHaveTextContent('5.9.2026');
  });

  it('derives the count line from the deduped offers array', async () => {
    mockedGetServerProductDetail.mockResolvedValue(
      detailResponse([
        offer(),
        offer({ id: 13, merchant: 'saksoinet', priceCents: 1500 }),
      ]),
    );

    render(
      await ProductPage({ params: Promise.resolve({ locale: 'fi', id: '42' }) }),
    );

    expect(screen.getByText(/2 tarjousta/)).toBeInTheDocument();
  });

  it('renders the honest no-offers note instead of a table for an empty payload', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse([]));

    render(
      await ProductPage({ params: Promise.resolve({ locale: 'fi', id: '42' }) }),
    );

    expect(screen.getByText('Ei aktiivisia hintahavaintoja.')).toBeInTheDocument();
    expect(screen.queryByText('Myyjä')).not.toBeInTheDocument();
  });
});
