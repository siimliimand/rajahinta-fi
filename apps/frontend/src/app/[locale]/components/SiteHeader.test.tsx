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
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SiteHeader from './SiteHeader';
import { renderWithIntl } from '@/lib/testing/test-intl';
import { ensureSession, revokeSession } from '@/lib/api';
import type { SessionStatus } from '@/lib/types';

const replaceMock = vi.fn();

/** The pathname the mocked i18n navigation reports — set per test. */
let mockPathname = '/';

vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
  usePathname: () => mockPathname,
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
  mockPathname = '/';
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

describe('SiteHeader planning dropdown (task 3.2)', () => {
  async function renderHeader(): Promise<HTMLElement> {
    mockedEnsureSession.mockRejectedValue(new Error('401'));
    renderWithIntl(<SiteHeader />);
    await screen.findByTestId('header-sign-in');
    return screen.getByTestId('planning-dropdown-menu');
  }

  it('opens with Enter and lists the trip, event, and scenario destinations', async () => {
    const user = userEvent.setup();
    await renderHeader();
    const trigger = screen.getByTestId('planning-dropdown-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', 'site-header-planning-menu');

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const menu = screen.getByTestId('planning-dropdown-menu');
    const hrefs = within(menu)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['/trip', '/event', '/what-if']);
  });

  it('moves focus into the items with ArrowDown/ArrowUp and closes on Escape back to the trigger', async () => {
    const user = userEvent.setup();
    await renderHeader();
    const trigger = screen.getByTestId('planning-dropdown-trigger');

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = within(screen.getByTestId('planning-dropdown-menu')).getAllByRole(
      'link',
    );
    expect(document.activeElement).toBe(items[0]);

    await user.keyboard('{ArrowUp}');
    // Wrap: ArrowUp from the first item lands on the last.
    expect(document.activeElement).toBe(items[items.length - 1]);

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on tab-out', async () => {
    const user = userEvent.setup();
    await renderHeader();
    const trigger = screen.getByTestId('planning-dropdown-trigger');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Focus leaves the dropdown wrapper entirely.
    (screen.getByTestId('header-sign-in') as HTMLElement).focus();
    await waitFor(() =>
      expect(trigger).toHaveAttribute('aria-expanded', 'false'),
    );
  });

  it('marks the trigger active while a planning route is current', async () => {
    mockPathname = '/trip';
    await renderHeader();

    const trigger = screen.getByTestId('planning-dropdown-trigger');
    expect(trigger.className).toContain('font-semibold');
    const active = within(screen.getByTestId('planning-dropdown-menu'))
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') === '/trip');
    expect(active).toHaveAttribute('aria-current', 'page');
  });
});

describe('SiteHeader locale switcher (task 3.2)', () => {
  it('switches to EN preserving the current pathname', async () => {
    mockPathname = '/calculator';
    const user = userEvent.setup();
    mockedEnsureSession.mockRejectedValue(new Error('401'));
    renderWithIntl(<SiteHeader />);
    await screen.findByTestId('header-sign-in');

    await user.click(screen.getByTestId('locale-switch-en'));
    expect(replaceMock).toHaveBeenCalledWith('/calculator', { locale: 'en' });
  });

  it('switches back to FI on the same preserved path from an EN page', async () => {
    // The FI provider makes FI the active locale, so the FI switch only
    // acts from an EN context — mirrored here with the EN catalog.
    mockPathname = '/ranking';
    const user = userEvent.setup();
    mockedEnsureSession.mockRejectedValue(new Error('401'));
    render(
      <NextIntlClientProvider
        locale="en"
        messages={(await import('@/messages/en.json')).default}
      >
        <SiteHeader />
      </NextIntlClientProvider>,
    );
    await screen.findByTestId('header-sign-in');

    expect(screen.getByTestId('locale-switch-en')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await user.click(screen.getByTestId('locale-switch-fi'));
    expect(replaceMock).toHaveBeenCalledWith('/ranking', { locale: 'fi' });
  });

  it('marks the active locale for assistive tech, labelled as a group', () => {
    mockedEnsureSession.mockRejectedValue(new Error('401'));
    renderWithIntl(<SiteHeader />);

    const switcher = screen.getByTestId('locale-switcher');
    expect(switcher).toHaveAttribute('aria-label', 'Vaihda kieltä');
    expect(screen.getByTestId('locale-switch-fi')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByTestId('locale-switch-en')).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('exists for mobile users inside the mobile panel', () => {
    mockedEnsureSession.mockRejectedValue(new Error('401'));
    renderWithIntl(<SiteHeader />);

    expect(screen.getByTestId('locale-switcher-mobile')).toBeInTheDocument();
    expect(screen.getByTestId('locale-switch-fi-mobile')).toBeInTheDocument();
    expect(screen.getByTestId('locale-switch-en-mobile')).toBeInTheDocument();
  });
});
