/**
 * Trip break-even card — unit tests (price-intelligence-roadmap task
 * 4.4, design D5).
 *
 * Pins the card's contract:
 *   1. Positive saving: the derivation `(transport + other costs) ÷
 *      per-basket saving` is displayed WITH its input values — the
 *      echoed transport figure, the €0.00 other-costs gap slot, the
 *      per-basket saving with its per-line trace, and the basket count —
 *      plus the allowance hint linking /allowances.
 *   2. Zero saving: the card states the trip does not pay for itself
 *      instead of a meaningless quotient.
 *   3. Negative saving: same state (the card's contract covers a future
 *      basket composition; today's suggested-volume derivation cannot
 *      go below zero).
 *   4. The pure derivation: only BREAK_EVEN lines with a statable
 *      suggested volume contribute; the rest are reported as excluded,
 *      never invented.
 *
 * @module TripBreakEvenCardTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BreakEvenCard, {
  breakEvenBaskets,
  tripPerBasketSavingCents,
  type TripBasketSaving,
} from './BreakEvenCard';
import type { TripBreakEvenLine } from './trip.types';
import { renderWithIntl } from '@/lib/testing/test-intl';

// The allowance hint renders through the i18n navigation Link; stub it
// with the plain-anchor shape the calculator view tests use.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

// ---------------------------------------------------------------------------
// Fixtures — the same line shapes the trip page test uses
// ---------------------------------------------------------------------------

const LINES: readonly TripBreakEvenLine[] = [
  {
    status: 'BREAK_EVEN',
    category: 'beer',
    domesticPriceCentsPerLitre: 500,
    foreignPriceCentsPerLitre: 250,
    priceDifferenceCentsPerLitre: 250,
    breakEvenLitres: 60,
    capLitres: 110,
    capStatus: 'WITHIN_ALLOWANCE',
    cappedBreakEvenLitres: 60,
  },
  {
    status: 'BREAK_EVEN',
    category: 'wine_still',
    domesticPriceCentsPerLitre: 1000,
    foreignPriceCentsPerLitre: 800,
    priceDifferenceCentsPerLitre: 200,
    breakEvenLitres: 75,
    capLitres: 90,
    capStatus: 'CAPPED',
    cappedBreakEvenLitres: 90,
  },
  {
    status: 'NO_BREAK_EVEN',
    category: 'spirits',
    domesticPriceCentsPerLitre: 3800,
    foreignPriceCentsPerLitre: 4000,
    priceDifferenceCentsPerLitre: -200,
  },
  {
    status: 'BREAK_EVEN',
    category: 'wine_sparkling',
    domesticPriceCentsPerLitre: 1200,
    foreignPriceCentsPerLitre: 900,
    priceDifferenceCentsPerLitre: 300,
    breakEvenLitres: 50,
    capLitres: null,
    capStatus: 'NO_ALLOWANCE_ROW',
    cappedBreakEvenLitres: null,
  },
];

const MIXED_SAVING: TripBasketSaving = {
  totalCents: 60 * 250 + 90 * 200,
  contributions: [
    {
      category: 'beer',
      litres: 60,
      differenceCentsPerLitre: 250,
      savingCents: 15_000,
    },
    {
      category: 'wine_still',
      litres: 90,
      differenceCentsPerLitre: 200,
      savingCents: 18_000,
    },
  ],
  excludedCategories: ['wine_sparkling'],
};

const EMPTY_SAVING: TripBasketSaving = {
  totalCents: 0,
  contributions: [],
  excludedCategories: [],
};

// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

describe('tripPerBasketSavingCents (task 4.4)', () => {
  it('sums difference × suggested volume over the basket lines and reports the excluded', () => {
    const saving = tripPerBasketSavingCents(LINES);
    expect(saving.totalCents).toBe(33_000);
    expect(saving.contributions).toEqual(MIXED_SAVING.contributions);
    // The no-break-even and no-suggested-volume lines are excluded —
    // named, never invented into the total.
    expect(saving.excludedCategories).toEqual(['wine_sparkling']);
  });

  it('yields a zero total when no line carries a suggested volume', () => {
    const saving = tripPerBasketSavingCents([LINES[2]!, LINES[3]!]);
    expect(saving.totalCents).toBe(0);
    expect(saving.contributions).toEqual([]);
  });
});

describe('breakEvenBaskets (task 4.4)', () => {
  it('divides total costs by the per-basket saving, one decimal half-up', () => {
    expect(breakEvenBaskets(66_000, 33_000)).toBe(2);
    expect(breakEvenBaskets(20_000, 8_750)).toBe(2.3);
    expect(breakEvenBaskets(10_000, 3_000)).toBe(3.3);
  });

  it('returns null for zero and negative savings — no meaningful quotient', () => {
    expect(breakEvenBaskets(10_000, 0)).toBeNull();
    expect(breakEvenBaskets(10_000, -500)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rendered card
// ---------------------------------------------------------------------------

describe('BreakEvenCard positive saving (task 4.4)', () => {
  it('shows the formula with its input values, the per-line trace, and the allowance link', () => {
    renderWithIntl(
      <BreakEvenCard
        transportCostCents={66_000}
        basketSaving={MIXED_SAVING}
      />,
    );

    // Input values beside their labels — every number traceable.
    expect(screen.getByTestId('trip-break-even-transport')).toHaveTextContent(
      '€660.00',
    );
    expect(screen.getByTestId('trip-break-even-other')).toHaveTextContent(
      '€0.00',
    );
    expect(screen.getByTestId('trip-break-even-saving')).toHaveTextContent(
      '€330.00',
    );
    // The €0.00 other-costs slot says why it is zero (no source yet).
    expect(
      screen.getByText(
        'Lomake ei kerää muita matkakustannuksia — käytetään arvoa 0,00 €.',
      ),
    ).toBeInTheDocument();

    // The derivation itself, formula and inputs in one line.
    expect(screen.getByTestId('trip-break-even-baskets')).toHaveTextContent(
      '( €660.00 + €0.00 ) ÷ €330.00 = 2 koria',
    );

    // The per-line trace of the basket saving.
    expect(screen.getByText(/Olut: 60 l × €2\.50\/l = €150\.00/))
      .toBeInTheDocument();
    expect(screen.getByText(/Makuuviini: 90 l × €2\.00\/l = €180\.00/))
      .toBeInTheDocument();
    // The excluded category is named, not silently dropped.
    expect(
      screen.getByText(/Ei kuulu koriin.*Kuohuviini/),
    ).toBeInTheDocument();

    // The allowance hint links the real /allowances route.
    const link = screen.getByRole('link', { name: 'Katso määrärajat' });
    expect(link).toHaveAttribute('href', '/allowances');

    // The zero state is absent in the positive case.
    expect(screen.queryByTestId('trip-break-even-not-paying')).toBeNull();
  });
});

describe('BreakEvenCard zero saving (task 4.4)', () => {
  it('states the trip does not pay for itself instead of a quotient', () => {
    renderWithIntl(
      <BreakEvenCard transportCostCents={66_000} basketSaving={EMPTY_SAVING} />,
    );

    // The input values stay visible — including the €0.00 saving.
    expect(screen.getByTestId('trip-break-even-saving')).toHaveTextContent(
      '€0.00',
    );
    expect(screen.getByTestId('trip-break-even-not-paying'))
      .toHaveTextContent('Matka ei maksa itseään takaisin');
    expect(screen.queryByTestId('trip-break-even-baskets')).toBeNull();

    // The allowance hint remains reachable in the zero state.
    expect(screen.getByRole('link', { name: 'Katso määrärajat' }))
      .toHaveAttribute('href', '/allowances');
  });
});

describe('BreakEvenCard negative saving (task 4.4)', () => {
  it('states the trip does not pay for itself and never shows a negative quotient', () => {
    renderWithIntl(
      <BreakEvenCard
        transportCostCents={66_000}
        basketSaving={{
          totalCents: -500,
          contributions: [],
          excludedCategories: [],
        }}
      />,
    );

    expect(screen.getByTestId('trip-break-even-not-paying'))
      .toHaveTextContent('Matka ei maksa itseään takaisin');
    expect(screen.queryByTestId('trip-break-even-baskets')).toBeNull();
  });
});
