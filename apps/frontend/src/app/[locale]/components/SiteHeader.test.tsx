/**
 * SiteHeader tests (task 3.1, change three-task-navigation).
 *
 * The header renders three task-based disclosure groups — shopping,
 * trip, event — all instantiated from one `NavDisclosureGroup`, plus
 * the auth actions and the locale switcher. Verified here:
 *   1. Structure: exactly three desktop triggers with task-language
 *      labels; every tool link sits inside a group panel, none flat in
 *      the header; the demoted scenario and ranking tools are absent.
 *   2. Panel membership: each opened panel lists exactly its group's
 *      tool hrefs.
 *   3. Keyboard: Enter/Space toggle, ArrowDown/ArrowUp enter at the
 *      first/last item and cycle both ways, Escape closes back to the
 *      trigger, tab-out closes — for every group.
 *   4. Active propagation: /calculator distinguishes the shopping
 *      trigger and marks the calculator item `aria-current`; a deeper
 *      child route keeps the group active; the account area still
 *      lights up no group.
 *   5. Account chrome (reopened scope): "Oma tili" stays as chrome in
 *      both navs and both auth states — desktop chrome and the mobile
 *      bottom row — and carries the chrome-link active treatment
 *      (border/semibold + `aria-current`) only on /account routes.
 *   5. Mobile: the mobile panel presents the same three groups with
 *      `-mobile` testids and operable disclosures.
 *   6. Auth: the SSR probe swap (signed-out ↔ logout) and the
 *      `auth:state-changed` re-probe keep working unchanged.
 *
 * Both navs (desktop row and mobile panel) are always in the DOM —
 * closed panels are `display: none` — so panel-scoped queries go
 * through the per-group menu testids, never by role alone.
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

/**
 * The three task groups with their FI trigger labels (source-of-truth
 * catalog) and panel hrefs, mirroring `NAV_GROUPS` in the component.
 */
const GROUPS = [
  {
    key: 'shopping',
    label: 'Mitä kannattaa ostaa?',
    hrefs: ['/savings', '/value', '/products', '/calculator', '/compare'],
  },
  {
    key: 'trip',
    label: 'Suunnittele matka',
    hrefs: ['/trip', '/basket', '/allowances'],
  },
  {
    key: 'event',
    label: 'Suunnittele juhlat',
    hrefs: ['/event', '/basket'],
  },
] as const;

const TOOL_HREFS: readonly string[] = GROUPS.flatMap((group) => [
  ...group.hrefs,
]);

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname = '/';
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
    // The mobile panel carries the same logout action.
    expect(screen.getByTestId('header-sign-out-mobile')).toHaveTextContent(
      'Kirjaudu ulos',
    );
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

/** Render the header signed-out and return the banner once settled. */
async function renderHeader(): Promise<HTMLElement> {
  mockedEnsureSession.mockRejectedValue(new Error('401'));
  renderWithIntl(<SiteHeader />);
  await screen.findByTestId('header-sign-in');
  return screen.getByRole('banner');
}

