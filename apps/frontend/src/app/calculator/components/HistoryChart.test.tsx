/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HistoryChart from './HistoryChart';
import type {
  PriceHistoryAttribution,
  PriceHistoryPoint,
  ReliabilityStatus,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function point(
  date: string,
  overrides: Partial<PriceHistoryPoint> = {},
): PriceHistoryPoint {
  return {
    periodStart: date,
    openCents: 1000,
    closeCents: 1000,
    minCents: 950,
    maxCents: 1050,
    avgCents: 1000,
    observationCount: 2,
    reliability: 'VERIFIED',
    ...overrides,
  };
}

function taxAttribution(
  overrides: Partial<PriceHistoryAttribution> = {},
): PriceHistoryAttribution {
  return {
    merchant: 'Merchant A',
    classification: 'TAX_RULE_CHANGE',
    fromObservedAt: '2026-01-04T12:00:00Z',
    toObservedAt: '2026-01-05T12:00:00Z',
    movedInputs: {
      exciseRule: true,
      containerDutyRule: false,
      merchantPrice: false,
      transport: false,
    },
    exciseRuleBoundary: {
      fromVersionLabel: 'v2.0-2025',
      toVersionLabel: 'v3.0-2026',
    },
    containerDutyRuleBoundary: null,
    ...overrides,
  };
}

/** ISO date `i` days after 2026-01-01. */
function dayIso(i: number): string {
  return new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HistoryChart', () => {
  // ── Headings and accessibility ──
  it('renders the price metric heading and an accessible chart title', () => {
    render(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[
          { merchant: null, points: [point('2026-01-01'), point('2026-01-02')] },
        ]}
      />,
    );

    expect(screen.getByText('Foreign retail price · history')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Foreign retail price history chart/ }),
    ).toBeInTheDocument();
  });

  it('renders the landed-cost metric heading', () => {
    render(
      <HistoryChart
        metric="landed-cost"
        granularity="day"
        series={[{ merchant: null, points: [point('2026-01-01')] }]}
      />,
    );

    expect(screen.getByText('Landed cost · history')).toBeInTheDocument();
  });

  // ── Series rendering and neutrality ──
  it('renders one line per non-empty series on a shared scale', () => {
    const { container } = render(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[
          { merchant: null, points: [point('2026-01-01'), point('2026-01-02')] },
          { merchant: 'Merchant A', points: [] },
        ]}
      />,
    );

    const lines = container.querySelectorAll('[data-testid="series-line"]');
    expect(lines).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="series-legend"]')).toHaveLength(1);
    expect(screen.getByText('All merchants')).toBeInTheDocument();
  });

  it('assigns colours by sorted merchant name, not price, with equal stroke weight', () => {
    const { container } = render(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[
          // Merchant B is cheaper but must not get the first colour.
          {
            merchant: 'Merchant B',
            points: [
              point('2026-01-01', { avgCents: 500, minCents: 490, maxCents: 510 }),
              point('2026-01-02', { avgCents: 510, minCents: 500, maxCents: 520 }),
            ],
          },
          {
            merchant: 'Merchant A',
            points: [
              point('2026-01-01', { avgCents: 2000, minCents: 1990, maxCents: 2010 }),
              point('2026-01-02', { avgCents: 2010, minCents: 2000, maxCents: 2020 }),
            ],
          },
        ]}
      />,
    );

    const lines = container.querySelectorAll('[data-testid="series-line"]');
    expect(lines).toHaveLength(2);

    const groupOf = (el: Element) =>
      el.closest('g[data-testid="series-group"]')?.querySelector('title')
        ?.textContent;

    // Alphabetical order: Merchant A takes the first colour in the cycle.
    expect(groupOf(lines[0])).toBe('Merchant A — Foreign retail price');
    expect(groupOf(lines[1])).toBe('Merchant B — Foreign retail price');
    expect(lines[0].getAttribute('class')).toContain('stroke-primary-600');
    expect(lines[1].getAttribute('class')).toContain('stroke-emerald-600');

    // Equal treatment: identical stroke weight.
    expect(lines[0].getAttribute('stroke-width')).toBe(
      lines[1].getAttribute('stroke-width'),
    );
  });

  // ── Tax-change markers ──
  it('marks tax-rule boundaries with version labels and ignores non-tax steps', () => {
    const { container } = render(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[
          {
            merchant: 'Merchant A',
            points: [point('2026-01-01'), point('2026-01-05'), point('2026-01-06')],
          },
        ]}
        attribution={[
          taxAttribution(),
          taxAttribution({
            merchant: 'Merchant A',
            classification: 'MERCHANT_PRICE_CHANGE',
            movedInputs: {
              exciseRule: false,
              containerDutyRule: false,
              merchantPrice: true,
              transport: false,
            },
            exciseRuleBoundary: null,
          }),
        ]}
      />,
    );

    expect(container.querySelectorAll('[data-testid="tax-marker"]')).toHaveLength(1);
    expect(screen.getByText('v2.0-2025 → v3.0-2026')).toBeInTheDocument();
  });

  it('labels mixed changes from the container-duty boundary when excise is unset', () => {
    render(
      <HistoryChart
        metric="landed-cost"
        granularity="day"
        series={[{ merchant: null, points: [point('2026-01-01'), point('2026-01-05')] }]}
        attribution={[
          taxAttribution({
            classification: 'MIXED',
            movedInputs: {
              exciseRule: false,
              containerDutyRule: true,
              merchantPrice: true,
              transport: false,
            },
            exciseRuleBoundary: null,
            containerDutyRuleBoundary: {
              fromVersionLabel: 'c1.0',
              toVersionLabel: 'c2.0',
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('c1.0 → c2.0')).toBeInTheDocument();
    // Screen-reader evidence list carries the classification vocabulary.
    expect(screen.getByText(/Multiple changes on 5\.1\.2026/)).toBeInTheDocument();
  });

  // ── Reliability / freshness badges ──
  it('shows the strictest reliability badge and the latest bucket date', () => {
    render(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[
          {
            merchant: 'Merchant A',
            points: [
              point('2026-01-01', { reliability: 'VERIFIED' }),
              point('2026-01-02', { reliability: 'VERIFIED' }),
              point('2026-01-03', { reliability: 'STALE' }),
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.getByText('Latest 3.1.2026')).toBeInTheDocument();
  });

  it('uses the DESIGN.md colour coding for every reliability status', () => {
    const cases: ReadonlyArray<readonly [ReliabilityStatus, string, string]> = [
      ['VERIFIED', 'Verified', 'bg-green-100'],
      ['ESTIMATED', 'Estimated', 'bg-blue-100'],
      ['STALE', 'Stale', 'bg-amber-100'],
      ['UNAVAILABLE', 'Unavailable', 'bg-gray-100'],
    ];

    for (const [status, label, bg] of cases) {
      const { unmount } = render(
        <HistoryChart
          metric="price"
          granularity="day"
          series={[
            { merchant: 'Merchant A', points: [point('2026-01-01', { reliability: status })] },
          ]}
        />,
      );
      expect(screen.getByText(label)).toHaveClass(bg);
      unmount();
    }
  });

  // ── Edge cases ──
  it('renders an empty state without an SVG when no series has points', () => {
    const { container } = render(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[{ merchant: null, points: [] }]}
        earliestAvailableObservationDate="2026-02-01"
      />,
    );

    expect(
      screen.getByText('No history data available for the selected range.'),
    ).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('Data available from 1.2.2026')).toBeInTheDocument();
  });

  it('renders a single point as a dot, not a line', () => {
    const { container } = render(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[{ merchant: 'Merchant A', points: [point('2026-01-05')] }]}
      />,
    );

    expect(container.querySelectorAll('[data-testid="series-point"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="series-line"]')).toBeNull();
  });

  it('breaks the line across missing periods', () => {
    const { container } = render(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[
          {
            merchant: 'Merchant A',
            points: [
              point('2026-01-01'),
              point('2026-01-02'),
              point('2026-01-03'),
              point('2026-01-10'),
              point('2026-01-11'),
            ],
          },
        ]}
      />,
    );

    expect(container.querySelectorAll('[data-testid="series-line"]')).toHaveLength(2);
  });

  it('thins time-axis labels on very long ranges', () => {
    const { container } = render(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[
          {
            merchant: null,
            points: Array.from({ length: 120 }, (_, i) => point(dayIso(i))),
          },
        ]}
      />,
    );

    const ticks = container.querySelectorAll('[data-testid="axis-tick"]');
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(6);
  });

  it('states the earliest available observation date when data exists', () => {
    render(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[{ merchant: null, points: [point('2026-01-01'), point('2026-01-02')] }]}
        earliestAvailableObservationDate="2026-01-01"
      />,
    );

    expect(screen.getByText('Data available from 1.1.2026')).toBeInTheDocument();
  });
});
