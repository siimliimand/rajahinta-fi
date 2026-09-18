/**
 * Basket view summary tests — Finland reference total (task 4.8 addendum).
 *
 * Pins the sticky-summary contract at the view level:
 *   1. An available reference renders the Finland total and the explicit
 *      cheaper/dearer wording WITH the figure (never color alone).
 *   2. Equal totals render the same-price wording.
 *   3. Lines without a Finland reference are named as excluded — the
 *      partial total never reads as complete.
 *   4. No references at all render an explicit unavailable note, never
 *      a zero.
 *   5. A result without the field (pre-4.8 idempotency cache) renders
 *      nothing for the Finland section.
 *
 * The builder and results children are stubbed: they predate the repo's
 * React-namespace-import convention and cannot render under vitest's
 * classic-JSX transform (page.test.tsx precedent). This file exercises
 * the view's own flow — add item → optimize → summary.
 *
 * @module BasketViewSummaryTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import BasketView from './basket-view';
import type { BasketOptimizationResult } from '@/lib/basket.types';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { optimizeBasket } from '@/lib/basket.client';

// The optimize call is mocked per test with a fixture result.
vi.mock('@/lib/basket.client', async () => {
  const actual = (await vi.importActual('@/lib/basket.client')) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    optimizeBasket: vi.fn(),
  };
});

// Stub children (classic-JSX transform rationale in the file docblock).
vi.mock('./components/BasketBuilder', async () => {
  const React = await import('react');
  return {
    default: (props: { onAddItem?: (productId: number, productName: string) => void }) =>
      React.createElement(
        'button',
        {
          'data-testid': 'basket-builder-stub-add',
          type: 'button',
          onClick: () => props.onAddItem?.(101, 'Test Product'),
        },
        'stub-add',
      ),
  };
});

vi.mock('./components/BasketResults', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { 'data-testid': 'basket-results-stub' }),
  };
});

const mockedOptimize = vi.mocked(optimizeBasket);

function makeResult(
  overrides: Partial<BasketOptimizationResult>,
): BasketOptimizationResult {
  return {
    shipments: [],
    totalCents: 5000,
    itemizedTotals: 4000,
    confidence: 'HIGH',
    confidenceBreakdown: [],
    disclaimer: { text: 'x', language: 'fi', version: '1.0' },
    alternatives: [],
    metadata: {
      input: { items: [{ productId: 101, quantity: 1 }], destination: 'FI' },
      calculationTimestamp: '2026-09-17T12:00:00.000Z',
      datasetVersions: [],
      calculationRecordId: null,
    },
    ...overrides,
  } as BasketOptimizationResult;
}

async function renderAndOptimize(result: BasketOptimizationResult) {
  mockedOptimize.mockResolvedValue(result);
  renderWithIntl(<BasketView />);
  fireEvent.click(screen.getByTestId('basket-builder-stub-add'));
  fireEvent.click(screen.getByText('Optimoi ostoskori'));
  await screen.findByTestId('basket-summary');
}

describe('BasketView summary — Finland reference total (task 4.8)', () => {
  beforeEach(() => {
    mockedOptimize.mockReset();
  });

  it('renders the Finland total and the cheaper difference with the figure', async () => {
    await renderAndOptimize(
      makeResult({
        // Cross-border total 40 € against a 45 € Finland reference —
        // the basket is the cheaper side here.
        totalCents: 4000,
        itemizedTotals: 3000,
        finlandReference: {
          status: 'available',
          totalCents: 4500,
          lines: [
            {
              productId: 101,
              quantity: 1,
              referenceUnitPriceCents: 4500,
              lineReferenceCents: 4500,
              referenceOfferId: 210,
              referenceObservedAt: '2026-09-01T06:00:00.000Z',
              referenceReliability: 'VERIFIED',
            },
          ],
          missingLines: [],
        },
      }),
    );

    expect(screen.getByTestId('basket-summary-finland-total')).toHaveTextContent(
      '€45.00',
    );
    const difference = screen.getByTestId('basket-summary-finland-difference');
    // Explicit cheaper wording WITH the figure (never color alone).
    expect(difference).toHaveTextContent('edullisempi kuin Suomessa');
    expect(difference).toHaveTextContent('€5.00');
  });

  it('renders the dearer difference when the basket is more expensive than Finland', async () => {
    await renderAndOptimize(
      makeResult({
        totalCents: 6000,
        finlandReference: {
          status: 'available',
          totalCents: 4000,
          lines: [
            {
              productId: 101,
              quantity: 1,
              referenceUnitPriceCents: 4000,
              lineReferenceCents: 4000,
              referenceOfferId: 210,
              referenceObservedAt: '2026-09-01T06:00:00.000Z',
              referenceReliability: 'VERIFIED',
            },
          ],
          missingLines: [],
        },
      }),
    );

    const difference = screen.getByTestId('basket-summary-finland-difference');
    expect(difference).toHaveTextContent('kalliimpi kuin Suomessa');
    expect(difference).toHaveTextContent('€20.00');
  });

  it('renders the same-price wording when the totals match', async () => {
    await renderAndOptimize(
      makeResult({
        totalCents: 4500,
        itemizedTotals: 4500,
        finlandReference: {
          status: 'available',
          totalCents: 4500,
          lines: [
            {
              productId: 101,
              quantity: 1,
              referenceUnitPriceCents: 4500,
              lineReferenceCents: 4500,
              referenceOfferId: 210,
              referenceObservedAt: '2026-09-01T06:00:00.000Z',
              referenceReliability: 'VERIFIED',
            },
          ],
          missingLines: [],
        },
      }),
    );

    expect(screen.getByTestId('basket-summary-finland-difference')).toHaveTextContent(
      'Sama hinta kuin Suomessa',
    );
  });

  it('names the lines excluded from a partial reference total', async () => {
    await renderAndOptimize(
      makeResult({
        finlandReference: {
          status: 'available',
          totalCents: 4500,
          lines: [
            {
              productId: 101,
              quantity: 1,
              referenceUnitPriceCents: 4500,
              lineReferenceCents: 4500,
              referenceOfferId: 210,
              referenceObservedAt: '2026-09-01T06:00:00.000Z',
              referenceReliability: 'VERIFIED',
            },
          ],
          missingLines: [
            { productId: 102, quantity: 2 },
            { productId: 103, quantity: 1 },
          ],
        },
      }),
    );

    expect(
      screen.getByTestId('basket-summary-finland-missing-lines'),
    ).toHaveTextContent('Jättää pois 2 tuotetta');
  });

  it('renders an explicit unavailable note — never a zero — when no line has a reference', async () => {
    await renderAndOptimize(
      makeResult({
        finlandReference: {
          status: 'unavailable',
          reason: 'NO_REFERENCE_PRICES',
          lines: [],
          missingLines: [{ productId: 101, quantity: 1 }],
        },
      }),
    );

    expect(
      screen.getByTestId('basket-summary-finland-unavailable'),
    ).toHaveTextContent(
      'Suomen vertailuhinta ei saatavilla: tuotteilla ei ole vertailuhintoja',
    );
    expect(
      screen.queryByTestId('basket-summary-finland-total'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing for the Finland section when the result predates the field', async () => {
    // Pre-4.8 idempotency-cache payload: no `finlandReference` key at all.
    await renderAndOptimize(makeResult({}));

    expect(
      screen.queryByTestId('basket-summary-finland-total'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('basket-summary-finland-unavailable'),
    ).not.toBeInTheDocument();
  });
});
