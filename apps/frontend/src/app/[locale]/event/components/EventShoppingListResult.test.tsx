/**
 * EventShoppingListResult disclaimer-render pins
 * (hedge-dedup-confidence-meter 3.2, design D1).
 *
 * Both result states render the response's structural disclaimer exactly
 * once — byte-level single occurrence, no heap. The event response
 * carries no result-confidence field, so the banner keeps the prominent
 * amber render by DisclaimerBanner's documented default (a confidence
 * that does not exist is never fabricated); the payload text is the
 * render source, never a UI-only string.
 *
 * @module EventShoppingListResultDisclaimerTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EventShoppingListResult from './EventShoppingListResult';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { EventCalcResponse } from '../event.types';

// ---------------------------------------------------------------------------
// Fixtures — the serialized 200 shape (event.types.ts mirrors)
// ---------------------------------------------------------------------------

const DISCLAIMER = {
  text: 'Kulutusnormit ovat arvioita, ei lopullisia määriä.',
  language: 'fi' as const,
  version: '1.0',
};

const COMPUTED: EventCalcResponse = {
  status: 'COMPUTED',
  eventDate: '2026-10-06',
  eventProfile: 'casual_gathering',
  guests: 10,
  durationHours: 4,
  normsVersion: 'standard-drink-fi-2026.1',
  lines: [
    {
      drinkType: 'beer',
      needMl: 1880,
      needLitres: 1.88,
      plannedUnits: [
        {
          sizeMl: 330,
          sizeLitres: 0.33,
          description: '0.33 l can',
          quantity: 6,
        },
      ],
      totalUnits: 6,
      purchasedMl: 1980,
      surplusMl: 100,
      surplusLitres: 0.1,
      versionLabel: 'standard-drink-fi-2026.1',
    },
  ],
  disclaimer: DISCLAIMER,
};

const NO_NORMS: EventCalcResponse = {
  status: 'NO_PUBLISHED_NORMS',
  eventDate: '2026-10-06',
  eventProfile: 'casual_gathering',
  guests: 10,
  durationHours: 4,
  disclaimer: DISCLAIMER,
};

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe('EventShoppingListResult disclaimer single render (hedge-dedup 3.2)', () => {
  it('renders the response disclaimer exactly once on the COMPUTED state', () => {
    const { container } = renderWithIntl(
      <EventShoppingListResult result={COMPUTED} />,
    );

    expect(screen.getAllByTestId('disclaimer-banner')).toHaveLength(1);
    expect(
      container.textContent.split(DISCLAIMER.text).length - 1,
    ).toBe(1);
  });

  it('renders the disclaimer exactly once on the NO_PUBLISHED_NORMS state too', () => {
    const { container } = renderWithIntl(
      <EventShoppingListResult result={NO_NORMS} />,
    );

    expect(screen.getAllByTestId('disclaimer-banner')).toHaveLength(1);
    expect(
      container.textContent.split(DISCLAIMER.text).length - 1,
    ).toBe(1);
  });

  it('keeps the amber banner when the response carries no confidence field', () => {
    renderWithIntl(<EventShoppingListResult result={COMPUTED} />);

    // No result confidence on the wire → the documented default keeps
    // the prominent render; nothing is fabricated.
    const banner = screen.getByTestId('disclaimer-banner');
    expect(banner.getAttribute('data-confidence')).toBe('LOW');
    expect(banner.className).toContain('status-stale');
    expect(within(banner).getByText(DISCLAIMER.text)).toBeInTheDocument();
    expect(banner.textContent).toContain('v1.0 · suomi');
  });
});
