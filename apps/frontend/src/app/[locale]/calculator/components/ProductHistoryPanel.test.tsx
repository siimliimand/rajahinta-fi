/**
 * ProductHistoryPanel integration tests (task 5.3).
 *
 * Verifies the flag-gated integration contract:
 *   1. Flag off in the inlined payload → the panel renders nothing on the
 *      FIRST render and NEVER fires the price-history (or product-detail)
 *      request — the guard runs before the fetch, not as error-handling
 *      after.
 *   2. Flag on   → fetches the product-wide daily series with the default
 *      90-day range and renders the chart.
 *   3. Truncated history → the chart states "Data available from <date>"
 *      from earliestAvailableObservationDate instead of implying more.
 *   4. Metric toggle → refetches with metric=landed-cost and relabels.
 *   5. Merchant filter (result view) → refetches with merchant=<name>.
 *   6. Rate-limited failure → neutral retry affordance that refetches.
 *
 * @module ProductHistoryPanelTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductHistoryPanel, {
  defaultHistoryRange,
} from './ProductHistoryPanel';
import { ApiFetchError, getPriceHistory, getProductDetail } from '@/lib/api';
import { ALL_FLAGS_OFF, renderWithIntl } from '@/lib/testing/test-intl';
import type { PriceHistoryResponse } from '@/lib/types';

// Real classifyPriceHistoryError/ApiFetchError are kept; only the network
// functions are mocked.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getPriceHistory: vi.fn(),
    getProductDetail: vi.fn(),
  };
});

const mockedGetPriceHistory = vi.mocked(getPriceHistory);
const mockedGetProductDetail = vi.mocked(getProductDetail);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function historyResponse(
  overrides: Partial<PriceHistoryResponse> = {},
): PriceHistoryResponse {
  const { from, to } = defaultHistoryRange(new Date('2026-08-26T12:00:00Z'));
  return {
    productId: 42,
    merchant: null,
    metric: 'price',
    granularity: 'day',
    from,
    to,
    series: [
      {
        periodStart: from,
        openCents: 1099,
        closeCents: 1099,
        minCents: 1099,
        maxCents: 1099,
        avgCents: 1099,
        observationCount: 2,
        reliability: 'VERIFIED',
      },
      {
        periodStart: to,
        openCents: 1099,
        closeCents: 1149,
        minCents: 1099,
        maxCents: 1149,
        avgCents: 1124,
        observationCount: 3,
        reliability: 'ESTIMATED',
      },
    ],
    attribution: [],
    earliestAvailableObservationDate: null,
    ...overrides,
  };
}

function detailWithMerchants(...merchants: string[]) {
  return {
    product: {
      id: 42,
      name: 'Test product',
      manufacturer: 'Brewer',
      brand: 'Brand',
      category: 'beer',
      alcoholByVolume: 4.7,
      unitVolume: '0.33 l',
      containerType: 'can',
      regulatoryClassification: 'beverage',
      depositSystemStatus: true,
      ean: null,
    },
    offers: merchants.map((merchant, i) => ({
      id: i + 1,
      merchant,
      country: 'SE',
      priceCents: 1099,
      currency: 'EUR',
      availability: 'in_stock',
      sourceUrl: null,
      observedAt: '2026-08-25T06:00:00.000Z',
      reliabilityStatus: 'VERIFIED',
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetPriceHistory.mockResolvedValue(historyResponse());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductHistoryPanel', () => {
  it('hides the section on the first render and never fetches history when the flag is off', () => {
    const { container } = renderWithIntl(
      <ProductHistoryPanel productId={42} showMerchantFilter />,
      { featureFlags: ALL_FLAGS_OFF },
    );

    // Synchronous first-render assertion: the inlined flag state hides the
    // panel with no client-side flag round-trip (task 9.4).
    expect(container.firstChild).toBeNull();

    expect(mockedGetPriceHistory).not.toHaveBeenCalled();
    expect(mockedGetProductDetail).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('product-history-panel'),
    ).not.toBeInTheDocument();
  });

  it('fetches the product-wide daily 90-day series and renders the chart when the flag is on', async () => {
    renderWithIntl(<ProductHistoryPanel productId={42} />);

    const chart = await screen.findByTestId('history-chart');
    expect(chart).toBeInTheDocument();
    expect(screen.getByText('Ulkomainen vähittäishinta · historia')).toBeInTheDocument();
    // Legend shows the product-wide aggregate series.
    expect(screen.getByText('Kaikki myyjät')).toBeInTheDocument();

    expect(mockedGetPriceHistory).toHaveBeenCalledTimes(1);
    const [productIdArg, queryArg] = mockedGetPriceHistory.mock.calls[0];
    expect(productIdArg).toBe(42);
    expect(queryArg.metric).toBe('price');
    expect(queryArg.granularity).toBe('day');
    expect(queryArg.merchant).toBeUndefined();
    // 90-day inclusive range ending today (UTC).
    const { from, to } = defaultHistoryRange();
    expect(queryArg.from).toBe(from);
    expect(queryArg.to).toBe(to);
    expect(
      (Date.parse(queryArg.to) - Date.parse(queryArg.from)) / 86_400_000,
    ).toBe(89);
  });

  it('states "Data available from <date>" when history is truncated by data availability', async () => {
    mockedGetPriceHistory.mockResolvedValue(
      historyResponse({
        // Observations start a month into the requested range.
        earliestAvailableObservationDate: '2026-07-26T06:00:00.000Z',
      }),
    );

    renderWithIntl(<ProductHistoryPanel productId={42} />);

    expect(
      await screen.findByText('Tietoja saatavilla alkaen 26.7.2026'),
    ).toBeInTheDocument();
  });

  it('shows the available-from notice in the empty state when no series exists yet', async () => {
    mockedGetPriceHistory.mockResolvedValue(
      historyResponse({
        series: [],
        earliestAvailableObservationDate: '2026-08-01T06:00:00.000Z',
      }),
    );

    renderWithIntl(<ProductHistoryPanel productId={42} />);

    expect(await screen.findByTestId('history-chart-empty')).toBeInTheDocument();
    expect(
      screen.getByText('Tietoja saatavilla alkaen 1.8.2026'),
    ).toBeInTheDocument();
  });

  it('refetches with metric=landed-cost when the metric is toggled', async () => {
    const user = userEvent.setup();
    renderWithIntl(<ProductHistoryPanel productId={42} />);

    await screen.findByTestId('history-chart');
    mockedGetPriceHistory.mockResolvedValue(
      historyResponse({ metric: 'landed-cost' }),
    );

    await user.click(screen.getByTestId('history-metric-landed-cost'));

    await waitFor(() =>
      expect(mockedGetPriceHistory).toHaveBeenCalledTimes(2),
    );
    expect(mockedGetPriceHistory.mock.calls[1][1].metric).toBe('landed-cost');
    expect(
      await screen.findByText('Kokonaiskustannus · historia'),
    ).toBeInTheDocument();
  });

  it('refetches with a merchant filter when a merchant is selected (result view)', async () => {
    const user = userEvent.setup();
    mockedGetProductDetail.mockResolvedValue(
      detailWithMerchants('merchant-b', 'merchant-a'),
    );
    mockedGetPriceHistory.mockResolvedValue(
      historyResponse({ merchant: 'merchant-a' }),
    );

    renderWithIntl(<ProductHistoryPanel productId={42} showMerchantFilter />);

    const select = await screen.findByTestId('history-merchant-select');
    // Options are deduplicated and sorted — neutral, deterministic order.
    expect(select).toHaveTextContent('Kaikki myyjät');
    expect(select).toHaveTextContent('merchant-a');
    expect(select).toHaveTextContent('merchant-b');

    await user.selectOptions(select, 'merchant-a');

    await waitFor(() =>
      expect(mockedGetPriceHistory).toHaveBeenCalledTimes(2),
    );
    expect(mockedGetPriceHistory.mock.calls[1][1].merchant).toBe('merchant-a');
    // The chart series is labelled with the selected merchant (the name now
    // appears both in the filter options and in the chart legend).
    expect((await screen.findAllByText('merchant-a')).length).toBeGreaterThanOrEqual(2);
  });

  it('degrades a rate-limited failure to a neutral retry affordance that refetches', async () => {
    const user = userEvent.setup();
    mockedGetPriceHistory.mockRejectedValueOnce(
      new ApiFetchError(429, {
        statusCode: 429,
        message: 'Rate limit exceeded',
        error: 'TooManyRequests',
        timestamp: '2026-08-26T12:00:00Z',
        path: '/api/v1/products/42/price-history',
      }),
    );

    renderWithIntl(<ProductHistoryPanel productId={42} />);

    const retry = await screen.findByTestId('history-retry');
    expect(retry).toBeInTheDocument();
    expect(
      screen.getByText('Historiatiedot ovat tilapäisesti poissa käytöstä.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('history-chart')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yritä uudelleen' }));

    await waitFor(() =>
      expect(mockedGetPriceHistory).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByTestId('history-chart')).toBeInTheDocument();
  });

  it('hides the section when the server rejects with 403 (flag flipped off server-side)', async () => {
    mockedGetPriceHistory.mockRejectedValue(
      new ApiFetchError(403, {
        statusCode: 403,
        message: 'Feature flag disabled',
        error: 'Forbidden',
        timestamp: '2026-08-26T12:00:00Z',
        path: '/api/v1/products/42/price-history',
      }),
    );

    const { container } = renderWithIntl(<ProductHistoryPanel productId={42} />);

    await waitFor(() => expect(mockedGetPriceHistory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
