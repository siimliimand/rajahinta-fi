/**
 * OutcomeReportForm tests (trust-and-reach-roadmap task 3.3).
 *
 * High-liability surface: euro parsing and the API's rejection mapping.
 *
 *   1. parseEuroToCents: "24.90" and the Finnish comma form "24,90" →
 *      2490; "0" / "-5" / "1.234" / "abc" → null (positive integer
 *      cents only — the server rejects anything else anyway).
 *   2. Success renders the within/outside margin confirmation.
 *   3. 409 OUTCOME_ALREADY_EXISTS → the already-reported note.
 *   4. 400 WINDOW_EXPIRED → the window-closed note.
 *   5. Client-side invalid input → the amount copy, no API call.
 *
 * @module OutcomeReportFormTest
 */
// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OutcomeReportForm, { parseEuroToCents } from './OutcomeReportForm';
import { reportCalculationOutcome } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError } from '@/lib/api';
import type { ApiError } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    reportCalculationOutcome: vi.fn(),
  };
});

const mockedReport = vi.mocked(reportCalculationOutcome);

function apiError(status: number, error: string): ApiFetchError {
  const body: ApiError = {
    statusCode: status,
    message: error,
    error,
    timestamp: '2026-09-08T10:00:00.000Z',
    path: '/api/v1/calculations/1/outcome',
  };
  return new ApiFetchError(status, body, null);
}

beforeEach(() => {
  mockedReport.mockReset();
});

describe('parseEuroToCents', () => {
  it('accepts the dot and the Finnish comma decimal forms', () => {
    expect(parseEuroToCents('24.90')).toBe(2490);
    expect(parseEuroToCents('24,90')).toBe(2490);
    expect(parseEuroToCents(' 25 ')).toBe(2500);
  });

  it('rejects non-positives, extra precision, and garbage', () => {
    expect(parseEuroToCents('0')).toBeNull();
    expect(parseEuroToCents('-5')).toBeNull();
    expect(parseEuroToCents('1.234')).toBeNull();
    expect(parseEuroToCents('abc')).toBeNull();
    expect(parseEuroToCents('')).toBeNull();
  });
});

describe('OutcomeReportForm', () => {
  async function submit(amount: string): Promise<void> {
    renderWithIntl(
      <OutcomeReportForm recordId={42} estimatedTotalCents={2500} />,
    );
    await userEvent.type(
      screen.getByLabelText('Todellinen loppusumma (€)'),
      amount,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lähetä raportti' }));
  }

  it('reports a parsed amount and renders the within-margin confirmation', async () => {
    mockedReport.mockResolvedValue({
      id: 1,
      calculationRecordId: 42,
      estimatedTotalCents: 2500,
      reportedTotalCents: 2490,
      withinMargin: true,
      reportedAt: '2026-09-08T10:00:00.000Z',
    });

    await submit('24,90');

    await waitFor(() =>
      expect(mockedReport).toHaveBeenCalledWith(42, 2490),
    );
    expect(
      screen.getByTestId('outcome-report-success-42'),
    ).toBeDefined();
    expect(screen.getByText(/jäi arvion 5 %:n sisään/)).toBeDefined();
  });

  it('renders the outside-margin confirmation without an error', async () => {
    mockedReport.mockResolvedValue({
      id: 1,
      calculationRecordId: 42,
      estimatedTotalCents: 2500,
      reportedTotalCents: 5000,
      withinMargin: false,
      reportedAt: '2026-09-08T10:00:00.000Z',
    });

    await submit('50');
    await waitFor(() =>
      expect(screen.getByText(/poikkesi arviosta yli 5 %/)).toBeDefined(),
    );
  });

  it('maps the duplicate rejection to the already-reported note', async () => {
    mockedReport.mockRejectedValue(apiError(409, 'OUTCOME_ALREADY_EXISTS'));

    await submit('25');
    await waitFor(() =>
      expect(screen.getByText('Tämä laskelma on jo raportoitu.')).toBeDefined(),
    );
  });

  it('maps the window rejection to the window-closed note', async () => {
    mockedReport.mockRejectedValue(apiError(400, 'WINDOW_EXPIRED'));

    await submit('25');
    await waitFor(() =>
      expect(
        screen.getByText(
          'Laskelman 60 vuorokauden raportointiikkuna on sulkeutunut.',
        ),
      ).toBeDefined(),
    );
  });

  it('shows the amount copy for invalid input and never calls the API', async () => {
    await submit('abc');
    expect(mockedReport).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Syötä summa positiivisena euromääränä, esimerkiksi 24,90.',
      ),
    ).toBeDefined();
  });
});
