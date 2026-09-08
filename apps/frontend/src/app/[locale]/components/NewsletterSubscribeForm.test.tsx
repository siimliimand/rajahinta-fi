/**
 * NewsletterSubscribeForm tests (task 5.4, change
 * trust-and-reach-roadmap).
 *
 * Verifies the consent discipline and endpoint wiring:
 *   1. Renders the form with explicit consent copy, separate from
 *      price alerts.
 *   2. Submit stays disabled without the consent checkbox and a
 *      non-empty address.
 *   3. Submit → POST /api/v1/newsletter/subscribe with the email and
 *      the active locale; the uniform 202 swaps the form for the
 *      "confirm by email" panel (no activated-subscription claim).
 *   4. 400 → the invalid-address message; 429 → the rate-limit message.
 *
 * @module NewsletterSubscribeFormTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewsletterSubscribeForm from './NewsletterSubscribeForm';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, subscribeToNewsletter } from '@/lib/api';
import type { ApiError } from '@/lib/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    subscribeToNewsletter: vi.fn(),
  };
});

const mockedSubscribe = vi.mocked(subscribeToNewsletter);

function apiError(status: number, message: string): ApiError {
  return {
    statusCode: status,
    message,
    error: 'Error',
    timestamp: '2026-09-08T10:00:00.000Z',
    path: '/api/v1/newsletter/subscribe',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSubscribe.mockResolvedValue({ status: 'PENDING' });
});

async function fillAndConsent(
  user: ReturnType<typeof userEvent.setup>,
  email = 'kiinnostunut@example.invalid',
) {
  await user.type(screen.getByLabelText('Sähköpostiosoite'), email);
  await user.click(screen.getByTestId('newsletter-consent'));
}

describe('NewsletterSubscribeForm', () => {
  it('renders the form with explicit consent copy separate from price alerts', () => {
    renderWithIntl(<NewsletterSubscribeForm />);

    expect(screen.getByTestId('newsletter-subscribe')).toHaveTextContent(
      'Uutiskirje',
    );
    expect(screen.getByLabelText('Sähköpostiosoite')).toBeInTheDocument();
    expect(screen.getByTestId('newsletter-consent')).toBeInTheDocument();
    // Explicit consent + the separation from price alerts, in copy.
    expect(
      screen.getByText(/hyväksyn, että sähköpostiosoitteeni tallennetaan/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/erillinen suostumus, joka ei liity hintaherätyksiin/),
    ).toBeInTheDocument();
  });

  it('keeps submit disabled without consent or an address, then subscribes', async () => {
    const user = userEvent.setup();
    renderWithIntl(<NewsletterSubscribeForm />);

    const submit = screen.getByRole('button', { name: 'Tilaa' });
    expect(submit).toBeDisabled();

    // Address alone is not consent.
    await user.type(screen.getByLabelText('Sähköpostiosoite'), 'henkilo@example.invalid');
    expect(submit).toBeDisabled();

    await user.click(screen.getByTestId('newsletter-consent'));
    expect(submit).toBeEnabled();

    await user.click(submit);

    await waitFor(() =>
      expect(mockedSubscribe).toHaveBeenCalledWith(
        'henkilo@example.invalid',
        'fi',
      ),
    );

    // The uniform 202 lands on the "confirm by email" panel — the
    // subscription is NOT claimed to be active.
    expect(
      await screen.findByText('Vahvista tilaus sähköpostista'),
    ).toBeInTheDocument();
    expect(screen.getByText(/tilaus aktivoituu vasta/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Tilaa' }),
    ).not.toBeInTheDocument();
  });

  it('maps a 400 to the invalid-address message and keeps the form', async () => {
    const user = userEvent.setup();
    mockedSubscribe.mockRejectedValue(
      new ApiFetchError(400, apiError(400, 'bad email')),
    );

    renderWithIntl(<NewsletterSubscribeForm />);
    await fillAndConsent(user);
    await user.click(screen.getByRole('button', { name: 'Tilaa' }));

    expect(
      await screen.findByText('Tarkista sähköpostiosoite.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Tilaa' }),
    ).toBeInTheDocument();
  });

  it('maps a 429 to the rate-limit message', async () => {
    const user = userEvent.setup();
    mockedSubscribe.mockRejectedValue(
      new ApiFetchError(429, apiError(429, 'slow down')),
    );

    renderWithIntl(<NewsletterSubscribeForm />);
    await fillAndConsent(user);
    await user.click(screen.getByRole('button', { name: 'Tilaa' }));

    expect(
      await screen.findByText('Liikaa yrityksiä — yritä hetken kuluttua uudelleen.'),
    ).toBeInTheDocument();
  });
});