describe('SiteHeader three task groups (task 3.1)', () => {
  it('renders exactly the three task-group triggers with task-language labels', async () => {
    await renderHeader();

    for (const group of GROUPS) {
      expect(screen.getByTestId(`nav-group-${group.key}-trigger`)).toHaveTextContent(
        group.label,
      );
    }
    // The desktop row carries exactly these three disclosures — the
    // `$`-anchored regex excludes the `-mobile` variants.
    expect(
      screen.getAllByTestId(/-trigger$/).map((el) => el.getAttribute('data-testid')),
    ).toEqual([
      'nav-group-shopping-trigger',
      'nav-group-trip-trigger',
      'nav-group-event-trigger',
    ]);
  });

  it('keeps every tool link inside a group panel — none sit flat in the header', async () => {
    const header = await renderHeader();

    const toolLinks = within(header)
      .getAllByRole('link')
      .filter((link) => TOOL_HREFS.includes(link.getAttribute('href') ?? ''));
    // All ten panel items, in both the desktop and the mobile nav.
    expect(toolLinks).toHaveLength(20);
    for (const link of toolLinks) {
      expect(link.closest('[data-testid*="-menu"]')).not.toBeNull();
    }
  });

  it('leaves the scenario tool and the ranking methodology out of the header', async () => {
    const header = await renderHeader();

    expect(header.querySelectorAll('a[href="/what-if"]')).toHaveLength(0);
    expect(header.querySelectorAll('a[href="/ranking"]')).toHaveLength(0);
  });

  it.each(GROUPS)('$key panel lists exactly its group tools', async (group) => {
    const user = userEvent.setup();
    await renderHeader();

    const trigger = screen.getByTestId(`nav-group-${group.key}-trigger`);
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const menu = screen.getByTestId(`nav-group-${group.key}-menu`);
    expect(
      within(menu).getAllByRole('link').map((link) => link.getAttribute('href')),
    ).toEqual([...group.hrefs]);
  });

  it.each(GROUPS)(
    '$key: Enter/Space toggle, arrows cycle, Escape returns to the trigger',
    async (group) => {
      const user = userEvent.setup();
      await renderHeader();

      const trigger = screen.getByTestId(`nav-group-${group.key}-trigger`);
      expect(trigger).toHaveAttribute('aria-haspopup', 'true');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveAttribute(
        'aria-controls',
        `site-header-${group.key}-menu`,
      );

      trigger.focus();
      await user.keyboard('{Enter}');
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await user.keyboard('{Enter}');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      await user.keyboard(' ');
      expect(trigger).toHaveAttribute('aria-expanded', 'true');

      const items = within(
        screen.getByTestId(`nav-group-${group.key}-menu`),
      ).getAllByRole('link');

      // ArrowDown enters at the first item; ArrowUp from there wraps
      // to the last, and both directions cycle around the ends.
      await user.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(items[0]);
      await user.keyboard('{ArrowUp}');
      expect(document.activeElement).toBe(items[items.length - 1]);
      await user.keyboard('{ArrowUp}');
      expect(document.activeElement).toBe(items[items.length - 2]);
      await user.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(items[items.length - 1]);
      await user.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(items[0]);

      await user.keyboard('{Escape}');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(document.activeElement).toBe(trigger);
    },
  );

  it.each(GROUPS)('$key: closes on tab-out', async (group) => {
    const user = userEvent.setup();
    await renderHeader();

    const trigger = screen.getByTestId(`nav-group-${group.key}-trigger`);
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Focus leaves the group wrapper entirely.
    (screen.getByTestId('header-sign-in') as HTMLElement).focus();
    await waitFor(() =>
      expect(trigger).toHaveAttribute('aria-expanded', 'false'),
    );
  });

  it('marks the shopping group active on /calculator', async () => {
    mockPathname = '/calculator';
    await renderHeader();

    // Border + semibold distinguish the trigger; aria-expanded stays
    // the open-state carrier, so color is never the sole signal.
    const trigger = screen.getByTestId('nav-group-shopping-trigger');
    expect(trigger.className).toContain('font-semibold');
    expect(trigger.className).toContain('border-primary-700');

    const items = within(
      screen.getByTestId('nav-group-shopping-menu'),
    ).getAllByRole('link');
    const calculator = items.find(
      (link) => link.getAttribute('href') === '/calculator',
    );
    expect(calculator).toHaveAttribute('aria-current', 'page');
    for (const link of items) {
      if (link !== calculator) expect(link).not.toHaveAttribute('aria-current');
    }

    for (const key of ['trip', 'event']) {
      const inactive = screen.getByTestId(`nav-group-${key}-trigger`);
      expect(inactive.className).toContain('font-medium');
      expect(inactive.className).not.toContain('font-semibold');
    }
  });

  it('keeps the group distinguished on a deeper child route', async () => {
    mockPathname = '/savings/price-history';
    await renderHeader();

    expect(
      screen.getByTestId('nav-group-shopping-trigger').className,
    ).toContain('font-semibold');
    const savings = within(screen.getByTestId('nav-group-shopping-menu'))
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') === '/savings');
    expect(savings).toHaveAttribute('aria-current', 'page');
  });

  it('renders the account chrome in the signed-in state too', async () => {
    mockedEnsureSession.mockResolvedValue(SESSION);

    renderWithIntl(<SiteHeader />);

    await waitFor(() =>
      expect(screen.getByTestId('header-sign-out')).toBeInTheDocument(),
    );
    // The account link is auth-state-independent chrome — it survives
    // the SSR probe swap exactly as it did as a nav item.
    expect(screen.getByTestId('header-account')).toHaveAttribute(
      'href',
      '/account',
    );
  });

  it('keeps the account chrome active on its routes and present in both navs', async () => {
    // "Oma tili stays as chrome, right side": the link lives outside the
    // task groups, and its active treatment follows the chrome-link
    // pattern — border + semibold plus `aria-current`, never color
    // alone. A deeper /account child marks it active.
    mockPathname = '/account/saved-baskets';
    await renderHeader();

    const account = screen.getByTestId('header-account');
    expect(account).toHaveAttribute('href', '/account');
    expect(account).toHaveAttribute('aria-current', 'page');
    expect(account.className).toContain('font-semibold');
    expect(account.className).toContain('border-primary-700');

    // The account area still belongs to no task group.
    for (const group of GROUPS) {
      const trigger = screen.getByTestId(`nav-group-${group.key}-trigger`);
      expect(trigger.className).toContain('font-medium');
      expect(trigger.className).not.toContain('font-semibold');
    }
    expect(screen.getByTestId('header-sign-in')).toBeInTheDocument();

    const mobileNav = document.getElementById('site-header-mobile-nav');
    expect(mobileNav).not.toBeNull();
    expect(
      within(mobileNav as HTMLElement).getByTestId('header-account-mobile'),
    ).toHaveAttribute('href', '/account');
  });

  it('the account chrome carries no active state on unrelated routes', async () => {
    await renderHeader();

    const account = screen.getByTestId('header-account');
    expect(account).not.toHaveAttribute('aria-current');
    expect(account.className).not.toContain('font-semibold');
  });
});

