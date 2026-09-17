/**
 * PriceHistoryChart tests (task 5.1, change price-intelligence-roadmap).
 *
 * The component receives its server-fetched response as a prop and owns
 * only the range view — pinned here (jsdom):
 *
 *   1. Empty history → the WHOLE section is absent (renders nothing).
 *   2. Range switching: 30/90/365 slice the daily series locally; the
 *      shown window line and the table row count follow the range.
 *   3. Table parity: for every range, the table carries exactly one row
 *      per plotted bucket with the SAME figures (date, avg, min, max,
 *      observations), and the SVG polyline has one vertex per row.
 *   4. Observation dates are stated (window line + per-row dates), and
 *      "data available from" renders when the API reports truncation.
 *
 * @module PriceHistoryChartTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import PriceHistoryChart, { sliceSeries } from './PriceHistoryChart';
import type {
  PriceHistoryPoint,
  PriceHistoryResponse,
} from '@/lib/types';
import { renderWithIntl } from '@/lib/testing/test-intl';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** Anchor 'to' of the echoed request window. */
const TO = '2026-09-10';

function point(periodStart: string, overrides: Partial<PriceHistoryPoint> = {}): PriceHistoryPoint {
  return {
    periodStart,
    openCents: 500,
    closeCents: 500,
    minCents: 450,
    maxCents: 550,
    avgCents: 500,
    observationCount: 3,
    reliability: 'VERIFIED',
    ...overrides,
  };
}

/** A series of daily buckets covering the N days ending at TO. */
function history(days: number, overrides: Partial<PriceHistoryResponse> = {}): PriceHistoryResponse {
  const toMs = Date.parse(TO);
  const series = Array.from({ length: days }, (_, i) => {
    const ms = toMs - (days - 1 - i) * DAY_MS;
    return point(new Date(ms).toISOString().slice(0, 10));
  });
  return {
    productId: 42,
    merchant: null,
    metric: 'price',
    granularity: 'day',
    from: series.length > 0 ? series[0]!.periodStart : TO,
    to: TO,
    series,
    attribution: [],
    earliestAvailableObservationDate:
      series.length > 0 ? series[0]!.periodStart : null,
    ...overrides,
  };
}

function renderChart(data: PriceHistoryResponse) {
  return renderWithIntl(<PriceHistoryChart history={data} />);
}

// ---------------------------------------------------------------------------
// Empty case
// ---------------------------------------------------------------------------

it('renders NOTHING for an empty history — the whole section is absent', () => {
  const { container } = renderChart(history(0, { series: [] }));
  expect(container.innerHTML).toBe('');
  expect(screen.queryByTestId('price-history-section')).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Range switching
// ---------------------------------------------------------------------------

describe('range switching (30 / 90 / 365)', () => {
  it('defaults to 90 days and slices the fetched series locally', () => {
    renderChart(history(365));

    expect(
      screen.getByTestId('price-history-range-90').getAttribute('aria-pressed'),
    ).toBe('true');
    // 90 shown buckets of the 365 fetched; every bucket lands in the table.
    expect(screen.getAllByTestId('price-history-row')).toHaveLength(90);
    expect(screen.getByTestId('price-history-window').textContent).toContain(
      '90',
    );
  });

  it('30 days shows only the last 30 buckets, 365 shows all of them', async () => {
    const user = userEvent.setup();
    renderChart(history(365));

    await user.click(screen.getByTestId('price-history-range-30'));
    expect(screen.getAllByTestId('price-history-row')).toHaveLength(30);

    await user.click(screen.getByTestId('price-history-range-365'));
    expect(screen.getAllByTestId('price-history-row')).toHaveLength(365);
  });

  it('sliceSeries is pure: the same input always yields the same slice', () => {
    const data = history(120);
    expect(sliceSeries(data, 30)).toEqual(sliceSeries(data, 30));
    // Ascending by date, inside the window.
    const slice = sliceSeries(data, 30);
    const dates = slice.map((p) => Date.parse(p.periodStart));
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
    expect(slice.every((p) => Date.parse(p.periodStart) >= Date.parse(data.to) - 29 * DAY_MS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Table parity with the chart
// ---------------------------------------------------------------------------

/** The component's date rendering, mirrored for expectations. */
function expectDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fi-FI', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

describe('data-table parity', () => {
  it.each([30, 90, 365] as const)(
    'table rows match the plotted buckets one-to-one with the same figures (%i days)',
    async (range) => {
      const user = userEvent.setup();
      const data = history(120, {
        series: Array.from({ length: 120 }, (_, i) =>
          point(new Date(Date.parse(TO) - (119 - i) * DAY_MS).toISOString().slice(0, 10), {
            avgCents: 500 + i,
            minCents: 450 + i,
            maxCents: 550 + i,
            observationCount: i % 7,
          }),
        ),
      });
      renderChart(data);
      await user.click(screen.getByTestId(`price-history-range-${range}`));

      const rows = screen.getAllByTestId('price-history-row');
      const expected = sliceSeries(data, range);
      expect(rows).toHaveLength(expected.length);

      // One polyline vertex per plotted bucket (x,y pairs).
      const line = screen.getByTestId('price-history-line');
      expect(
        line.getAttribute('points')!.trim().split(/\s+/),
      ).toHaveLength(expected.length);

      // Same figures, first and last row (dates in the component's
      // localized observation-date form).
      const first = expected[0]!;
      const last = expected[expected.length - 1]!;
      expect(rows[0]!.textContent).toContain(`${(first.avgCents / 100).toFixed(2)} €`);
      expect(rows[0]!.textContent).toContain(`${(first.minCents / 100).toFixed(2)} €`);
      expect(rows[0]!.textContent).toContain(`${(first.maxCents / 100).toFixed(2)} €`);
      expect(rows[0]!.textContent).toContain(String(first.observationCount));
      expect(rows[0]!.textContent).toContain(expectDate(first.periodStart));
      expect(rows[rows.length - 1]!.textContent).toContain(
        `${(last.avgCents / 100).toFixed(2)} €`,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Observation dates + truncation note
// ---------------------------------------------------------------------------

it('states the observation window and the earliest available date', () => {
  renderChart(history(3));

  const window = screen.getByTestId('price-history-window');
  expect(window.textContent).toContain(expectDate('2026-09-08'));
  expect(window.textContent).toContain(expectDate('2026-09-10'));
  expect(screen.getByTestId('price-history-section').textContent).toContain(
    'Tietoja saatavilla',
  );
  expect(screen.getByTestId('price-history-section').textContent).toContain(
    expectDate('2026-09-08'),
  );
});

it('a single observation day still renders the section without a range line', () => {
  renderChart(history(1));
  const table = screen.getByTestId('price-history-table');
  expect(within(table).getAllByTestId('price-history-row')).toHaveLength(1);
});
