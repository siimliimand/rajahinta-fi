/**
 * ResultCard tests (price-intelligence-roadmap task 4.1).
 *
 * Pins the "Result presentation" contract of the change spec:
 *   1. Answer-first: the estimated landed cost is the prominent figure
 *      and renders before the detailed breakdown.
 *   2. The Finland comparison renders explicit "cheaper/dearer" text
 *      together with the signed figure — the direction is never conveyed
 *      by color alone.
 *   3. Breakdown rows mirror the fixture result object, figures and
 *      category labels verbatim.
 *   4. Reliability statuses render through `RELIABILITY_STATUS_META`
 *      labels (LocalizedReliabilityBadge pattern) with the calculation
 *      timestamp beside the price-data status.
 *   5. The structural disclaimer text rendered is the result object's
 *      own disclaimer field.
 *   6. A result without the Finland reference renders no comparison —
 *      no placeholder, no empty container.
 *
 * @module ResultCardTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ResultCard from './ResultCard';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type {
  CalculatorResult as CalculatorResultType,
  ReliabilityStatus,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid result — only the fields the card reads. */
function baseResult(): CalculatorResultType {
  return {
    itemizedCosts: [
      {
        label: 'Retail price',
        category: 'foreignRetailPrice',
        cents: 4000,
        reliability: 'VERIFIED',
      },
      {
        label: 'Transport',
        category: 'transportCost',
        cents: 500,
        reliability: 'STALE',
      },
      {
        label: 'Alcohol excise',
        category: 'alcoholExciseEstimate',
        cents: 650,
        reliability: 'ESTIMATED',
      },
    ],
    excludedOffers: [],
    foreignRetailPrice: 4000,
    transportCost: 500,
    alcoholExciseEstimate: 650,
    containerDutyEstimate: 0,
    totalCents: 5150,
    currency: 'EUR',
    confidence: 'MEDIUM',
    confidenceBreakdown: [],
    disclaimer: {
      text: 'Testirakennevastuuvapautus',
      language: 'fi',
      version: 'test',
    },
    classification: {
      classification: 'NotPersisted',
      confidence: 'LOW',
      evidence: [],
      evidenceSummary: 'Ei tallennettu',
    },
    metadata: {
      input: { productId: 1, quantity: 1, destination: 'FI' },
      calculationTimestamp: '2026-08-31T12:00:00.000Z',
      productMasterId: 1,
      retailOfferIds: [10],
      quantity: 1,
      destination: 'FI',
      productName: 'Testituote',
      volumeLitres: 0.5,
      alcoholByVolume: 5.5,
      category: 'beer',
      datasetVersions: [],
      transportOfferId: null,
    },
    calculationRecordId: 42,
  };
}

/** Benchmark shape as the API emits it — key present only when available. */
interface BenchmarkFixture {
  readonly referencePriceCents: number;
  readonly differenceCents: number;
  readonly differencePercent: number;
  readonly reliabilityStatus: ReliabilityStatus;
  readonly observedAt: string;
}

function resultWithBenchmark(
  benchmark: BenchmarkFixture,
): CalculatorResultType {
  return {
    ...baseResult(),
    alkoBenchmark: { status: 'available' as const, ...benchmark },
  } as CalculatorResultType;
}

/** The breakdown section heading, for order assertions. */
function breakdownHeading() {
  return screen.getByText('Kustannuserittely');
}

// ---------------------------------------------------------------------------
// Answer-first primary figure
// ---------------------------------------------------------------------------

