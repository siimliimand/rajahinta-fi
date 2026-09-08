'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import Logo from './Logo';
import { Button } from '@/components/ui';
import { ensureSession, revokeSession } from '@/lib/api';
import type { SessionStatus } from '@/lib/types';

/**
 * Layout-level header: the primary destinations on every page. Placed
 * outside the age gate so navigation exists in the SSR payload —
 * per-page back-links were removed in its favour.
 *
 * A client component (the smallest one in the chrome) because the active
 * destination and the mobile disclosure need pathname and toggle state.
 * Everything else stays server-friendly: the links are real anchors in
 * both navs, so the closed mobile menu is `display: none` — present in
 * the server HTML, never a focus trap. One nav is exposed per viewport
 * (desktop row, mobile panel); they never render side by side.
 *
 * Auth awareness (design D8, change email-password-auth): the SSR payload
 * always renders the signed-out actions (Kirjaudu / Rekisteröidy). After
 * mount the header probes `GET /account/me` and, on a session, swaps the
 * actions for logout. The probe re-runs on the `auth:state-changed`
 * window event that sign-in/registration/logout dispatch, since a
 * client-side navigation never remounts the header.
 */

/** The primary destinations, in display order (web-application spec:
 *  shared navigation). */
const NAV_ITEMS = [
  { href: '/calculator', messageKey: 'calculator' },
  { href: '/compare', messageKey: 'compare' },
  { href: '/basket', messageKey: 'basket' },
  { href: '/event', messageKey: 'event' },
  { href: '/trip', messageKey: 'trip' },
  { href: '/what-if', messageKey: 'whatIf' },
  { href: '/account', messageKey: 'account' },
  { href: '/ranking', messageKey: 'ranking' },
] as const;

const MOBILE_NAV_ID = 'site-header-mobile-nav';

const AUTH_STATE_CHANGED_EVENT = 'auth:state-changed';

/**
 * Exact match or a deeper segment: /account marks "Oma tili" active on
 * /account/saved-baskets too. The boundary keeps /calculatorx from
 * matching /calculator.
 */
function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SiteHeader() {
  const t = useTranslations('SiteHeader');
  const tAuth = useTranslations('AuthNav');
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Following a nav link must close the menu — otherwise the panel stays
  // open over the page the visitor just navigated to.
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

  const renderNavLink = (item: { href: string; messageKey: string }, mobile: boolean) => {
    const active = isRouteActive(pathname, item.href);
    // The active state is never carried by color alone: the desktop row
    // underlines the link (2px border) and the mobile panel keeps a
    // visible left bar; aria-current states it for assistive tech.
    const className = mobile
      ? [
          'block border-l-4 px-3 py-2 text-sm font-medium',
          active
            ? 'border-primary-700 bg-primary-50 text-gray-900'
            : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-primary-700',
        ].join(' ')
      : [
          'border-b-2 py-1 text-sm',
          active
            ? 'border-primary-700 font-semibold text-gray-900'
            : 'border-transparent font-medium text-gray-600 hover:text-primary-700',
        ].join(' ');

    return (
      <Link
        key={item.href}
        href={item.href}
        {...(active ? { 'aria-current': 'page' as const } : {})}
        className={className}
      >
        {t(item.messageKey)}
      </Link>
    );
  };

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

  return (
    <header className="sticky [inset-block-start:0] z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm" onKeyDown={handleKeyDown}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-x-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center text-lg transition-opacity hover:opacity-80"
        >
          <Logo />
        </Link>

        {/* Desktop row — always visible from md up.
            Primary tools (calculator, compare, basket) are grouped first;
            a subtle separator precedes the secondary destinations.
            The Calculator link uses a distinct pill to signal primacy
            without using color as the sole differentiator (aria-current
            still marks the active page). */}
        <nav
          aria-label={t('navLabel')}
          className="hidden flex-wrap items-center gap-x-1 gap-y-1 md:flex"
        >
          {/* ── Primary tool group ── */}
          {NAV_ITEMS.filter((item) =>
            ['/calculator', '/compare', '/basket'].includes(item.href)
          ).map((item) => {
            const active = isRouteActive(pathname, item.href);
            if (item.href === '/calculator') {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  {...(active ? { 'aria-current': 'page' as const } : {})}
                  className={[
                    'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-primary-700 text-white'
                      : 'bg-primary-50 text-primary-700 ring-1 ring-primary-200 hover:bg-primary-100',
                  ].join(' ')}
                >
                  {t(item.messageKey)}
                </Link>
              );
            }
            return renderNavLink(item, false);
          })}

          {/* ── Separator ── */}
          <span aria-hidden="true" className="mx-2 h-4 w-px bg-gray-200" />

          {/* ── Secondary / meta group ── */}
          {NAV_ITEMS.filter((item) =>
            !['/calculator', '/compare', '/basket'].includes(item.href)
          ).map((item) => renderNavLink(item, false))}
        </nav>

        {/* Desktop auth actions — visible from md up. */}
        <div className="hidden items-center gap-x-3 md:flex">
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
        {NAV_ITEMS.map((item) => renderNavLink(item, true))}
        <div className="mt-2 flex items-center gap-2 border-t border-gray-200 pt-2">
          {renderAuthActions(true)}
        </div>
      </nav>
    </header>
  );
}
