/**
 * CalculatorResult Alko benchmark line tests (task 4.3,
 * change drop-sweden-eur-only-alko-benchmark).
 *
 * Pins the web-application "Calculator UI" contract:
 *   1. A result carrying `alkoBenchmark` renders a factual line BELOW the
 *      itemized breakdown — reference price, signed difference in euros
 *      and percent, reliability badge, observation timestamp — visibly
 *      separate from the total row, with the plain statement for each
 *      price posture.
 *   2. A result without the field (no reference, or a pre-change record)
 *      renders nothing — no placeholder, no empty container.
 *
 * @module CalculatorResultTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CalculatorResult from './CalculatorResult';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type {
  CalculatorResult as CalculatorResultType,
  ReliabilityStatus,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid result — only the fields the component reads. */
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
        label: 'Alcohol excise',
        category: 'alcoholExciseEstimate',
        cents: 650,
        reliability: 'ESTIMATED',
      },
    ],
    excludedOffers: [],
    foreignRetailPrice: 4000,
    transportCost: 0,
    alcoholExciseEstimate: 650,
    containerDutyEstimate: 0,
    totalCents: 4650,
    currency: 'EUR',
    confidence: 'MEDIUM',
    confidenceBreakdown: [],
    disclaimer: { text: 'Testidisclaimer', language: 'fi', version: 'test' },
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

// ---------------------------------------------------------------------------
// Benchmark present → factual line below the breakdown
// ---------------------------------------------------------------------------

describe('CalculatorResult alkoBenchmark line (task 4.3)', () => {
  it('renders the factual benchmark line below the total when the field is present', () => {
    renderWithIntl(
      <CalculatorResult
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: 850,
          differencePercent: 27,
          reliabilityStatus: 'VERIFIED',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const line = screen.getByTestId('alko-benchmark');
    expect(line).toBeVisible();

    // Reference price reuses the view's EUR helper; difference is signed
    // in euros and percent at one decimal, matching the API's rounding.
    expect(line.textContent).toContain('Alkon hinta: €31.50');
    expect(line.textContent).toContain('Ero: +€8.50 (+27.0 %)');
    // Positive difference → the plain, non-recommendation statement.
    expect(line.textContent).toContain('Alko on edullisempi');
    // Self-consistent expected timestamp: the same locale formatting the
    // component applies to the ISO observation timestamp.
    expect(line.textContent).toContain(
      `Havainto: ${new Date('2026-08-30T09:30:00.000Z').toLocaleString('fi-FI')}`,
    );
    // The reference's own reliability badge rides on the line.
    expect(within(line).getByText('Vahvistettu')).toBeInTheDocument();

    // Below the itemized breakdown — after the total row, and never
    // inside it (display-only enrichment, not a cost component).
    const total = screen.getByText('Yhteensä');
    expect(
      total.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(line.contains(total)).toBe(false);
  });

  it('states plainly that importing is cheaper on a negative difference', () => {
    renderWithIntl(
      <CalculatorResult
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: -450,
          differencePercent: -14.3,
          reliabilityStatus: 'VERIFIED',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const line = screen.getByTestId('alko-benchmark');
    expect(line.textContent).toContain('Ero: -€4.50 (-14.3 %)');
    expect(line.textContent).toContain('Tuonti on edullisempaa');
    expect(line.textContent).not.toContain('Alko on edullisempi');
  });

  it('uses the equal-price statement at a zero difference', () => {
    renderWithIntl(
      <CalculatorResult
        result={resultWithBenchmark({
          referencePriceCents: 3150,
          differenceCents: 0,
          differencePercent: 0,
          reliabilityStatus: 'STALE',
          observedAt: '2026-08-30T09:30:00.000Z',
        })}
      />,
    );

    const line = screen.getByTestId('alko-benchmark');
    expect(line.textContent).toContain('Ero: €0.00 (0.0 %)');
    expect(line.textContent).toContain('Hinta on sama');
  });
});

// ---------------------------------------------------------------------------
// Benchmark absent → render nothing
// ---------------------------------------------------------------------------

describe('CalculatorResult without alkoBenchmark (pre-change records)', () => {
  it('renders no benchmark line, placeholder, or empty container', () => {
    const { container } = renderWithIntl(
      <CalculatorResult result={baseResult()} />,
    );

    expect(screen.queryByTestId('alko-benchmark')).toBeNull();
    expect(container.textContent).not.toContain('Alko-vertailu');
    expect(container.textContent).not.toContain('Alkon hinta');
  });

  it('still renders the unchanged breakdown and total', () => {
    renderWithIntl(<CalculatorResult result={baseResult()} />);

    expect(screen.getByText('Yhteensä')).toBeInTheDocument();
    expect(screen.getByText('€46.50')).toBeInTheDocument();
  });
});
