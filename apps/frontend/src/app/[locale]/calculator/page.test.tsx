/**
 * Calculator page state-wiring tests (OpenSpec: design-system-foundation,
 * task 5.3).
 *
 * Pins the designed states wired into the real search → calculate flow:
 *   1. A settled search with zero results renders the EmptyState (not
 *      the selector's inline note).
 *   2. A failed search keeps the inline error and does NOT render the
 *      no-results EmptyState.
 *   3. A rate-limited calculation (429) renders the ErrorState with the
 *      localized rate-limit copy, surfaces the server's Retry-After
 *      wait in seconds, and wires the retry action to re-trigger the
 *      calculation.
 *
 * @module CalculatorPageTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalculatorPage from './page';
import {
  ApiFetchError,
  searchProducts,
  calculateLandedCost,
  listScenarios,
} from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { ProductSearchItem } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    searchProducts: vi.fn(),
    calculateLandedCost: vi.fn(),
    listScenarios: vi.fn(),
    request: vi.fn(),
  };
});

const mockedSearchProducts = vi.mocked(searchProducts);
const mockedCalculateLandedCost = vi.mocked(calculateLandedCost);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HIT: ProductSearchItem = {
  id: 42,
  name: 'Renat',
  brand: 'Sprit',
  category: 'Vodka',
  alcoholByVolume: 37.5,
  unitVolume: '0,7 l',
  containerType: 'BOTTLE',
  lowestPriceCents: 999,
  merchantCount: 1,
};

function searchResponse(items: ProductSearchItem[]) {
  return {
    items,
    total: items.length,
    page: 1,
    limit: 20,
    totalPages: items.length > 0 ? 1 : 0,
  };
}

/** The guard's 429 envelope: body carries the Retry-After seconds. */
function rateLimited(): ApiFetchError {
  return new ApiFetchError(429, {
    statusCode: 429,
    message: 'Rate limit exceeded. Try again in 30s.',
    error: 'TooManyRequests',
    timestamp: '2026-08-28T12:00:00Z',
    path: '/api/v1/calculator',
    retryAfterSeconds: 30,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listScenarios).mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Search no-results → EmptyState
// ---------------------------------------------------------------------------

describe('CalculatorPage search no-results state (task 5.3)', () => {
  it('renders the designed EmptyState when a settled search returns nothing', async () => {
    mockedSearchProducts.mockResolvedValue(searchResponse([]));
    const user = userEvent.setup();

    renderWithIntl(<CalculatorPage />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'absintti');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    const title = await screen.findByText('Ei hakutuloksia');
    expect(title.closest('[data-state="empty"]')).not.toBeNull();
    expect(
      screen.getByText(
        /Tuotteita ei löytynyt haulla "absintti"\. Tarkista kirjoitusasu tai kokeile toista tuotenimeä\./,
      ),
    ).toBeInTheDocument();
    // The selector's inline no-results note is replaced, not duplicated.
    expect(
      screen.queryByText(/Kirjoita tuotteen nimi/),
    ).not.toBeInTheDocument();
  });

  it('keeps the inline error (no EmptyState) when the search itself fails', async () => {
    mockedSearchProducts.mockRejectedValue(new Error('search backend down'));
    const user = userEvent.setup();

    renderWithIntl(<CalculatorPage />);

    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'olut');
    await user.click(screen.getByRole('button', { name: 'Hae' }));

    await screen.findByText('search backend down');
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Calculation 429 → ErrorState with surfaced Retry-After
// ---------------------------------------------------------------------------

describe('CalculatorPage rate-limited calculation state (task 5.3)', () => {
  it('surfaces the 429 Retry-After through the ErrorState and retries', async () => {
    mockedSearchProducts.mockResolvedValue(searchResponse([HIT]));
    mockedCalculateLandedCost.mockRejectedValue(rateLimited());
    const user = userEvent.setup();

    renderWithIntl(<CalculatorPage />);

    // Search → select the hit.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    // Calculate → 429.
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );

    // Designed error state: alert role, localized rate-limit copy, and
    // the server's wait in seconds.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'error');
    expect(screen.getByText('Laskenta epäonnistui')).toBeInTheDocument();
    expect(
      screen.getByText('Laskentojen määrää on rajoitettu väliaikaisesti.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('calc-retry-after')).toHaveTextContent(
      'Odota 30 sekuntia ja yritä sitten uudelleen.',
    );

    // Retry is wired to re-trigger the calculation.
    await user.click(screen.getByRole('button', { name: 'Yritä uudelleen' }));
    await waitFor(() =>
      expect(mockedCalculateLandedCost).toHaveBeenCalledTimes(2),
    );
  });
});
