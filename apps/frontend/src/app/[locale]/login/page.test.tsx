/**
 * LoginPage tests (task 3.1, change email-password-auth).
 *
 * Verifies the endpoint wiring:
 *   1. Renders the credential form.
 *   2. Submit → POST via loginAccount with the trimmed email.
 *   3. Uniform 401 → the no-enumeration credentials message.
 *   4. 429 → the AUTH rate-limit message.
 *   5. Success → redirect to /account.
 *
 * @module LoginPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, loginAccount } from '@/lib/api';
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
    loginAccount: vi.fn(),
  };
});

const mockedLogin = vi.mocked(loginAccount);

/** Full ApiError body as the API emits it (ApiFetchError carries it). */
function apiError(status: number, error: string): ApiError {
  return {
    statusCode: status,
    message: error,
    error,
    timestamp: '2026-09-07T10:00:00.000Z',
    path: '/api/v1/account/login',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('renders the credential form', () => {
    renderWithIntl(<LoginPage />);

    expect(screen.getByLabelText('Sähköpostiosoite')).toBeInTheDocument();
    expect(screen.getByLabelText('Salasana')).toBeInTheDocument();
    expect(screen.getByTestId('login-submit')).toHaveTextContent('Kirjaudu');
    expect(screen.getByRole('link', { name: 'Unohditko salasanan?' })).toHaveAttribute(
      'href',
      '/account/forgot',
    );
    expect(screen.getByRole('link', { name: 'Luo tili' })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('submits the trimmed email and password via loginAccount', async () => {
    const user = userEvent.setup();
    mockedLogin.mockResolvedValue({
      userId: '11111111-2222-4333-8444-555555555555',
      expiresAt: '2026-09-27T00:00:00.000Z',
      verified: false,
    });

    renderWithIntl(<LoginPage />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), ' kayttaja@example.fi ');
    await user.type(screen.getByLabelText('Salasana'), 'salasana-12-merkKIna');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(mockedLogin).toHaveBeenCalledWith(
        'kayttaja@example.fi',
        'salasana-12-merkKIna',
      ),
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/account'));
  });

  it('shows the uniform credentials message on 401 (no enumeration)', async () => {
    const user = userEvent.setup();
    mockedLogin.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'InvalidCredentials')),
    );

    renderWithIntl(<LoginPage />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), 'kayttaja@example.fi');
    await user.type(screen.getByLabelText('Salasana'), 'vasara');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-failure')).toHaveTextContent(
      'Virheellinen sähköposti tai salasana.',
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('shows the retry message on 429 rate limiting', async () => {
    const user = userEvent.setup();
    mockedLogin.mockRejectedValue(new ApiFetchError(429, null));

    renderWithIntl(<LoginPage />);

    await user.type(screen.getByLabelText('Sähköpostiosoite'), 'kayttaja@example.fi');
    await user.type(screen.getByLabelText('Salasana'), 'salasana-12-merkKIna');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-failure')).toHaveTextContent(
      'Liian monta yritystä.',
    );
  });
});
