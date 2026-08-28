/**
 * ReportExportActions tests (task 4.2).
 *
 * Verifies the flag-gated export contract:
 *   1. Flag off in the inlined payload → the actions render nothing on the
 *      FIRST render and no report request fires.
 *   2. Flag on → JSON/CSV downloads and the print action delegate to the
 *      report client with the record ID.
 *   3. Entitlement failure (403 InsufficientEntitlement) → a
 *      controlled-vocabulary message, not a crash.
 *   4. Rate-limited failure → the retry-hint message.
 *
 * @module ReportExportActionsTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReportExportActions from './ReportExportActions';
import { ALL_FLAGS_OFF, renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, downloadReport, openPrintableReport } from '@/lib/api';

// Real classifyReportError/ApiFetchError are kept; only the network
// functions are mocked.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    downloadReport: vi.fn(),
    openPrintableReport: vi.fn(),
  };
});

const mockedDownloadReport = vi.mocked(downloadReport);
const mockedOpenPrintableReport = vi.mocked(openPrintableReport);

function apiError(
  status: number,
  error: string,
  message: string,
): ApiFetchError {
  return new ApiFetchError(status, {
    statusCode: status,
    message,
    error,
    timestamp: '2026-08-27T12:00:00Z',
    path: '/api/v1/reports/55',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDownloadReport.mockResolvedValue(undefined);
  mockedOpenPrintableReport.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReportExportActions', () => {
  it('hides the actions on the first render and never fires a report request when the flag is off', () => {
    const { container } = renderWithIntl(<ReportExportActions recordId={55} />, {
      featureFlags: ALL_FLAGS_OFF,
    });

    // Synchronous first-render assertion: the inlined flag state hides the
    // actions with no client-side flag round-trip (task 9.4).
    expect(container.firstChild).toBeNull();

    expect(mockedDownloadReport).not.toHaveBeenCalled();
    expect(mockedOpenPrintableReport).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('report-export-actions'),
    ).not.toBeInTheDocument();
  });

  it('shows the actions on the first render when the flag is on in the inlined payload', () => {
    const { container } = renderWithIntl(<ReportExportActions recordId={55} />);

    // No flag round-trip to wait for — visibility matches the inlined
    // state immediately (task 9.4: no late gated-UI appearance).
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId('report-export-actions')).toBeInTheDocument();
  });

  it('downloads JSON and CSV via the report client when the flag is on', async () => {
    const user = userEvent.setup();
    renderWithIntl(<ReportExportActions recordId={55} />);

    await user.click(await screen.findByTestId('report-export-json'));
    await waitFor(() =>
      expect(mockedDownloadReport).toHaveBeenCalledWith(55, 'json'),
    );

    await user.click(screen.getByTestId('report-export-csv'));
    await waitFor(() =>
      expect(mockedDownloadReport).toHaveBeenCalledWith(55, 'csv'),
    );
    expect(mockedOpenPrintableReport).not.toHaveBeenCalled();
  });

  it('opens the printable report for the print action', async () => {
    const user = userEvent.setup();
    renderWithIntl(<ReportExportActions recordId={55} />);

    await user.click(await screen.findByTestId('report-export-print'));

    await waitFor(() =>
      expect(mockedOpenPrintableReport).toHaveBeenCalledWith(55),
    );
    expect(mockedDownloadReport).not.toHaveBeenCalled();
  });

  it('surfaces a controlled message on an entitlement rejection (no crash)', async () => {
    const user = userEvent.setup();
    mockedDownloadReport.mockRejectedValue(
      apiError(403, 'InsufficientEntitlement', 'Access denied'),
    );

    renderWithIntl(<ReportExportActions recordId={55} />);

    await user.click(await screen.findByTestId('report-export-json'));

    expect(
      await screen.findByTestId('report-export-error'),
    ).toHaveTextContent(
      'Raporttien vieminen vaatii laajennetun tilauksen.',
    );
  });

  it('surfaces a retry-hint message when rate-limited', async () => {
    const user = userEvent.setup();
    mockedDownloadReport.mockRejectedValue(
      apiError(429, 'TooManyRequests', 'Rate limit exceeded'),
    );

    renderWithIntl(<ReportExportActions recordId={55} />);

    await user.click(await screen.findByTestId('report-export-json'));

    expect(
      await screen.findByTestId('report-export-error'),
    ).toHaveTextContent(
      'Raportin vienti on tilapäisesti poissa käytöstä. Yritä myöhemmin uudelleen.',
    );
  });
});
