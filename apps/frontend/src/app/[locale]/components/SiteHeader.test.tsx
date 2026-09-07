/**
 * SiteHeader auth-awareness tests (task 3.1, change email-password-auth).
 *
 * The header's SSR payload always renders the signed-out actions; after
 * mount it probes `GET /account/me` and swaps the actions for logout on a
 * session. Verified here:
 *   1. Probe failure (signed-out / unreachable) → Kirjaudu + Rekisteröidy.
 *   2. Probe success → logout button replaces the links.
 *   3. Logout revokes the session and returns to the signed-out actions.
 *   4. The `auth:state-changed` event re-runs the probe (sign-in on a
 *      client-side navigation never remounts the header).
 *
 * @module SiteHeaderTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SiteHeader from './SiteHeader';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ensureSession, revokeSession } from '@/lib/api';
import type { SessionStatus } from '@/lib/types';

const replaceMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
  usePathname: () => '/',
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    ensureSession: vi.fn(),
    revokeSession: vi.fn(),
  };
});

const mockedEnsureSession = vi.mocked(ensureSession);
const mockedRevoke = vi.mocked(revokeSession);

const SESSION: SessionStatus = {
  userId: '11111111-2222-4333-8444-555555555555',
  email: 'kayttaja@example.fi',
  verified: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  // The nav destinations also render a plain /account link — keep the
  // assertions on the auth-action testids specific.
});

describe('SiteHeader auth actions', () => {
  it('renders the signed-out actions when the probe finds no session', async () => {
    mockedEnsureSession.mockRejectedValue(new Error('401'));

    renderWithIntl(<SiteHeader />);

    await waitFor(() => expect(mockedEnsureSession).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('header-sign-in')).toHaveTextContent('Kirjaudu');
    expect(screen.getByTestId('header-register')).toHaveTextContent('Rekisteröidy');
    expect(screen.getByTestId('header-sign-in')).toHaveAttribute('href', '/login');
    expect(screen.getByTestId('header-register')).toHaveAttribute('href', '/register');
    expect(screen.queryByTestId('header-sign-out')).not.toBeInTheDocument();
  });

  it('renders the logout action when a session exists', async () => {
    mockedEnsureSession.mockResolvedValue(SESSION);

    renderWithIntl(<SiteHeader />);

    await waitFor(() =>
      expect(screen.getByTestId('header-sign-out')).toHaveTextContent('Kirjaudu ulos'),
    );
    expect(screen.queryByTestId('header-sign-in')).not.toBeInTheDocument();
    expect(screen.queryByTestId('header-register')).not.toBeInTheDocument();
    // The account destination stays in the nav.
    expect(screen.getAllByRole('link', { name: 'Oma tili' }).length).toBeGreaterThan(0);
  });

  it('signs out, returns to the signed-out actions, and navigates home', async () => {
    const user = userEvent.setup();
    mockedEnsureSession.mockResolvedValue(SESSION);
    mockedRevoke.mockResolvedValue({ revoked: true });

    renderWithIntl(<SiteHeader />);
    await user.click(await screen.findByTestId('header-sign-out'));

    await waitFor(() => expect(mockedRevoke).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('header-sign-in')).toBeInTheDocument(),
    );
    expect(replaceMock).toHaveBeenCalledWith('/');
  });

  it('re-probes on the auth:state-changed event', async () => {
    mockedEnsureSession.mockRejectedValue(new Error('401'));

    renderWithIntl(<SiteHeader />);
    await waitFor(() => expect(mockedEnsureSession).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new CustomEvent('auth:state-changed'));
    await waitFor(() => expect(mockedEnsureSession).toHaveBeenCalledTimes(2));
  });

  it('the mobile panel carries the same signed-out actions', async () => {
    mockedEnsureSession.mockRejectedValue(new Error('401'));

    renderWithIntl(<SiteHeader />);

    expect(await screen.findByTestId('header-sign-in-mobile')).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.getByTestId('header-register-mobile')).toHaveAttribute(
      'href',
      '/register',
    );
  });
});
