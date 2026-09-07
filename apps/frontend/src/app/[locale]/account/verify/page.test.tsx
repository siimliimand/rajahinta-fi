/**
 * VerifyEmailPage tests (task 3.1, change email-password-auth).
 *
 * The page is the landing target of the emailed verification link
 * (`/account/verify?token=…`), so the tests steer the query string
 * through the jsdom URL and verify:
 *   1. Missing token → the missing-token message, no API call.
 *   2. Token → confirmEmailVerification consumes it; success renders the
 *      confirmation and the account link.
 *   3. Uniform 401 (invalid/expired/replayed) → the failure message.
 *
 * @module VerifyEmailPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VerifyEmailPage from './page';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ApiFetchError, confirmEmailVerification } from '@/lib/api';
import type { ApiError } from '@/lib/types';

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    confirmEmailVerification: vi.fn(),
  };
});

const mockedConfirm = vi.mocked(confirmEmailVerification);

/** Full ApiError body as the API emits it (ApiFetchError carries it). */
function apiError(status: number, error: string): ApiError {
  return {
    statusCode: status,
    message: error,
    error,
    timestamp: '2026-09-07T10:00:00.000Z',
    path: '/api/v1/account/verify-email/confirm',
  };
}

/** Steer the query string the emailed link would carry. */
function setQuery(query: string): void {
  window.history.replaceState(null, '', `/account/verify${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  setQuery('');
});

describe('VerifyEmailPage', () => {
  it('renders the missing-token message without calling the API', async () => {
    setQuery('');

    renderWithIntl(<VerifyEmailPage />);

    expect(await screen.findByTestId('verify-status')).toHaveTextContent(
      'Vahvistuslinkistä puuttuu tunnus.',
    );
    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  it('consumes the token and renders the confirmation with the email', async () => {
    setQuery('?token=abc123');
    mockedConfirm.mockResolvedValue({
      verified: true,
      userId: '11111111-2222-4333-8444-555555555555',
      email: 'kayttaja@example.fi',
    });

    renderWithIntl(<VerifyEmailPage />);

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith('abc123'));
    // The outcome swaps the DOM node carrying the testid — re-query.
    await waitFor(() =>
      expect(screen.getByTestId('verify-status')).toHaveTextContent(
        'Sähköpostiosoite vahvistettu',
      ),
    );
    expect(screen.getByTestId('verify-status')).toHaveTextContent(
      'kayttaja@example.fi',
    );
    expect(screen.getByRole('link', { name: 'Oma tili' })).toHaveAttribute(
      'href',
      '/account',
    );
  });

  it('renders the failure message on the uniform 401 token rejection', async () => {
    setQuery('?token=expired');
    mockedConfirm.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'InvalidToken')),
    );

    renderWithIntl(<VerifyEmailPage />);

    await waitFor(() =>
      expect(screen.getByTestId('verify-status')).toHaveTextContent(
        'Vahvistuslinkki on vanhentunut tai jo käytetty.',
      ),
    );
    expect(screen.getByRole('link', { name: 'Kirjaudu sisään' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('renders the generic failure on an unexpected error', async () => {
    setQuery('?token=abc123');
    mockedConfirm.mockRejectedValue(new Error('network down'));

    renderWithIntl(<VerifyEmailPage />);

    await waitFor(() =>
      expect(screen.getByTestId('verify-status')).toHaveTextContent(
        'Vahvistuksessa tapahtui virhe.',
      ),
    );
  });
});
