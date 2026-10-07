/**
 * TripFillResult disclaimer-render pins (hedge-dedup-confidence-meter
 * 3.2, design D1).
 *
 * The fill view renders the response's structural disclaimer exactly
 * once — byte-level single occurrence, no heap. The trip fill response
 * carries no result-confidence field, so the banner keeps the prominent
 * amber render by DisclaimerBanner's documented default (a confidence
 * that does not exist is never fabricated); the payload text is the
 * render source, never a UI-only string.
 *
 * @module TripFillResultDisclaimerTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TripFillResult from './TripFillResult';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { TripFillResponse } from '../trip.types';

// The empirical-margin meter (hedge-dedup-confidence-meter 4.1) renders
// its /ranking link through the i18n navigation Link; stub it with the
// plain-anchor shape the other view tests use.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

// ---------------------------------------------------------------------------
// Fixtures — the serialized 200 shape (trip.types.ts mirrors)
// ---------------------------------------------------------------------------

const DISCLAIMER = {
  text: 'Määrärajat ovat viranomaisen indikatiivisia rajoja.',
  language: 'fi' as const,
  version: '1.0',
};

const FILL_RESULT: TripFillResponse = {
  status: 'FILLED',
  travelDate: '2026-10-06',
  allowanceDatasetVersion: 'allowances-trip-2026.1',
  filledValueCents: 3600,
  filledUnits: 24,
  lines: [
    {
      productId: 42,
      category: 'beer',
      merchant: 'Tallinna Kauppa',
      unitPriceCents: 150,
      unitVolumeLitres: 0.5,
      maxQuantity: 24,
      filledQuantity: 24,
      valueContributionCents: 3600,
      consumedVolumeLitres: 12,
      status: 'FILLED',
      headroomAfter: {
        category: 'beer',
        capLitres: 110,
        capUnits: null,
        remainingLitres: 98,
        remainingUnits: null,
      },
    },
  ],
  categoryHeadroom: [
    {
      category: 'beer',
      capLitres: 110,
      capUnits: null,
      usedLitres: 12,
      usedUnits: 24,
      remainingLitres: 98,
      remainingUnits: null,
    },
  ],
  disclaimer: DISCLAIMER,
  ferryOffers: [],
};

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe('TripFillResult disclaimer single render (hedge-dedup 3.2)', () => {
  it('renders the response disclaimer exactly once per view', () => {
    const { container } = renderWithIntl(
      <TripFillResult result={FILL_RESULT} productNames={new Map([[42, 'Saku Originaal']])} />,
    );

    expect(screen.getAllByTestId('disclaimer-banner')).toHaveLength(1);
    expect(
      container.textContent.split(DISCLAIMER.text).length - 1,
    ).toBe(1);
  });

  it('keeps the amber banner when the response carries no confidence field', () => {
    renderWithIntl(
      <TripFillResult result={FILL_RESULT} productNames={new Map([[42, 'Saku Originaal']])} />,
    );

    // No result confidence on the wire → the documented default keeps
    // the prominent render; nothing is fabricated.
    const banner = screen.getByTestId('disclaimer-banner');
    expect(banner.getAttribute('data-confidence')).toBe('LOW');
    expect(banner.className).toContain('status-stale');
    expect(within(banner).getByText(DISCLAIMER.text)).toBeInTheDocument();
    expect(banner.textContent).toContain('v1.0 · suomi');
  });
});

// ---------------------------------------------------------------------------
// Empirical-margin meter (hedge-dedup-confidence-meter 4.1, design D4):
// display-only ± figure beside the filled-value total; the margin rides
// the fill response only (the feasibility path carries none), and an
// absent margin renders nothing.
// ---------------------------------------------------------------------------

describe('TripFillResult empirical-margin meter (hedge-dedup 4.1)', () => {
  const MARGIN = {
    quantile: 0.05,
    sampleCount: 16,
    cell: { dimension: 'global', key: 'global' },
    asOf: '2026-09-28T12:00:00.000Z',
  } as const;

  it('renders the ± figure for the filled value when the response carries a margin', () => {
    renderWithIntl(
      <TripFillResult
        result={{ ...FILL_RESULT, empiricalMargin: MARGIN }}
        productNames={new Map([[42, 'Saku Originaal']])}
      />,
    );

    const meter = screen.getByTestId('confidence-meter');
    // 0.05 × 3600 ¢ = 180 ¢ → "±1,80 €" (fi money form).
    expect(meter.textContent).toContain('±1,80\u00a0€');
    // The basis is adjacent, never dropped.
    expect(meter.textContent).toContain('±5,0 %');
    expect(meter.textContent).toContain('n=16');
    expect(within(meter).getByRole('link').getAttribute('href')).toBe(
      '/ranking',
    );
  });

  it('renders nothing when the margin is absent', () => {
    renderWithIntl(
      <TripFillResult
        result={FILL_RESULT}
        productNames={new Map([[42, 'Saku Originaal']])}
      />,
    );
    expect(screen.queryByTestId('confidence-meter')).toBeNull();
  });
});
