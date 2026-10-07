'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import Logo from './Logo';
import { Button } from '@/components/ui';
import { ensureSession, revokeSession } from '@/lib/api';
import type { SessionStatus } from '@/lib/types';

/**
 * Layout-level header: three task-based disclosure groups (change
 * three-task-navigation, decisions D1/D2/D4). `NAV_GROUPS` maps the three
 * visitor tasks — shopping, trip, event — to their tool links, and each is
 * rendered by `NavDisclosureGroup`, the Planning-dropdown pattern
 * parameterized, not rewritten. The trigger speaks task language; the
 * panel lists the group's real tools. When any child route is active the
 * group trigger is visually distinguished and the active child carries
 * `aria-current`. The footer remains the complete sitemap, so tools and
 * meta pages outside the header (scenario calculator, ranking
 * methodology) stay reachable there.
 *
 * Placed outside the age gate so navigation exists in the SSR payload.
 * A client component (the smallest one in the chrome) because the active
 * destination and the disclosures need pathname and toggle state.
 * Everything else stays server-friendly: the links are real anchors in
 * both navs, so a closed panel is `display: none` — present in the
 * server HTML, never a focus trap. One nav is exposed per viewport
 * (desktop row, mobile panel); they never render side by side.
 *
 * Auth awareness (design D8, change email-password-auth): the SSR payload
 * always renders the signed-out actions (Kirjaudu / Rekisteröidy). After
 * mount the header probes `GET /account/me` and, on a session, swaps the
 * actions for logout. The probe re-runs on the `auth:state-changed`
 * window event that sign-in/registration/logout dispatch, since a
 * client-side navigation never remounts the header.
 */

/** One tool link inside a task group's panel, label already translated. */
type NavGroupItem = { href: string; label: string };

/**
 * The three task groups, in display order (spec: shared navigation).
 * Triggers use the `group*` trigger labels; panel items use the tool
 * names. Routes are unchanged — the groups only regroup existing URLs.
 */
const NAV_GROUPS = [
  {
    key: 'shopping',
    labelKey: 'groupShopping',
    items: [
      { href: '/savings', messageKey: 'savings' },
      { href: '/value', messageKey: 'value' },
      { href: '/products', messageKey: 'products' },
      { href: '/calculator', messageKey: 'calculator' },
      { href: '/compare', messageKey: 'compare' },
    ],
  },
  {
    key: 'trip',
    labelKey: 'groupTrip',
    items: [
      { href: '/trip', messageKey: 'trip' },
      { href: '/basket', messageKey: 'basket' },
      { href: '/allowances', messageKey: 'allowances' },
    ],
  },
  {
    key: 'event',
    labelKey: 'groupEvent',
    items: [
      { href: '/event', messageKey: 'event' },
      { href: '/basket', messageKey: 'basket' },
    ],
  },
] as const;

const MOBILE_NAV_ID = 'site-header-mobile-nav';

const AUTH_STATE_CHANGED_EVENT = 'auth:state-changed';

/**
 * Exact match or a deeper segment: a group child marks its group active
 * on deeper routes too (any /savings/… page keeps the shopping group
 * distinguished). The boundary keeps /calculatorx from matching
 * /calculator.
 */
function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * One task group as a disclosure — the former Planning-dropdown pattern,
 * parameterized (decision D2): a real button opens a panel of real
 * links. Enter/Space activation is the button's native behaviour;
 * ArrowDown/ArrowUp move focus among the items (from the trigger:
 * first/last item); Escape and tab-out close it. Focus is always visible
 * (`focus-visible` ring, never `outline: none` alone) and the open state
 * is carried by `aria-expanded`, not by color. Active state propagates
 * from any child route to the trigger; the active child carries
 * `aria-current`.
 *
 * Desktop instances drop the panel over the page; the stacked variant
 * (mobile panel) expands it in flow and appends `-mobile` to the
 * per-instance testids.
 */