describe('SiteHeader mobile panel (task 3.1)', () => {
  it('presents the three task groups with operable disclosures', async () => {
    const user = userEvent.setup();
    await renderHeader();

    const toggle = screen.getByRole('button', { name: 'Päävalikko' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'site-header-mobile-nav');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    for (const group of GROUPS) {
      const trigger = screen.getByTestId(
        `nav-group-${group.key}-trigger-mobile`,
      );
      expect(trigger).toHaveTextContent(group.label);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      // Closed stacked panels are display:none.
      expect(
        screen.getByTestId(`nav-group-${group.key}-menu-mobile`).className,
      ).toContain('hidden');
    }

    const shopping = screen.getByTestId('nav-group-shopping-trigger-mobile');
    shopping.focus();
    await user.keyboard('{ArrowDown}');
    expect(shopping).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByTestId('nav-group-shopping-menu-mobile');
    expect(menu.className).not.toContain('hidden');
    expect(
      within(menu).getAllByRole('link').map((link) => link.getAttribute('href')),
    ).toEqual([...GROUPS[0].hrefs]);
    expect(document.activeElement).toBe(within(menu).getAllByRole('link')[0]);
  });

  it('carries the locale switcher and auth actions', async () => {
    await renderHeader();

    const mobileNav = document.getElementById('site-header-mobile-nav');
    expect(mobileNav).not.toBeNull();
    const panel = within(mobileNav as HTMLElement);
    expect(panel.getByTestId('locale-switcher-mobile')).toBeInTheDocument();
    expect(panel.getByTestId('header-sign-in-mobile')).toBeInTheDocument();
    expect(panel.getByTestId('header-register-mobile')).toBeInTheDocument();
  });
});

describe('SiteHeader locale switcher', () => {
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
