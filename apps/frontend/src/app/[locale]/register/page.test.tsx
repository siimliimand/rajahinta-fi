/**
 * RegisterPage tests (task 3.1, change email-password-auth).
 *
 * Verifies the endpoint wiring:
 *   1. Renders the credential form with the password-policy hint.
 *   2. Submit → POST via registerAccount.
 *   3. 409 → duplicate-email message; 400 InvalidPassword → the policy
 *      message; 429 → the rate-limit message.
 *   4. Success → redirect to /account (the verification email is
 *      best-effort server-side and never blocks the redirect).
 *
 * @module RegisterPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RegisterPage from './page';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, registerAccount } from '@/lib/api';
import type { ApiError } from '@/lib/types';

const replaceMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    registerAccount: vi.fn(),
  };
});

const mockedRegister = vi.mocked(registerAccount);

/** Full ApiError body as the API emits it (ApiFetchError carries it). */
function apiError(status: number, error: string): ApiError {
  return {
    statusCode: status,
    message: error,
    error,
    timestamp: '2026-09-07T10:00:00.000Z',
    path: '/api/v1/account/register',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RegisterPage', () => {
  it('renders the form with the password-policy hint', () => {
    renderWithIntl(<RegisterPage />);

    expect(screen.getByLabelText('Sähköpostiosoite')).toBeInTheDocument();
    expect(screen.getByLabelText('Salasana')).toBeInTheDocument();
    expect(screen.getByText('Vähintään 12 ja enintään 128 merkkiä.')).toBeInTheDocument();
    expect(screen.getByTestId('register-submit')).toHaveTextContent('Luo tili');
    expect(screen.getByRole('link', { name: 'Kirjaudu sisään' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('submits the trimmed email and password via registerAccount', async () => {
    const user = userEvent.setup();
    mockedRegister.mockResolvedValue({
      userId: '11111111-2222-4333-8444-555555555555',
      expiresAt: '2026-09-27T00:00:00.000Z',
      verified: false,
    });

    renderWithIntl(<RegisterPage />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), ' kayttaja@example.fi ');
    await user.type(screen.getByLabelText('Salasana'), 'salasana-12-merkKIna');
    await user.click(screen.getByTestId('register-submit'));

    await waitFor(() =>
      expect(mockedRegister).toHaveBeenCalledWith(
        'kayttaja@example.fi',
        'salasana-12-merkKIna',
      ),
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/account'));
  });

  it('maps a 409 duplicate email to the duplicate message', async () => {
    const user = userEvent.setup();
    mockedRegister.mockRejectedValue(
      new ApiFetchError(409, apiError(409, 'EmailAlreadyRegistered')),
    );

    renderWithIntl(<RegisterPage />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), 'kayttaja@example.fi');
    await user.type(screen.getByLabelText('Salasana'), 'salasana-12-merkKIna');
    await user.click(screen.getByTestId('register-submit'));

    expect(await screen.findByTestId('register-failure')).toHaveTextContent(
      'Sähköpostiosoite on jo rekisteröity.',
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('maps a 400 InvalidPassword to the policy message', async () => {
    const user = userEvent.setup();
    mockedRegister.mockRejectedValue(
      new ApiFetchError(400, apiError(400, 'InvalidPassword')),
    );

    renderWithIntl(<RegisterPage />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), 'kayttaja@example.fi');
    await user.type(screen.getByLabelText('Salasana'), 'liianlyhyt');
    await user.click(screen.getByTestId('register-submit'));

    expect(await screen.findByTestId('register-failure')).toHaveTextContent(
      'Salasanan tulee olla 12–128 merkkiä pitkä.',
    );
  });

  it('shows the retry message on 429 rate limiting', async () => {
    const user = userEvent.setup();
    mockedRegister.mockRejectedValue(new ApiFetchError(429, null));

    renderWithIntl(<RegisterPage />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), 'kayttaja@example.fi');
    await user.type(screen.getByLabelText('Salasana'), 'salasana-12-merkKIna');
    await user.click(screen.getByTestId('register-submit'));

    expect(await screen.findByTestId('register-failure')).toHaveTextContent(
      'Liian monta yritystä.',
    );
  });
});
