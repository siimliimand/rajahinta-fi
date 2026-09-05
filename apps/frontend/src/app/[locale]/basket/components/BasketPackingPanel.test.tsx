/**
 * BasketPackingPanel tests (task 3.4).
 *
 * Verifies the flag-gated-by-response-shape contract:
 *   1. Absent `packing` section (flag off at the API) → renders nothing.
 *   2. COMPUTED suggestion → per-box grouping (box name, carrier, total
 *      weight), fill-rate bar with the rounded percentage, and items by
 *      product name + unit count. No ESTIMATED badge.
 *   3. ESTIMATED state → canonical "Arvioitu" badge, excluded products
 *      NAMED with quantity and reason (never a bare silent drop), and
 *      unknown product IDs degrade to `#id`.
 *   4. Mixing warning → the triggering figures (glass/can unit counts,
 *      combined weight) and every fired threshold; absent warning → no
 *      badge.
 *
 * @module BasketPackingPanelTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BasketPackingPanel from './BasketPackingPanel';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { PackingSuggestion } from '@/lib/basket.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NAMES = new Map([
  [101, 'Kahvi X'],
  [102, 'Olut Y'],
]);

function suggestion(
  overrides: Partial<PackingSuggestion> = {},
): PackingSuggestion {
  return {
    status: 'COMPUTED',
    boxes: [
      {
        boxTypeId: 7,
        carrier: 'postnord',
        boxName: 'PostNord Box M',
        items: [
          { productId: 101, units: 2 },
          { productId: 102, units: 1 },
        ],
        totalWeightG: 900,
        fillRate: 0.75,
      },
    ],
    excludedItems: [],
    mixingWarning: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Absent section (flag off at the API)
// ---------------------------------------------------------------------------

describe('BasketPackingPanel', () => {
  it('renders nothing when the packing section is absent', () => {
    const { container } = renderWithIntl(
      <BasketPackingPanel packing={undefined} productNames={NAMES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // -------------------------------------------------------------------------
  // COMPUTED — per-box grouping and fill visualization
  // -------------------------------------------------------------------------

  it('renders box grouping with name, carrier, total weight and fill bar', () => {
    renderWithIntl(
      <BasketPackingPanel packing={suggestion()} productNames={NAMES} />,
    );

    expect(screen.getByTestId('packing-panel')).toBeInTheDocument();
    expect(screen.getByText('PostNord Box M')).toBeInTheDocument();
    expect(screen.getByText('postnord')).toBeInTheDocument();
    expect(screen.getByText('900 g')).toBeInTheDocument();

    // Fill rate: fillRate 0.75 → 75 % on an accessible progressbar.
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByText('75 %')).toBeInTheDocument();

    // Per-box item grouping: product name + unit count.
    expect(screen.getByText('Kahvi X')).toBeInTheDocument();
    expect(screen.getByText('Olut Y')).toBeInTheDocument();
    expect(screen.getByText('2 kpl')).toBeInTheDocument();
    expect(screen.getByText('1 kpl')).toBeInTheDocument();
  });

  it('renders no ESTIMATED badge for a fully computed suggestion', () => {
    renderWithIntl(
      <BasketPackingPanel packing={suggestion()} productNames={NAMES} />,
    );
    expect(screen.queryByText('Arvioitu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('packing-excluded')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // ESTIMATED — excluded lines named, never silently dropped
  // -------------------------------------------------------------------------

  it('shows the ESTIMATED badge and names every excluded product with reason', () => {
    renderWithIntl(
      <BasketPackingPanel
        packing={suggestion({
          status: 'ESTIMATED',
          excludedItems: [
            { productId: 102, quantity: 3, reason: 'MISSING_DIMENSIONS' },
          ],
        })}
        productNames={NAMES}
      />,
    );

    expect(screen.getByText('Arvioitu')).toBeInTheDocument();
    expect(screen.getByText('Pakkaamatta jääneet tuotteet')).toBeInTheDocument();
    expect(
      screen.getByText('Olut Y · 3 kpl — mitat puuttuvat'),
    ).toBeInTheDocument();
  });

  it('degrades an unknown product ID to #id instead of an empty label', () => {
    renderWithIntl(
      <BasketPackingPanel
        packing={suggestion({
          status: 'ESTIMATED',
          excludedItems: [
            { productId: 999, quantity: 1, reason: 'NO_FITTING_BOX' },
          ],
        })}
        productNames={NAMES}
      />,
    );
    expect(
      screen.getByText('#999 · 1 kpl — ei sopivaa laatikkoa'),
    ).toBeInTheDocument();
  });

  it('treats excluded lines as ESTIMATED even if status were COMPUTED', () => {
    renderWithIntl(
      <BasketPackingPanel
        packing={suggestion({
          status: 'COMPUTED',
          excludedItems: [
            { productId: 101, quantity: 2, reason: 'INVALID_QUANTITY' },
          ],
        })}
        productNames={NAMES}
      />,
    );
    expect(screen.getByText('Arvioitu')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Mixing warning — triggering figures, or nothing
  // -------------------------------------------------------------------------

  it('shows the mixing warning with the triggering figures and thresholds', () => {
    renderWithIntl(
      <BasketPackingPanel
        packing={suggestion({
          mixingWarning: {
            glassUnits: 5,
            canUnits: 4,
            glassWeightG: 500,
            canWeightG: 250,
            combinedWeightG: 750,
            triggeredBy: ['UNIT_COUNT', 'COMBINED_WEIGHT'],
          },
        })}
        productNames={NAMES}
      />,
    );

    const warning = screen.getByTestId('mixing-warning');
    expect(warning).toHaveTextContent('Materiaalisekoitus ylittää raja-arvot');
    expect(warning).toHaveTextContent('Lasi: 5 kpl');
    expect(warning).toHaveTextContent('Tölkki: 4 kpl');
    expect(warning).toHaveTextContent('Yhteispaino: 750 g');
    expect(warning).toHaveTextContent(
      'Ylittyneet raja-arvot: yksikkömäärä, yhteispaino',
    );
  });

  it('renders no warning badge when the response omits the mixing warning', () => {
    renderWithIntl(
      <BasketPackingPanel packing={suggestion()} productNames={NAMES} />,
    );
    expect(screen.queryByTestId('mixing-warning')).not.toBeInTheDocument();
  });
});
