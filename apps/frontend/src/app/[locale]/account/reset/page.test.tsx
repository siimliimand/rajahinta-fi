/**
 * ResetPasswordPage tests (task 3.1, change email-password-auth).
 *
 * The page is the landing target of the emailed reset link
 * (`/account/reset?token=…`), so the tests steer the query string through
 * the jsdom URL and verify:
 *   1. Missing token → the missing-token message, form never renders.
 *   2. Token → resetPassword receives the token + new password.
 *   3. Success → the all-sessions-revoked note and the login link.
 *   4. Uniform 401 → the invalid-link message; 400 InvalidPassword → the
 *      policy message.
 *
 * @module ResetPasswordPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResetPasswordPage from './page';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, resetPassword } from '@/lib/api';
import type { ApiError } from '@/lib/types';

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    resetPassword: vi.fn(),
  };
});

const mockedReset = vi.mocked(resetPassword);

/** Full ApiError body as the API emits it (ApiFetchError carries it). */
function apiError(status: number, error: string): ApiError {
  return {
    statusCode: status,
    message: error,
    error,
    timestamp: '2026-09-07T10:00:00.000Z',
    path: '/api/v1/account/password/reset',
  };
}

/** Steer the query string the emailed link would carry. */
function setQuery(query: string): void {
  window.history.replaceState(null, '', `/account/reset${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  setQuery('');
});

describe('ResetPasswordPage', () => {
  it('renders the missing-token message without rendering the form', async () => {
    renderWithIntl(<ResetPasswordPage />);

    expect(await screen.findByTestId('reset-status')).toHaveTextContent(
      'Nollauslinkistä puuttuu tunnus.',
    );
    expect(screen.queryByTestId('reset-form')).not.toBeInTheDocument();
    expect(mockedReset).not.toHaveBeenCalled();
  });

  it('submits the token and the new password via resetPassword', async () => {
    setQuery('?token=abc123');
    mockedReset.mockResolvedValue({ reset: true });

    renderWithIntl(<ResetPasswordPage />);

    const form = await screen.findByTestId('reset-form');
    await userEvent.type(
      screen.getByLabelText('Uusi salasana'),
      'salasana-12-merkKIna',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Vaihda salasana' }));

    await waitFor(() =>
      expect(mockedReset).toHaveBeenCalledWith('abc123', 'salasana-12-merkKIna'),
    );
    const status = await screen.findByTestId('reset-status');
    await waitFor(() =>
      expect(status).toHaveTextContent('Kaikki istuntosi on kirjattu ulos.'),
    );
    expect(form).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kirjaudu sisään' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('renders the invalid-link message on the uniform 401 token rejection', async () => {
    setQuery('?token=expired');
    mockedReset.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'InvalidToken')),
    );

    renderWithIntl(<ResetPasswordPage />);

    await userEvent.type(
      await screen.findByLabelText('Uusi salasana'),
      'salasana-12-merkKIna',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Vaihda salasana' }));

    await waitFor(() =>
      expect(screen.getByText('Nollauslinkki on vanhentunut tai jo käytetty.')).toBeInTheDocument(),
    );
    // The form stays so the visitor can see what happened.
    expect(screen.getByTestId('reset-form')).toBeInTheDocument();
  });

  it('maps a 400 InvalidPassword to the policy message', async () => {
    setQuery('?token=abc123');
    mockedReset.mockRejectedValue(
      new ApiFetchError(400, apiError(400, 'InvalidPassword')),
    );

    renderWithIntl(<ResetPasswordPage />);

    await userEvent.type(
      await screen.findByLabelText('Uusi salasana'),
      'liianlyhyt',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Vaihda salasana' }));

    expect(
      await screen.findByText('Salasanan tulee olla 12–128 merkkiä pitkä.'),
    ).toBeInTheDocument();
  });
});
