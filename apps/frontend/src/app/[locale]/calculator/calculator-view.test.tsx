/**
 * Calculator quick/advanced progressive disclosure — view-level tests
 * (price-intelligence-roadmap task 4.2).
 *
 * Pins the task's contract:
 *   1. Default state is quick only: the advanced options render behind an
 *      explicit control and stay collapsed (absent) until it is used.
 *   2. Parity: identical input values produce identical calculation
 *      requests and identical rendered results whether entered with the
 *      advanced section collapsed (quick path) or expanded (full path).
 *      The disclosure changes visibility only — one input state, one
 *      calculation pipeline.
 *
 * @module CalculatorViewProgressiveDisclosureTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalculatorView from './calculator-view';
import { searchProducts, calculateLandedCost, listScenarios } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type {
  CalculatorResult as CalculatorResultType,
  ProductSearchItem,
} from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    searchProducts: vi.fn(),
    calculateLandedCost: vi.fn(),
    listScenarios: vi.fn(),
    request: vi.fn(),
  };
});

// The merchant-warning notice renders through the i18n navigation Link;
// stub it with the plain-anchor shape every other page test uses.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

const mockedSearchProducts = vi.mocked(searchProducts);
const mockedCalculateLandedCost = vi.mocked(calculateLandedCost);
const mockedListScenarios = vi.mocked(listScenarios);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HIT: ProductSearchItem = {
  id: 42,
  name: 'Renat',
  brand: 'Sprit',
  category: 'Vodka',
  alcoholByVolume: 37.5,
  unitVolume: '0,7 l',
  containerType: 'BOTTLE',
  lowestPriceCents: 999,
  merchantCount: 1,
};

/** Minimal valid result — enough for the rendered answer-first figure. */
function baseResult(): CalculatorResultType {
  return {
    itemizedCosts: [
      {
        label: 'Retail price',
        category: 'foreignRetailPrice',
        cents: 4000,
        reliability: 'VERIFIED',
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
      input: { productId: 42, quantity: 2, destination: 'FI' },
      calculationTimestamp: '2026-08-31T12:00:00.000Z',
      productMasterId: 42,
      retailOfferIds: [10],
      quantity: 2,
      destination: 'FI',
      productName: 'Renat',
      volumeLitres: 0.7,
      alcoholByVolume: 37.5,
      category: 'Vodka',
      datasetVersions: [],
      transportOfferId: null,
    },
    calculationRecordId: 42,
  };
}

function searchResponse(items: ProductSearchItem[]) {
  return {
    items,
    total: items.length,
    page: 1,
    limit: 20,
    totalPages: items.length > 0 ? 1 : 0,
  };
}

/**
 * Enter the identical quick-path input set: search, select the hit,
 * destination Finland (default), quantity 2. When `expandAdvanced` is
 * set, the advanced section is disclosed after the product selection —
 * the inputs stay the same, only its visibility changes. Returns the
 * calculated request payload for parity comparison.
 */
async function runFlow(
  user: ReturnType<typeof userEvent.setup>,
  expandAdvanced = false,
): Promise<Record<string, unknown>> {
  await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
  await user.click(screen.getByRole('button', { name: 'Hae' }));
  const hit = await screen.findByText('Renat');
  await user.click(hit.closest('button') as HTMLButtonElement);

  if (expandAdvanced) {
    await user.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('calculator-advanced')).toBeInTheDocument();
  }

  // Quick-path quantity — same control serves both paths. The selector
  // ignores empty input while typing, so step it with its own control.
  await user.click(
    screen.getByRole('button', { name: 'Lisää määrää' }),
  );

  await user.click(
    screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
  );
  await screen.findByTestId('result-card');

  return JSON.parse(
    JSON.stringify(mockedCalculateLandedCost.mock.calls[0]![0]),
  ) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedListScenarios.mockResolvedValue([]);
  mockedSearchProducts.mockResolvedValue(searchResponse([HIT]));
  mockedCalculateLandedCost.mockResolvedValue(baseResult());
});

