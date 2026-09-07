/**
 * ForgotPasswordPage tests (task 3.1, change email-password-auth).
 *
 * Verifies the endpoint wiring:
 *   1. Submit → POST via requestPasswordReset with the trimmed email.
 *   2. The 202 renders the same "check your email" outcome regardless of
 *      account existence (no enumeration, design D2).
 *   3. 429 → the rate-limit message.
 *
 * @module ForgotPasswordPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from './page';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, requestPasswordReset } from '@/lib/api';

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    requestPasswordReset: vi.fn(),
  };
});

const mockedResetRequest = vi.mocked(requestPasswordReset);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForgotPasswordPage', () => {
  it('renders the request form', () => {
    renderWithIntl(<ForgotPasswordPage />);

    expect(screen.getByLabelText('Sähköpostiosoite')).toBeInTheDocument();
    expect(screen.getByTestId('forgot-submit')).toHaveTextContent(
      'Pyydä nollauslinkki',
    );
  });

  it('submits the trimmed email and renders the 202 outcome', async () => {
    const user = userEvent.setup();
    mockedResetRequest.mockResolvedValue({ accepted: true });

    renderWithIntl(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), ' kayttaja@example.fi ');
    await user.click(screen.getByTestId('forgot-submit'));

    await waitFor(() =>
      expect(mockedResetRequest).toHaveBeenCalledWith('kayttaja@example.fi'),
    );
    const accepted = await screen.findByTestId('forgot-accepted');
    // Same copy whether or not the account exists — the API cannot leak it.
    expect(accepted).toHaveTextContent('Jos osoite on rekisteröity');
    expect(
      screen.getByRole('link', { name: 'Takaisin kirjautumiseen' }),
    ).toHaveAttribute('href', '/login');
  });

  it('shows the retry message on 429 rate limiting', async () => {
    const user = userEvent.setup();
    mockedResetRequest.mockRejectedValue(new ApiFetchError(429, null));

    renderWithIntl(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), 'kayttaja@example.fi');
    await user.click(screen.getByTestId('forgot-submit'));

    expect(await screen.findByTestId('forgot-failure')).toHaveTextContent(
      'Liian monta yritystä.',
    );
  });
});
