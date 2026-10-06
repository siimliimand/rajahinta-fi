/**
 * Compare view example-prefill tests (task 3.2, change
 * savings-first-catalog-and-prefill).
 *
 * Pins the contract: opening /compare with no selected products fetches
 * the per-merchant snapshot listing once and loads one example column per
 * cross-border merchant through read-only reads — no calculation call
 * fires from the prefill, and an empty listing (no materialized day)
 * leaves the existing empty state standing.
 *
 * @module CompareViewPrefillTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CompareView from './compare-view';
import {
  calculateLandedCost,
  getSavingsBestPerMerchant,
  getProductDetail,
} from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import fiMessages from '@/messages/fi.json';
import type { SavingsBestPerMerchantRow } from '@/lib/api';
import type { ProductDetailResponse } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    searchProducts: vi.fn(),
    calculateLandedCost: vi.fn(),
    getProductDetail: vi.fn(),
    getSavingsBestPerMerchant: vi.fn(),
    // The columns' history and freshness panels probe these on mount;
    // never-settling promises keep the render offline without failure
    // paths (ComparisonView.test.tsx precedent).
    getMerchantReliability: vi.fn(() => new Promise(() => {})),
    getPriceHistory: vi.fn(() => new Promise(() => {})),
    logClick: vi.fn(),
  };
});

// The i18n navigation Link does not resolve under vitest's ESM transform
// — stub the plain-anchor shape every other component test uses.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

const mockedGetSavingsBestPerMerchant = vi.mocked(getSavingsBestPerMerchant);
const mockedGetProductDetail = vi.mocked(getProductDetail);
const mockedCalculateLandedCost = vi.mocked(calculateLandedCost);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROW: SavingsBestPerMerchantRow = {
  productId: 42,
  productName: 'Renat',
  category: 'Vodka',
  merchant: 'systembolaget',
  merchantCountry: 'SE',
  priceCents: 3099,
  observedAt: '2026-10-05T10:00:00.000Z',
  landedTotalCents: 3890,
  alkoReferenceCents: 4499,
  alkoObservedAt: '2026-10-05T10:00:00.000Z',
  gapCents: -609,
  gapBasisPoints: -1354,
  reliability: 'VERIFIED',
  confidence: 'HIGH',
  taxDatasetVersion: 'test',
};

const ROW_SECOND: SavingsBestPerMerchantRow = {
  ...ROW,
  productId: 77,
  productName: 'Vinmonopolet örö',
  merchant: 'vinmonopolet',
  merchantCountry: 'NO',
};

function detailFor(id: number, name: string): ProductDetailResponse {
  return {
    product: {
      id,
      name,
      manufacturer: 'Testiryhmä',
      brand: 'Sprit',
      category: 'Vodka',
      alcoholByVolume: 0.375,
      unitVolume: '0.7',
      containerType: 'BOTTLE',
      regulatoryClassification: 'SPIRITS',
      depositSystemStatus: false,
      ean: null,
    },
    offers: [
      {
        id: 10 + id,
        merchant: 'systembolaget',
        country: 'SE',
        priceCents: 3099,
        currency: 'SEK',
        availability: 'AVAILABLE',
        sourceUrl: null,
        observedAt: '2026-10-05T10:00:00.000Z',
        reliabilityStatus: 'VERIFIED',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CompareView example prefill (task 3.2, savings-first-catalog-and-prefill)', () => {
  it('opens with one example column per cross-border merchant, labeled, with the /savings note and the add tile', async () => {
    mockedGetSavingsBestPerMerchant.mockResolvedValue({
      asOf: '2026-10-05',
      merchants: [ROW, ROW_SECOND],
    });
    // The read-only detail read resolves for the first row and fails for
    // the second — that column degrades to the row alone.
    mockedGetProductDetail.mockImplementation(async (id: number) => {
      if (id === ROW.productId) return detailFor(id, ROW.productName);
      throw new Error('offline');
    });

    renderWithIntl(<CompareView />);

    const columns = await screen.findAllByTestId('example-column-badge');
    expect(columns).toHaveLength(2);

    // The snapshot's own total renders as the column's landed cost —
    // computed by the daily pass, not by a fresh calculation.
    expect(screen.getByText('Renat')).toBeInTheDocument();
    expect(screen.getByText(ROW_SECOND.productName)).toBeInTheDocument();

    // The one-note example framing links to the full listing.
    const note = screen.getByTestId('comparison-examples-note');
    expect(
      within(note).getByRole('link', { name: 'Katso koko luettelo' }),
    ).toHaveAttribute('href', '/savings');

    // The add-product affordances are retained: the toolbar control and
    // the grid's add tile.
    expect(screen.getAllByRole('button', { name: /Lisää tuote/ })).toHaveLength(
      2,
    );
  });

  it('fires no calculation call from the prefill — not on render, not on detail reads', async () => {
    mockedGetSavingsBestPerMerchant.mockResolvedValue({
      asOf: '2026-10-05',
      merchants: [ROW],
    });
    mockedGetProductDetail.mockResolvedValue(
      detailFor(ROW.productId, ROW.productName),
    );

    renderWithIntl(<CompareView />);

    await screen.findByTestId('example-column-badge');
    await waitFor(() =>
      expect(mockedGetProductDetail).toHaveBeenCalledWith(ROW.productId),
    );

    // Read-only prefill: the calculator endpoint is never touched, so no
    // calculation record can be created either.
    expect(mockedCalculateLandedCost).not.toHaveBeenCalled();
  });

  it('fetches the listing exactly once per mount', async () => {
    mockedGetSavingsBestPerMerchant.mockResolvedValue({
      asOf: '2026-10-05',
      merchants: [ROW],
    });
    mockedGetProductDetail.mockResolvedValue(
      detailFor(ROW.productId, ROW.productName),
    );

    const view = renderWithIntl(<CompareView />);
    await screen.findByTestId('example-column-badge');
    // A re-render (provider re-wrapped — the render helper's own
    // rerender is unprovidered) must not refetch.
    view.rerender(
      <NextIntlClientProvider locale="fi" messages={fiMessages}>
        <CompareView />
      </NextIntlClientProvider>,
    );

    expect(mockedGetSavingsBestPerMerchant).toHaveBeenCalledTimes(1);
  });

  it('degrades to the existing empty state on an empty listing, with no calculation call', async () => {
    mockedGetSavingsBestPerMerchant.mockResolvedValue({
      asOf: null,
      merchants: [],
    });

    renderWithIntl(<CompareView />);

    // The prefill settles with zero columns — the honest zero renders
    // the pre-existing empty state, never an invented example.
    await waitFor(() => expect(mockedGetSavingsBestPerMerchant).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText('Vertailuun ei ole vielä lisätty tuotteita.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('example-column-badge')).toBeNull();
    // The add-product affordances stand: toolbar control and the
    // empty state's action.
    expect(
      screen.getAllByRole('button', { name: /Lisää tuote/ }).length,
    ).toBeGreaterThan(0);
    expect(mockedGetProductDetail).not.toHaveBeenCalled();
    expect(mockedCalculateLandedCost).not.toHaveBeenCalled();
  });

  it('degrades to the existing empty state when the listing read fails', async () => {
    mockedGetSavingsBestPerMerchant.mockRejectedValue(
      new Error('backend unreachable'),
    );

    renderWithIntl(<CompareView />);

    await waitFor(() =>
      expect(
        screen.getByText('Vertailuun ei ole vielä lisätty tuotteita.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('example-column-badge')).toBeNull();
    expect(mockedCalculateLandedCost).not.toHaveBeenCalled();
  });
});
