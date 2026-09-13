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

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductPage from '../page';
import { getServerProductDetail } from '@/lib/api';
import type { ProductDetailResponse } from '@/lib/types';

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
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
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
      unitVolume: '0.5 l',
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

beforeEach(() => {
  mockedGetServerProductDetail.mockReset();
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
