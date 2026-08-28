/**
 * Calculation result page state-wiring tests (OpenSpec:
 * design-system-foundation, task 5.3).
 *
 * Pins the designed states wired into the record view:
 *   1. A missing record (404) or a malformed ID renders the EmptyState —
 *      an absence, announced politely — with a route back to the
 *      calculator.
 *   2. Any other load failure renders the retryable ErrorState, and the
 *      retry action re-runs the fetch.
 *
 * The healthy path (full result render, structural disclaimer) is owned
 * by the CalculatorResult compliance suite and is untouched here.
 *
 * @module CalculationResultPageTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalculationResultPage from './page';
import { ApiFetchError, getCalculationResult } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';

// ---------------------------------------------------------------------------
// Mocked Next plumbing — the recordId is steerable per test.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({ recordId: '123' }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ recordId: state.recordId }),
}));

// The i18n Link is router-aware; under jsdom without a router it renders
// as a plain anchor carrying the href it was given.
vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<string, unknown>,
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
    getCalculationResult: vi.fn(),
  };
});

const mockedGetCalculationResult = vi.mocked(getCalculationResult);

function notFoundError(): ApiFetchError {
  return new ApiFetchError(404, {
    statusCode: 404,
    message: 'Calculation record not found',
    error: 'Not Found',
    timestamp: '2026-08-28T12:00:00Z',
    path: '/api/v1/calculator/result/123',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.recordId = '123';
});

// ---------------------------------------------------------------------------
// Missing record → EmptyState
// ---------------------------------------------------------------------------

describe('CalculationResultPage not-found state (task 5.3)', () => {
  it('renders the EmptyState with a route back to the calculator on 404', async () => {
    mockedGetCalculationResult.mockRejectedValue(notFoundError());

    renderWithIntl(<CalculationResultPage />);

    const title = await screen.findByText('Laskentaa ei löytynyt');
    expect(title.closest('[data-state="empty"]')).not.toBeNull();
    expect(
      screen.getByText(
        'Laskentatietuetta ei ole olemassa tai se ei ole enää saatavilla. Linkki voi olla vanhentunut.',
      ),
    ).toBeInTheDocument();

    const back = screen.getByRole('link', { name: /Takaisin laskuriin/ });
    expect(back).toHaveAttribute('href', '/calculator');

    // An absence is not an error: no alert semantics.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats a malformed record ID as not-found without fetching', async () => {
    state.recordId = 'not-a-number';

    renderWithIntl(<CalculationResultPage />);

    const title = await screen.findByText('Laskentaa ei löytynyt');
    expect(title.closest('[data-state="empty"]')).not.toBeNull();
    expect(
      screen.getByText('Virheellinen laskentatietueen tunniste.'),
    ).toBeInTheDocument();
    expect(mockedGetCalculationResult).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Other load failures → retryable ErrorState
// ---------------------------------------------------------------------------

describe('CalculationResultPage load-error state (task 5.3)', () => {
  it('renders the ErrorState and re-runs the fetch on retry', async () => {
    mockedGetCalculationResult
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'));
    const user = userEvent.setup();

    renderWithIntl(<CalculationResultPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-state', 'error');
    expect(screen.getByText('Lataaminen epäonnistui')).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();
    // Not-found copy must not leak into the retryable branch.
    expect(
      screen.queryByText(/Laskentatietuetta ei ole olemassa/),
    ).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Yritä uudelleen' }));
    await waitFor(() =>
      expect(mockedGetCalculationResult).toHaveBeenCalledTimes(2),
    );
  });
});
