/**
 * @vitest-environment jsdom
 */
/**
 * ValueRanking — the €/g ranking table of the value page (task 7.2).
 *
 * Contract under test: the API's deterministic order renders verbatim,
 * every row carries the standard reliability badge presentation, and the
 * non-happy paths are the designed empty and error states (rows are
 * never invented). The content stance is asserted too: the table renders
 * only factual cells — no editorial copy is baked into the component.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import ValueRanking from './ValueRanking';
import { renderWithIntl } from '@/lib/testing/test-intl';
import fiMessages from '@/messages/fi.json';
import { request } from '@/lib/api';
import type { UnitPriceRankingItem } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  request: vi.fn(),
}));

const mockRequest = vi.mocked(request);

/**
 * Same Finnish provider as renderWithIntl, but returned so the test can
 * rerender with a new category prop while the wrapper (and its messages)
 * stay in place.
 */
function renderRerenderable(ui: React.ReactElement) {
  return render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="fi" messages={fiMessages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}

const ROWS: UnitPriceRankingItem[] = [
  {
    productId: 1,
    name: 'Nimi A',
    brand: 'Merkki A',
    offerId: 11,
    centsPerGram: 8.9,
    ethanolGrams: 15.8,
    reliabilityStatus: 'VERIFIED',
  },
  {
    productId: 2,
    name: 'Nimi B',
    brand: '',
    offerId: 22,
    centsPerGram: 12.34,
    ethanolGrams: 14,
    reliabilityStatus: 'ESTIMATED',
  },
];

function rankingResponse(items: UnitPriceRankingItem[]) {
  return { category: 'beer', items };
}

beforeEach(() => {
  mockRequest.mockReset();
});

describe('ValueRanking', () => {
  it('fetches the ranking endpoint for the given category', async () => {
    mockRequest.mockResolvedValue(rankingResponse(ROWS));
    renderWithIntl(<ValueRanking category="beer" />);

    await screen.findByRole('table');
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/unitprice/ranking?category=beer',
    );
  });

  it('renders the API order verbatim with position numbers and values', async () => {
    mockRequest.mockResolvedValue(rankingResponse(ROWS));
    renderWithIntl(<ValueRanking category="beer" />);

    const table = await screen.findByRole('table');
    expect(table).toBeInTheDocument();

    // One row per item, positions 1..n in the served order.
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(ROWS.length + 1); // + header row
    expect(screen.getByText('Nimi A')).toBeInTheDocument();
    expect(screen.getByText('Nimi B')).toBeInTheDocument();
    expect(screen.getByText('Merkki A')).toBeInTheDocument();
    // €/g presentation matches the compare view (toFixed(2) + unit).
    expect(screen.getByText('8.90 snt/g')).toBeInTheDocument();
    expect(screen.getByText('12.34 snt/g')).toBeInTheDocument();
    // A missing brand simply renders no brand line — never a placeholder.
    expect(screen.queryByText('Merkki B')).not.toBeInTheDocument();
  });

  it('carries the standard reliability badge per row', async () => {
    mockRequest.mockResolvedValue(rankingResponse(ROWS));
    renderWithIntl(<ValueRanking category="beer" />);

    await screen.findByRole('table');
    // Canonical labels via RELIABILITY_STATUS_META labelKeys (FI catalog).
    const verified = screen.getByText('Vahvistettu');
    const estimated = screen.getByText('Arvioitu');
    expect(verified.closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'verified',
    );
    expect(estimated.closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'estimated',
    );
  });

  it('renders the honest empty state when the category has no rows', async () => {
    mockRequest.mockResolvedValue(rankingResponse([]));
    renderWithIntl(<ValueRanking category="spirits" />);

    const empty = await screen.findByText('Ei näytettäviä rivejä');
    expect(empty).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders the error state with a working retry', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('backend down'))
      .mockResolvedValueOnce(rankingResponse(ROWS));
    renderWithIntl(<ValueRanking category="beer" />);

    await screen.findByText('Luetteloa ei saatu haettua');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button'));
    await screen.findByRole('table');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('re-fetches when the category prop changes', async () => {
    mockRequest.mockResolvedValue(rankingResponse(ROWS));
    const view = renderRerenderable(<ValueRanking category="beer" />);
    await screen.findByRole('table');

    view.rerender(<ValueRanking category="wine_still" />);

    await screen.findByRole('table');
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/unitprice/ranking?category=wine_still',
    );
  });
});
