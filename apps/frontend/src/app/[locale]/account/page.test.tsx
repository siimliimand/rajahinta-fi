/**
 * AccountPage tests (task 3.1, change email-password-auth).
 *
 * Verifies the reworked session section:
 *   1. ensureSession 401 → redirect to /login (the anonymous bootstrap is
 *      gone — there is no signed-out render).
 *   2. Signed in → the server-derived email and the verified badge render.
 *   3. Unverified → the unverified badge (status semantics, not a lockout)
 *      and a working resend-verification action.
 *   4. Transport failure → the retry note, no redirect.
 *
 * @module AccountPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountPage from './page';
import { renderWithIntl } from '@/lib/testing/test-intl';
import {
  ApiFetchError,
  ensureSession,
  request,
  requestVerificationEmail,
} from '@/lib/api';
import type { ApiError, SessionStatus } from '@/lib/types';

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
    ensureSession: vi.fn(),
    request: vi.fn(),
    getCalculationResult: vi.fn(),
    requestVerificationEmail: vi.fn(),
    // The mounted sub-sections probe these on mount.
    listScenarios: vi.fn().mockResolvedValue([]),
    fetchProductsByIds: vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    }),
  };
});

const mockedEnsureSession = vi.mocked(ensureSession);
const mockedRequest = vi.mocked(request);
const mockedResend = vi.mocked(requestVerificationEmail);

function apiError(status: number, error: string): ApiError {
  return {
    statusCode: status,
    message: error,
    error,
    timestamp: '2026-09-07T10:00:00.000Z',
    path: '/api/v1/account/me',
  };
}

const SESSION: SessionStatus = {
  userId: '11111111-2222-4333-8444-555555555555',
  email: 'kayttaja@example.fi',
  verified: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequest.mockResolvedValue([]);
});

describe('AccountPage', () => {
  it('redirects to /login when ensureSession answers 401', async () => {
    mockedEnsureSession.mockRejectedValue(
      new ApiFetchError(401, apiError(401, 'SessionRequired')),
    );

    renderWithIntl(<AccountPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
    // No signed-in content and no signed-out panel exist — the redirect
    // is the only way forward (there is no loading/anonymous dead end
    // once the redirect resolves).
    expect(screen.queryByTestId('account-email')).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-unverified-badge')).not.toBeInTheDocument();
  });

  it('renders the email and the verified badge for a verified account', async () => {
    mockedEnsureSession.mockResolvedValue({ ...SESSION, verified: true });

    renderWithIntl(<AccountPage />);

    expect(await screen.findByTestId('account-email')).toHaveTextContent(
      'kayttaja@example.fi',
    );
    expect(screen.getByTestId('account-verified-badge')).toHaveTextContent(
      'Vahvistettu',
    );
    expect(screen.queryByTestId('account-unverified-badge')).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('renders the unverified badge and the resend action (status, not lockout)', async () => {
    const user = userEvent.setup();
    mockedEnsureSession.mockResolvedValue(SESSION);
    mockedResend.mockResolvedValue({ accepted: true });

    renderWithIntl(<AccountPage />);

    expect(await screen.findByTestId('account-unverified-badge')).toHaveTextContent(
      'Vahvistamatta',
    );
    // The feature sections still render — unverified is not a lockout.
    expect(screen.getByTestId('account-alerts-card')).toBeInTheDocument();

    await user.click(screen.getByTestId('account-resend-verification'));
    await waitFor(() => expect(mockedResend).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('account-resend-sent')).toBeInTheDocument();
  });

  it('surfaces a resend failure without leaving the page', async () => {
    const user = userEvent.setup();
    mockedEnsureSession.mockResolvedValue(SESSION);
    mockedResend.mockRejectedValue(new Error('network down'));

    renderWithIntl(<AccountPage />);

    await user.click(await screen.findByTestId('account-resend-verification'));
    expect(await screen.findByTestId('account-resend-failed')).toBeInTheDocument();
  });

  it('shows the retry note on a transport failure without redirecting', async () => {
    mockedEnsureSession.mockRejectedValue(new Error('network down'));

    renderWithIntl(<AccountPage />);

    expect(await screen.findByTestId('account-load-failed')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
