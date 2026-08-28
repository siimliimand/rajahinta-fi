/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HistoryChart from './HistoryChart';
import { renderWithIntl } from '@/lib/testing/test-intl';
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
    renderWithIntl(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[
          { merchant: null, points: [point('2026-01-01'), point('2026-01-02')] },
        ]}
      />,
    );

    expect(screen.getByText('Ulkomainen vähittäishinta · historia')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Historiakaavio: Ulkomainen vähittäishinta/ }),
    ).toBeInTheDocument();
  });

  it('renders the landed-cost metric heading', () => {
    renderWithIntl(
      <HistoryChart
        metric="landed-cost"
        granularity="day"
        series={[{ merchant: null, points: [point('2026-01-01')] }]}
      />,
    );

    expect(screen.getByText('Kokonaiskustannus · historia')).toBeInTheDocument();
  });

  // ── Series rendering and neutrality ──
  it('renders one line per non-empty series on a shared scale', () => {
    const { container } = renderWithIntl(
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
    expect(screen.getByText('Kaikki myyjät')).toBeInTheDocument();
  });

  it('assigns colours by sorted merchant name, not price, with equal stroke weight', () => {
    const { container } = renderWithIntl(
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
    expect(groupOf(lines[0])).toBe('Merchant A — Ulkomainen vähittäishinta');
    expect(groupOf(lines[1])).toBe('Merchant B — Ulkomainen vähittäishinta');
    expect(lines[0].getAttribute('class')).toContain('stroke-primary-600');
    expect(lines[1].getAttribute('class')).toContain('stroke-emerald-600');

    // Equal treatment: identical stroke weight.
    expect(lines[0].getAttribute('stroke-width')).toBe(
      lines[1].getAttribute('stroke-width'),
    );
  });

  // ── Tax-change markers ──
  it('marks tax-rule boundaries with version labels and ignores non-tax steps', () => {
    const { container } = renderWithIntl(
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
    renderWithIntl(
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
    // Screen-reader evidence list carries the classification vocabulary
    // (the SVG <title> carries it too; assert the sr-only copy directly).
    const srEvidence = screen
      .getAllByText(/Useita muutoksia.*5\.1\.2026/)
      .map((el) => el.closest('.sr-only'))
      .filter((el): el is HTMLElement => el !== null);
    expect(srEvidence.length).toBeGreaterThan(0);
  });

  // ── Reliability / freshness badges ──
  it('shows the strictest reliability badge and the latest bucket date', () => {
    renderWithIntl(
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

    expect(screen.getByText('Vanhentunut')).toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.getByText('Viimeisin 3.1.2026')).toBeInTheDocument();
  });

  it('uses the DESIGN.md colour coding for every reliability status', () => {
    // Canonical token classes from @/lib/design/status (D1/D2 ladder),
    // rendered by the ReliabilityBadge primitive.
    const cases: ReadonlyArray<readonly [ReliabilityStatus, string, string]> = [
      ['VERIFIED', 'Vahvistettu', 'bg-status-verified-bg'],
      ['ESTIMATED', 'Arvioitu', 'bg-status-estimated-bg'],
      ['STALE', 'Vanhentunut', 'bg-status-stale-bg'],
      ['UNAVAILABLE', 'Ei saatavilla', 'bg-status-unavailable-bg'],
    ];

    for (const [status, label, bg] of cases) {
      const { unmount } = renderWithIntl(
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
    const { container } = renderWithIntl(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[{ merchant: null, points: [] }]}
        earliestAvailableObservationDate="2026-02-01"
      />,
    );

    expect(
      screen.getByText('Historiatietoja ei ole saatavilla valitulle aikavälille.'),
    ).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('Tietoja saatavilla alkaen 1.2.2026')).toBeInTheDocument();
  });

  it('renders a single point as a dot, not a line', () => {
    const { container } = renderWithIntl(
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
    const { container } = renderWithIntl(
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
    const { container } = renderWithIntl(
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
    renderWithIntl(
      <HistoryChart
        metric="price"
        granularity="day"
        series={[{ merchant: null, points: [point('2026-01-01'), point('2026-01-02')] }]}
        earliestAvailableObservationDate="2026-01-01"
      />,
    );

    expect(screen.getByText('Tietoja saatavilla alkaen 1.1.2026')).toBeInTheDocument();
  });
});