function NavDisclosureGroup({
  menuId,
  testId,
  label,
  items,
  pathname,
  stacked = false,
}: {
  menuId: string;
  testId: string;
  label: string;
  items: readonly NavGroupItem[];
  pathname: string;
  stacked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Following a nav link must close the disclosure — otherwise the
  // panel stays open over the page the visitor just navigated to.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /**
   * Focus the n-th panel item (wrapped): ArrowDown from the trigger
   * enters at 0, ArrowUp at the last item — items keep their natural
   * tab order inside the open panel.
   */
  const focusItem = (index: number) => {
    const anchors = rootRef.current?.querySelectorAll<HTMLAnchorElement>('a');
    if (!anchors || anchors.length === 0) return;
    const next = ((index % anchors.length) + anchors.length) % anchors.length;
    anchors[next]!.focus();
  };

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      focusItem(0);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      focusItem(-1);
    }
  };

  const handleItemKeyDown = (
    index: number,
    event: React.KeyboardEvent<HTMLElement>,
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(index + 1);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(index - 1);
    }
  };

  // Escape closes and refocuses the trigger; the handler sits on the
  // wrapper so it catches the key from both the trigger and the open
  // panel.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  // Tab-out closes: focus leaving the wrapper (relatedTarget outside it,
  // including a null relatedTarget when focus reaches the page body)
  // collapses the panel without stranding an open disclosure.
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (
      open &&
      (event.relatedTarget === null ||
        !rootRef.current?.contains(event.relatedTarget as Node))
    ) {
      setOpen(false);
    }
  };

  // Any active child route distinguishes the group trigger (border +
  // semibold); the open state stays with aria-expanded, so color is
  // never the sole carrier.
  const groupActive = items.some((item) => isRouteActive(pathname, item.href));

  const testIdSuffix = stacked ? '-mobile' : '';

  const triggerClassName = stacked
    ? [
        'flex w-full items-center justify-between gap-x-1 border-l-4 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
        groupActive
          ? 'border-primary-700 bg-primary-50 font-semibold text-gray-900'
          : 'border-transparent font-medium text-gray-600 hover:bg-gray-50 hover:text-primary-700',
      ].join(' ')
    : [
        'border-b-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        groupActive
          ? 'border-primary-700 font-semibold text-gray-900'
          : 'border-transparent font-medium text-gray-600 hover:text-primary-700',
      ].join(' ');

  const itemClassName = (itemActive: boolean) =>
    stacked
      ? [
          'block border-l-4 py-2 pl-6 pr-3 text-sm font-medium',
          itemActive
            ? 'border-primary-700 bg-primary-50 text-gray-900'
            : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-primary-700',
        ].join(' ')
      : [
          'block px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
          itemActive
            ? 'bg-primary-50 font-semibold text-gray-900'
            : 'font-medium text-gray-600 hover:bg-gray-50 hover:text-primary-700',
        ].join(' ');

  return (
    <div
      ref={rootRef}
      className="relative"
      data-testid={`${testId}${testIdSuffix}`}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    >
      <button
        type="button"
        ref={triggerRef}
        data-testid={`${testId}-trigger${testIdSuffix}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={handleTriggerKeyDown}
        className={triggerClassName}
      >
        {label}
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="ml-1 inline-block h-3 w-3"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div
        id={menuId}
        data-testid={`${testId}-menu${testIdSuffix}`}
        className={
          stacked
            ? open
              ? 'block'
              : 'hidden'
            : `${
                open ? 'block' : 'hidden'
              } absolute left-0 [inset-block-start:100%] z-50 mt-1 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg`
        }
      >
        {items.map((item, index) => {
          const itemActive = isRouteActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              {...(itemActive ? { 'aria-current': 'page' as const } : {})}
              onClick={() => setOpen(false)}
              onKeyDown={(event) => handleItemKeyDown(index, event)}
              className={itemClassName(itemActive)}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function SiteHeader() {
  const t = useTranslations('SiteHeader');
  const tAuth = useTranslations('AuthNav');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Following a nav link must close the mobile panel — otherwise it
  // stays open over the page the visitor just navigated to. The
  // disclosures close themselves on the same pathname change.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    function probe() {
      ensureSession()
        .then((s) => {
          if (!cancelled) setSession(s);
        })
        .catch(() => {
          // Signed-out (or backend unreachable): the header stays in its
          // signed-out render, which is also the SSR default.
          if (!cancelled) setSession(null);
        });
    }
    probe();
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, probe);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, probe);
    };
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      // A rejected revoke (expired session, offline) must not strand the
      // UI in a signed-in render — the cookie state is the truth and the
      // API clears it best-effort either way.
      await revokeSession();
    } catch {
      // Drop local state regardless.
    }
    setSigningOut(false);
    setSession(null);
    router.replace('/');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && menuOpen) {
      setMenuOpen(false);
      toggleRef.current?.focus();
    }
  };

  const renderNavGroup = (
    group: (typeof NAV_GROUPS)[number],
    stacked: boolean,
  ) => (
    <NavDisclosureGroup
      key={group.key}
      stacked={stacked}
      menuId={`site-header-${group.key}-menu${stacked ? '-mobile' : ''}`}
      testId={`nav-group-${group.key}`}
      label={t(group.labelKey)}
      items={group.items.map((item) => ({
        href: item.href,
        label: t(item.messageKey),
      }))}
      pathname={pathname}
    />
  );

  const renderAuthActions = (mobile: boolean) => {
    if (session) {
      return (
        <Button
          variant="secondary"
          size="sm"
          data-testid={mobile ? 'header-sign-out-mobile' : 'header-sign-out'}
          onClick={() => void handleSignOut()}
          disabled={signingOut}
        >
          {tAuth('signOut')}
        </Button>
      );
    }
    const linkClass = mobile
      ? 'inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium'
      : 'text-sm font-medium';
    return (
      <>
        <Link
          href="/login"
          data-testid={mobile ? 'header-sign-in-mobile' : 'header-sign-in'}
          className={
            mobile
              ? `${linkClass} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`
              : `${linkClass} text-gray-600 hover:text-primary-700`
          }
        >
          {tAuth('signIn')}
        </Link>
        <Link
          href="/register"
          data-testid={mobile ? 'header-register-mobile' : 'header-register'}
          className={
            mobile
              ? `${linkClass} bg-primary-600 text-white hover:bg-primary-700`
              : `${linkClass} inline-flex items-center rounded-md bg-primary-600 px-3 py-1.5 text-white hover:bg-primary-700`
          }
        >
          {tAuth('register')}
        </Link>
      </>
    );
  };

  /**
   * Account chrome (design: "Oma tili stays as chrome, right side"):
   * a flat link rendered in both auth states, ahead of the locale
   * switcher, outside the task groups. Its active treatment follows
   * the chrome-link pattern — border/semibold plus `aria-current`,
   * never color alone.
   */
  const renderAccountLink = (mobile: boolean) => {
    const accountActive = isRouteActive(pathname, '/account');
    return (
      <Link
        href="/account"
        data-testid={mobile ? 'header-account-mobile' : 'header-account'}
        {...(accountActive ? { 'aria-current': 'page' as const } : {})}
        className={
          mobile
            ? [
                'inline-flex items-center rounded-md px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                accountActive
                  ? 'bg-primary-50 font-semibold text-gray-900'
                  : 'font-medium text-gray-600 hover:bg-gray-50 hover:text-primary-700',
              ].join(' ')
            : [
                'inline-flex items-center border-b-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                accountActive
                  ? 'border-primary-700 font-semibold text-gray-900'
                  : 'border-transparent font-medium text-gray-600 hover:text-primary-700',
              ].join(' ')
        }
      >
        {t('account')}
      </Link>
    );
  };

  /**
   * `FI | EN` locale switcher (task 3.2): swaps the locale while keeping
   * the current pathname — next-intl's router rewrites the prefix, so a
   * visitor on /en/calculator lands on /calculator and vice versa. The
   * active locale is marked with `aria-current`, never by color alone.
   */
  const renderLocaleSwitcher = (mobile: boolean) => (
    <div
      role="group"
      aria-label={t('localeSwitcherLabel')}
      data-testid={mobile ? 'locale-switcher-mobile' : 'locale-switcher'}
      className="flex items-center gap-1 text-sm"
    >
      {routing.locales.map((switchLocale, index) => (
        <React.Fragment key={switchLocale}>
          {index > 0 && (
            <span aria-hidden="true" className="text-gray-300">
              |
            </span>
          )}
          <button
            type="button"
            data-testid={`locale-switch-${switchLocale}${mobile ? '-mobile' : ''}`}
            aria-current={locale === switchLocale ? 'true' : undefined}
            onClick={() => {
              if (locale !== switchLocale) {
                router.replace(pathname, { locale: switchLocale });
              }
            }}
            className={[
              'rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              locale === switchLocale
                ? 'font-semibold text-primary-700'
                : 'font-medium text-gray-500 hover:text-primary-700',
            ].join(' ')}
          >
            {switchLocale.toUpperCase()}
          </button>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <header className="sticky [inset-block-start:0] z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm" onKeyDown={handleKeyDown}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-x-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center text-lg transition-opacity hover:opacity-80"
        >
          <Logo />
        </Link>

        {/* Desktop row — always visible from md up: the three task-group
            disclosures, then nothing else; the locale switcher and auth
            actions trail on the row's far side. */}
        <nav
          aria-label={t('navLabel')}
          className="hidden flex-wrap items-center gap-x-1 gap-y-1 md:flex"
        >
          {NAV_GROUPS.map((group) => renderNavGroup(group, false))}
        </nav>

        {/* Desktop actions — visible from md up: the account chrome,
            then the locale switcher and the auth actions. */}
        <div className="hidden items-center gap-x-3 md:flex">
          {renderAccountLink(false)}
          {renderLocaleSwitcher(false)}
          {renderAuthActions(false)}
        </div>

        {/* Mobile disclosure toggle; native button semantics give
            Enter/Space activation for free. */}
        <Button
          ref={toggleRef}
          variant="ghost"
          size="sm"
          className="md:hidden"
          aria-label={t('navLabel')}
          aria-expanded={menuOpen}
          aria-controls={MOBILE_NAV_ID}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-5 w-5"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </Button>
      </div>

      {/* Mobile panel: closed means display:none — removed from the tab
          order and the accessibility tree, so focus is never trapped. */}
      <nav
        id={MOBILE_NAV_ID}
        aria-label={t('navLabel')}
        className={`${menuOpen ? 'flex' : 'hidden'} flex-col gap-1 border-t border-gray-200 px-4 pb-3 pt-2 md:hidden`}
      >
        {NAV_GROUPS.map((group) => renderNavGroup(group, true))}
        <div className="mt-2 flex items-center gap-2 border-t border-gray-200 pt-2">
          {renderAccountLink(true)}
          {renderLocaleSwitcher(true)}
          {renderAuthActions(true)}
        </div>
      </nav>
    </header>
  );
}
