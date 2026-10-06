/**
 * TripBreakEvenResult disclaimer-render pins (hedge-dedup-confidence-meter
 * 3.2, design D1).
 *
 * The break-even view renders the response's structural disclaimer
 * exactly once — byte-level single occurrence, no heap. The trip
 * feasibility response carries no result-confidence field, so the banner
 * keeps the prominent amber render by DisclaimerBanner's documented
 * default (a confidence that does not exist is never fabricated); the
 * payload text is the render source, never a UI-only string.
 *
 * @module TripBreakEvenResultDisclaimerTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TripBreakEvenResult from './TripBreakEvenResult';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { TripFeasibilityResponse } from '../trip.types';

// ---------------------------------------------------------------------------
// Fixtures — the serialized 200 shape (trip.types.ts mirrors)
// ---------------------------------------------------------------------------

const DISCLAIMER = {
  text: 'Määrärajat ovat viranomaisen indikatiivisia rajoja.',
  language: 'fi' as const,
  version: '1.0',
};

const BREAK_EVEN_RESULT: TripFeasibilityResponse = {
  status: 'COMPUTED',
  travelDate: '2026-10-06',
  vehicleType: 'car',
  passengers: 2,
  ticketCostCents: 20000,
  fuelCostCents: 10000,
  travelCostCents: 30000,
  travelCostPerTravellerCents: 15000,
  allowanceDatasetVersion: 'allowances-trip-2026.1',
  lines: [
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
  ],
  disclaimer: DISCLAIMER,
  ferryOffers: [],
};

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe('TripBreakEvenResult disclaimer single render (hedge-dedup 3.2)', () => {
  it('renders the response disclaimer exactly once per view', () => {
    const { container } = renderWithIntl(
      <TripBreakEvenResult result={BREAK_EVEN_RESULT} />,
    );

    expect(screen.getAllByTestId('disclaimer-banner')).toHaveLength(1);
    expect(
      container.textContent.split(DISCLAIMER.text).length - 1,
    ).toBe(1);
  });

  it('keeps the amber banner when the response carries no confidence field', () => {
    renderWithIntl(<TripBreakEvenResult result={BREAK_EVEN_RESULT} />);

    // No result confidence on the wire → the documented default keeps
    // the prominent render; nothing is fabricated.
    const banner = screen.getByTestId('disclaimer-banner');
    expect(banner.getAttribute('data-confidence')).toBe('LOW');
    expect(banner.className).toContain('status-stale');
    expect(within(banner).getByText(DISCLAIMER.text)).toBeInTheDocument();
    expect(banner.textContent).toContain('v1.0 · suomi');
  });
});