// ---------------------------------------------------------------------------
// 1. Default state — quick only
// ---------------------------------------------------------------------------

describe('CalculatorView quick/advanced default state (task 4.2)', () => {
  it('shows the quick path by default and keeps the advanced options collapsed', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    // Select a product so the quick-path configuration card is on screen.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    // Quick-path inputs are visible by default…
    expect(screen.getByTestId('calc-destination')).toBeInTheDocument();
    expect(screen.getByLabelText('Määrä')).toBeInTheDocument();
    expect(screen.getByTestId('observed-price')).toHaveTextContent('€9.99');

    // …while the advanced options exist behind an explicit control that
    // reports collapsed and keeps the section unrendered (quick only).
    const toggle = screen.getByTestId('advanced-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Lisäasetukset');
    expect(screen.queryByTestId('calculator-advanced')).toBeNull();
  });

  it('discloses the advanced options only through the explicit control', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    // Reach the quick-path configuration card.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    await user.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('advanced-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('calculator-advanced')).toBeInTheDocument();

    await user.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('advanced-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('calculator-advanced')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Parity — quick path ≡ full path for identical inputs
// ---------------------------------------------------------------------------

describe('CalculatorView quick/full-path parity (task 4.2)', () => {
  it('produces identical requests and identical results on both paths', async () => {
    const user = userEvent.setup();

    // ── Quick path: advanced stays collapsed ──
    const quick = renderWithIntl(<CalculatorView />);
    const quickPayload = await runFlow(user);
    const quickTotal = within(quick.container).getByTestId(
      'landed-cost-total',
    ).textContent;
    quick.unmount();

    // ── Full path: same inputs, advanced expanded ──
    const full = renderWithIntl(<CalculatorView />);
    const fullPayload = await runFlow(user, true);
    const fullTotal = within(full.container).getByTestId(
      'landed-cost-total',
    ).textContent;

    // Identical input values → identical request payload…
    expect(fullPayload).toEqual(quickPayload);
    expect(quickPayload).toEqual({
      productId: HIT.id,
      quantity: 2,
      destination: 'FI',
    });
    // …and identical rendered results (one pipeline, one result object).
    expect(fullTotal).toBe(quickTotal);
    expect(quickTotal).toBe('€51.50');
  });

  it('the advanced carrier override is the only payload difference, and only when set', async () => {
    const user = userEvent.setup();
    renderWithIntl(<CalculatorView />);

    // Reach the quick-path configuration card, expand advanced but leave
    // it untouched — the payload must stay identical to the quick path's.
    await user.type(screen.getByPlaceholderText('Hae tuotteita…'), 'renat');
    await user.click(screen.getByRole('button', { name: 'Hae' }));
    const hit = await screen.findByText('Renat');
    await user.click(hit.closest('button') as HTMLButtonElement);

    await user.click(screen.getByTestId('advanced-toggle'));
    await user.click(screen.getByRole('button', { name: 'Lisää määrää' }));
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );
    await screen.findByTestId('result-card');
    expect(mockedCalculateLandedCost.mock.calls[0]![0]).toEqual({
      productId: HIT.id,
      quantity: 2,
      destination: 'FI',
    });

    // Setting the carrier adds exactly that field.
    await user.type(screen.getByTestId('calc-transport-method'), 'Viking Line');
    await user.click(
      screen.getByRole('button', { name: 'Laske kokonaiskustannus' }),
    );
    await waitFor(() =>
      expect(mockedCalculateLandedCost).toHaveBeenCalledTimes(2),
    );
    expect(mockedCalculateLandedCost.mock.calls[1]![0]).toEqual({
      productId: HIT.id,
      quantity: 2,
      destination: 'FI',
      transportMethod: 'Viking Line',
    });
  });
});