describe('ResultCard answer-first total (task 4.1)', () => {
  it('renders the estimated landed cost as the prominent figure before the breakdown', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    const total = screen.getByTestId('landed-cost-total');
    expect(total).toBeVisible();
    // The figure is the result object's totalCents, verbatim.
    expect(total).toHaveTextContent('€51.50');
    // It carries the total label, so its origin is obvious.
    expect(screen.getByText('Yhteensä')).toBeInTheDocument();

    // Answer before breakdown: the total renders earlier in document
    // order than the breakdown heading, and the breakdown is not part
    // of the answer block.
    expect(
      total.compareDocumentPosition(breakdownHeading()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(breakdownHeading().contains(total)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Finland comparison — explicit cheaper/dearer text WITH the figure
// ---------------------------------------------------------------------------

describe('ResultCard Finland comparison (task 4.1)', () => {
  it('pairs the explicit cheaper statement with the signed figure', () => {
    renderWithIntl(
      <ResultCard
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: -450,
          differencePercent: -14.3,
          reliabilityStatus: 'VERIFIED',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const comparison = screen.getByTestId('finland-comparison');
    // Never color-alone: the direction is stated as text, not just tone.
    expect(
      within(comparison).getByText('Tuonti on edullisempaa'),
    ).toBeInTheDocument();
    // The figure rides with the statement, signed in euros and percent.
    expect(comparison.textContent).toContain('Alkon hinta: €31.50');
    expect(
      within(comparison).getByText('Ero: -€4.50 (-14.3 %)'),
    ).toBeInTheDocument();
    // Reference observation timestamp stays traceable.
    expect(comparison.textContent).toContain(
      `Havainto: ${new Date('2026-08-30T09:30:00.000Z').toLocaleString('fi-FI')}`,
    );

    // Comparison renders before the breakdown (spec scenario order).
    expect(
      screen
        .getByTestId('comparison-posture')
        .compareDocumentPosition(breakdownHeading()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('pairs the explicit dearer statement with the signed figure', () => {
    renderWithIntl(
      <ResultCard
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: 850,
          differencePercent: 27,
          reliabilityStatus: 'VERIFIED',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const comparison = screen.getByTestId('finland-comparison');
    expect(
      within(comparison).getByText('Alko on edullisempi'),
    ).toBeInTheDocument();
    expect(comparison.textContent).toContain('Ero: +€8.50 (+27.0 %)');
    expect(comparison.textContent).not.toContain('Tuonti on edullisempaa');
  });

  it('uses the equal-price statement at a zero difference', () => {
    renderWithIntl(
      <ResultCard
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: 0,
          differencePercent: 0,
          reliabilityStatus: 'STALE',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const comparison = screen.getByTestId('finland-comparison');
    expect(within(comparison).getByText('Hinta on sama')).toBeInTheDocument();
    expect(comparison.textContent).toContain('Ero: €0.00 (0.0 %)');
  });

  it('renders no comparison block when the result carries no Finland reference', () => {
    const { container } = renderWithIntl(<ResultCard result={baseResult()} />);

    expect(screen.queryByTestId('finland-comparison')).toBeNull();
    expect(container.textContent).not.toContain('Alko-vertailu');
    expect(container.textContent).not.toContain('Alkon hinta');
  });
});

// ---------------------------------------------------------------------------
// Breakdown beneath — rows mirror the result object
// ---------------------------------------------------------------------------

describe('ResultCard breakdown rows (task 4.1)', () => {
  it('renders one labeled row per itemized cost, figures verbatim', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    const rows = [
      { label: 'Ulkomainen vähittäishinta', amount: '€40.00' },
      { label: 'Kuljetuskustannus', amount: '€5.00' },
      { label: 'Arvio alkoholin valmisteverosta', amount: '€6.50' },
    ];
    for (const row of rows) {
      const label = screen.getByText(row.label);
      expect(label).toBeInTheDocument();
      // Each amount sits in the same row as its label — traceable.
      expect(label.closest('div')?.textContent).toContain(row.amount);
    }
  });

  it('renders per-line reliability badges through the status meta labels', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    // Fixture: retail VERIFIED, transport STALE, excise ESTIMATED. The
    // retail status legitimately renders twice — once on the answer's
    // price-reliability line, once on its breakdown row.
    expect(screen.getAllByText('Vahvistettu')).toHaveLength(2);
    expect(screen.getByText('Vanhentunut')).toBeInTheDocument();
    expect(screen.getByText('Arvioitu')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Price-data reliability + timestamp via RELIABILITY_STATUS_META
// ---------------------------------------------------------------------------

describe('ResultCard price-data reliability and timestamp (task 4.1)', () => {
  it('shows the retail-price reliability status with the calculation timestamp', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    const reliability = screen.getByTestId('price-reliability');
    // Label from RELIABILITY_STATUS_META.foreignRetailPrice-status
    // ('VERIFIED' → Common.reliability.VERIFIED), not an invented score.
    expect(within(reliability).getByText('Vahvistettu')).toBeInTheDocument();
    // Same locale formatting the component applies to the ISO timestamp.
    expect(reliability.textContent).toContain(
      `Laskettu ${new Date('2026-08-31T12:00:00.000Z').toLocaleString('fi-FI')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Structural disclaimer — consumed from the result object
// ---------------------------------------------------------------------------

describe('ResultCard disclaimer (task 4.1)', () => {
  it('renders the result object disclaimer text verbatim', () => {
    renderWithIntl(<ResultCard result={baseResult()} />);

    // The fixture's own disclaimer string appears; the card never
    // restates disclaimer copy as a UI string of its own.
    expect(screen.getByText('Testirakennevastuuvapautus')).toBeInTheDocument();
  });
});
