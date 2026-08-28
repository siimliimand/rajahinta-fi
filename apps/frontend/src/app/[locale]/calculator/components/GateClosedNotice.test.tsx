/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GateClosedNotice, {
  isLaunchGateClosedError,
} from './GateClosedNotice';
import { ApiFetchError } from '@/lib/api';
import { renderWithIntl } from '@/lib/testing/test-intl';

function gateForbidden(message: string): ApiFetchError {
  return new ApiFetchError(403, {
    statusCode: 403,
    message,
    error: 'Forbidden',
    timestamp: '2026-08-28T12:00:00Z',
    path: '/api/v1/products',
  });
}

describe('isLaunchGateClosedError', () => {
  it('matches the LaunchGateGuard 403 rejections', () => {
    expect(
      isLaunchGateClosedError(
        gateForbidden(
          'Landed-cost calculations are not yet publicly available. ' +
            'All launch gates (legal opinion, tax-source mapping, correction mechanism) must be confirmed.',
        ),
      ),
    ).toBe(true);
    expect(
      isLaunchGateClosedError(
        gateForbidden(
          'Price data is not yet publicly available. ' +
            'All launch gates (legal opinion, tax-source mapping, correction mechanism) must be confirmed.',
        ),
      ),
    ).toBe(true);
  });

  it('does not match other 403s (age gate) or non-403 failures', () => {
    expect(
      isLaunchGateClosedError(gateForbidden('Age confirmation required')),
    ).toBe(false);
    expect(
      isLaunchGateClosedError(
        new ApiFetchError(429, {
          statusCode: 429,
          message: 'Rate limit exceeded',
          error: 'TooManyRequests',
          timestamp: '2026-08-28T12:00:00Z',
          path: '/api/v1/products',
        }),
      ),
    ).toBe(false);
    expect(isLaunchGateClosedError(new Error('network down'))).toBe(false);
    expect(isLaunchGateClosedError(null)).toBe(false);
  });
});

describe('GateClosedNotice', () => {
  it('renders the explanatory notice copy as a polite status region', () => {
    const { getByRole } = renderWithIntl(<GateClosedNotice />);

    const region = getByRole('status');
    expect(region).toHaveAttribute('data-testid', 'gate-closed-notice');
    expect(screen.getByText('Laskuri ei ole vielä käytössä')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Kokonaiskustannuslaskenta ei ole vielä julkisesti käytettävissä. ' +
          'Palvelua valmistellaan käyttöönottoon: oikeudellinen lausunto, verolähteiden kartoitus ja korjausmekanismi vahvistetaan ennen julkaisua.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Käyttöönoton jälkeen laskuri näyttää tuotteen kokonaiskustannuksen Suomeen/),
    ).toBeInTheDocument();
  });
});
