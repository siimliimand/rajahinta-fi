'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useFeatureFlags } from '@/lib/feature-flags';
import Logo from './Logo';
import { Button } from '@/components/ui';
import { isEventCalculatorFlagEnabled } from '../event/event-calculator-flag';
import { isTripCalculatorFlagEnabled } from '../trip/trip-calculator-flag';
import { isWhatIfFlagEnabled } from '../what-if/what-if-flag';

/**
 * Layout-level header: the five primary destinations on every page.
 * Placed outside the age gate so navigation exists in the SSR payload —
 * per-page back-links were removed in its favour.
 *
 * A client component (the smallest one in the chrome) because the active
 * destination and the mobile disclosure need pathname and toggle state.
 * Everything else stays server-friendly: the links are real anchors in
 * both navs, so the closed mobile menu is `display: none` — present in
 * the server HTML, never a focus trap. One nav is exposed per viewport
 * (desktop row, mobile panel); they never render side by side.
 */

/** The five primary destinations (web-application spec: shared navigation). */
const NAV_ITEMS = [
  { href: '/calculator', messageKey: 'calculator' },
  { href: '/compare', messageKey: 'compare' },
  { href: '/basket', messageKey: 'basket' },
  { href: '/account', messageKey: 'account' },
  { href: '/ranking', messageKey: 'ranking' },
] as const;

/**
 * The flag-gated destinations, appended after basket when their flags are
 * on — the event entry first, the trip entry after it, the what-if entry
 * after the trip. Kept out of the base list so flag-off deployments render
 * exactly the original five destinations.
 */
const EVENT_NAV_ITEM = { href: '/event', messageKey: 'event' } as const;
const TRIP_NAV_ITEM = { href: '/trip', messageKey: 'trip' } as const;
const WHATIF_NAV_ITEM = { href: '/what-if', messageKey: 'whatIf' } as const;

const MOBILE_NAV_ID = 'site-header-mobile-nav';

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
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // The gated entries ride the same server-inlined flag payload as every
  // gated page: a flag off (or absent from an older payload) removes its
  // destination — flag-off keeps the original five destinations.
  const flags = useFeatureFlags();
  const eventOn = isEventCalculatorFlagEnabled(flags);
  const withEvent = eventOn
    ? [...NAV_ITEMS.slice(0, 3), EVENT_NAV_ITEM, ...NAV_ITEMS.slice(3)]
    : NAV_ITEMS;
  // The trip entry follows the event entry — or basket when the event
  // feature is off.
  const tripInsertAt = eventOn ? 4 : 3;
  const withTrip = isTripCalculatorFlagEnabled(flags)
    ? [...withEvent.slice(0, tripInsertAt), TRIP_NAV_ITEM, ...withEvent.slice(tripInsertAt)]
    : withEvent;
  // The what-if entry closes the gated chain, after the trip entry — or
  // in the same slot when the trip feature is off.
  const whatIfInsertAt = isTripCalculatorFlagEnabled(flags) ? tripInsertAt + 1 : tripInsertAt;
  const navItems = isWhatIfFlagEnabled(flags)
    ? [...withTrip.slice(0, whatIfInsertAt), WHATIF_NAV_ITEM, ...withTrip.slice(whatIfInsertAt)]
    : withTrip;

  // Following a nav link must close the menu — otherwise the panel stays
  // open over the page the visitor just navigated to.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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

  return (
    <header className="border-b border-gray-200 bg-white" onKeyDown={handleKeyDown}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-x-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center text-lg transition-opacity hover:opacity-80"
        >
          <Logo />
        </Link>

        {/* Desktop row — always visible from md up. */}
        <nav
          aria-label={t('navLabel')}
          className="hidden flex-wrap items-center gap-x-5 gap-y-1 md:flex"
        >
          {navItems.map((item) => renderNavLink(item, false))}
        </nav>

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
        {navItems.map((item) => renderNavLink(item, true))}
      </nav>
    </header>
  );
}
