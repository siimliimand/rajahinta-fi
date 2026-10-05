/**
 * TravellerAlternativeCallout tests (task 2.2, change
 * finnish-first-client-experience).
 *
 * Pins the callout contract:
 *   1. The estimate is clearly labeled as the trip calculator's
 *      allowance-bounded estimate with the allowance dataset version it
 *      resolves against — never a promise, never a cost line.
 *   2. `withinAllowance: false` says the figure covers only the
 *      allowance-bounded portion.
 *   3. "Kokeile matkalaskuria" links to /trip?product={id}&quantity={n}
 *      — the prefill handshake.
 *
 * @module TravellerAlternativeCalloutTest
 */
// @vitest-environment jsdom

import React from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TravellerAlternativeCallout from './TravellerAlternativeCallout';
import { renderWithIntl } from '@/lib/testing/test-intl';
import type { TravellerAlternative } from '@/lib/types';

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

function alternative(
  overrides: Partial<TravellerAlternative> = {},
): TravellerAlternative {
  return {
    estimatedTotalCents: 6800,
    withinAllowance: true,
    allowanceDatasetVersion: 'allowances-trip-2026.1',
    categoryKey: 'spirits',
    ...overrides,
  };
}

describe('TravellerAlternativeCallout', () => {
  it('renders the labeled within-allowance estimate with its dataset provenance', () => {
    renderWithIntl(
      <TravellerAlternativeCallout
        alternative={alternative()}
        productId={42}
        quantity={6}
      />,
    );

    const callout = screen.getByTestId('traveller-alternative');
    expect(
      within(callout).getByText('Matkalaskurin arvio'),
    ).toBeInTheDocument();
    expect(callout.textContent).toContain(
      'Yksi matkustaja, sama määrä — arvio yhteensä 68,00\u00a0€.',
    );
    expect(
      within(callout).getByText(
        'Matkustajamäärien tietoaineisto: allowances-trip-2026.1',
      ),
    ).toBeInTheDocument();
  });

  it('states the portion-only coverage when the quantity exceeds the caps', () => {
    renderWithIntl(
      <TravellerAlternativeCallout
        alternative={alternative({ withinAllowance: false })}
        productId={42}
        quantity={12}
      />,
    );

    const callout = screen.getByTestId('traveller-alternative');
    expect(callout.textContent).toContain(
      'Sama määrä ylittää yhden matkustajan määräajat — arvio yhteensä 68,00\u00a0€ kattaa vain sallitun määrän osuuden.',
    );
  });

  it('links to the trip page with the product and quantity as prefill params', () => {
    renderWithIntl(
      <TravellerAlternativeCallout
        alternative={alternative()}
        productId={42}
        quantity={6}
      />,
    );

    const link = screen.getByTestId('traveller-alternative-link');
    expect(link.getAttribute('href')).toBe('/trip?product=42&quantity=6');
    expect(link.textContent).toBe('Kokeile matkalaskuria');
  });

  it('renders the EN convention under an explicit en provider (2.4)', async () => {
    const { NextIntlClientProvider } = await import('next-intl');
    const { render } = await import('@testing-library/react');
    const { default: enMessages } = await import('@/messages/en.json');

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <TravellerAlternativeCallout
          alternative={alternative()}
          productId={42}
          quantity={6}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId('traveller-alternative').textContent).toContain(
      '€68.00',
    );
  });
});
