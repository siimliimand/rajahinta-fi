'use client';

import { useEffect, useRef, useState } from 'react';
import React from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui';

const COOKIE_NAME = 'age_confirmed';
/** localStorage key the previous dual-store implementation wrote. */
const LEGACY_STORAGE_KEY = 'age_confirmed';
/** Exported only so tests can pin the 90-day TTL (jsdom hides max-age). */
export const AGE_CONFIRMATION_TTL_DAYS = 90;
const DECLINED_PATH = '/age-gate/declined';
/** Recovery event dispatched centrally by the api client on a gated 403. */
const AGE_GATE_REQUIRED_EVENT = 'age-gate:required';

/**
 * Read the gate decision from the `age_confirmed` cookie — the same
 * store the API client presents on every gated request. Same split/trim
 * parse as getCookie in lib/api.ts; an empty value counts as unconfirmed.
 */
function getAgeVerified(): boolean {
  if (typeof document === 'undefined') return false;
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  const value = match ? match.slice(COOKIE_NAME.length + 1) : '';
  return value.length > 0;
}

function setAgeConfirmedCookie(): void {
  document.cookie = `${COOKIE_NAME}=true; path=/; SameSite=Lax; max-age=${AGE_CONFIRMATION_TTL_DAYS * 86400}`;
}

function clearAgeConfirmedCookie(): void {
  document.cookie = `${COOKIE_NAME}=; path=/; SameSite=Lax; max-age=0`;
}

/**
 * <html> attribute the layout's inline pre-paint script seeds before
 * first paint and the unlayered base-CSS rule in globals.css reads to
 * keep the server-rendered overlay unpainted pre-hydration. Restated
 * as a literal: layout.tsx cannot import constants across the
 * 'use client' boundary (it would receive a client reference).
 */
const PREPAINT_FLAG = 'data-age-confirmed';

/**
 * Mirror the confirmed verdict onto <html>. The pre-paint script only
 * seeds the attribute; from hydration on this component owns it, so
 * every state transition keeps the CSS rule consistent with the DOM.
 * Clearing it BEFORE the 403-recovery re-open is load-bearing: without
 * that, the pre-hydration rule would keep the reopened overlay
 * invisible.
 */
function setPrePaintFlag(confirmed: boolean): void {
  if (typeof document === 'undefined') return;
  if (confirmed) {
    document.documentElement.setAttribute(PREPAINT_FLAG, '');
  } else {
    document.documentElement.removeAttribute(PREPAINT_FLAG);
  }
}

/** Remove the key the old implementation wrote (cleanup, see below). */
function removeLegacyStorageKey(): void {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

/** Query for the dialog's tab stops — initial focus and the Tab trap. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getDialogFocusables(dialog: HTMLElement | null): HTMLElement[] {
  if (dialog === null) return [];
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Soft age gate — Phase 1 confirmation is self-attestation.
 *
 * The gate records only the visitor's own claim of being at least 18
 * and proves nothing beyond that claim. The backend's
 * SimpleConfirmationProvider is the same statement on the server side;
 * both sides keep their interfaces so a stronger verification can
 * replace them without UI changes.
 *
 * The `age_confirmed` cookie is the single source of truth — the same
 * store the API client authenticates with — with a 90-day TTL. A
 * previous implementation also kept the answer in localStorage with no
 * expiry, so once the cookie lapsed the modal never reappeared while
 * every gated API call kept 403ing; the stale localStorage key is now
 * removed on mount so old visitors converge on the cookie alone.
 *
 * The server does not read the cookie (design D4 of first-impression-pass):
 * the [locale] layout renders cookie-independently — every route stays
 * cacheable — and always ships the overlay in the server HTML, while an
 * inline pre-paint script sets `data-age-confirmed` on <html> before
 * first paint and the unlayered base-CSS rule in globals.css keeps that
 * server-rendered overlay unpainted for confirmed visitors. This
 * component's initial render matches the server HTML (overlay in the
 * tree — no hydration mismatch), then the mount effect converges on the
 * cookie — still the single source of truth — unmounting the overlay
 * behind the already-applied CSS, so confirmed visitors with JS on
 * never see a gate flash. From hydration on, the component keeps the
 * <html> flag in sync so the pre-hydration CSS rule can never suppress
 * a React-mounted overlay — in particular the `age-gate:required`
 * 403-recovery re-open. Children always
 * render: an unconfirmed visitor gets the dialog as a fixed overlay on
 * top, never a placeholder replacement, so restricted content stays in
 * the crawlable server payload and the gate is not a cloak (gated data
 * remains server-enforced via the APIs' 403s). Declining clears the
 * cookie and navigates to the neutral in-house
 * page /age-gate/declined — never an external origin.
 */
export function AgeGate({ children }: { children: React.ReactNode }) {
  // The server HTML always contains the overlay (cookie-independent
  // render), so the initial client render must too; converging on the
  // cookie happens in the mount effect below.
  const [verified, setVerified] = useState(false);
  const t = useTranslations('AgeGate');
  const router = useRouter();
  const pathname = usePathname();

  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Cleanup for visitors still carrying the old dual-store state.
    removeLegacyStorageKey();
    // Convergence on the single source of truth: the same read the
    // pre-paint script did before first paint, repeated at hydration
    // (the cookie can lapse in between; fresh visits converge here
    // either way). Confirmed visitors see nothing change — the overlay
    // was already CSS-hidden and is now unmounted outright.
    const confirmed = getAgeVerified();
    setVerified(confirmed);
    setPrePaintFlag(confirmed);

    // Recovery hook for an expired cookie: when a client request comes
    // back 403 AGE_GATE_REQUIRED, the api client dispatches this event
    // and the prompt re-opens in place instead of the visitor being
    // stuck on silently failing calls. Opening an already-open gate
    // (verified already false) is a no-op. The flag is cleared first so
    // the pre-hydration CSS rule cannot hide the reopened overlay.
    const handleGateRequired = () => {
      setPrePaintFlag(false);
      setVerified(false);
    };
    window.addEventListener(AGE_GATE_REQUIRED_EVENT, handleGateRequired);
    return () => {
      window.removeEventListener(AGE_GATE_REQUIRED_EVENT, handleGateRequired);
    };
  }, []);

  const handleConfirm = () => {
    setAgeConfirmedCookie();
    setPrePaintFlag(true);
    setVerified(true);
  };

  const handleDeny = () => {
    // Clear the cookie (and any stale legacy key) so the denial sticks,
    // then leave via the in-house page so the redirect cannot look
    // broken or leak a referrer.
    removeLegacyStorageKey();
    clearAgeConfirmedCookie();
    setPrePaintFlag(false);
    router.replace(DECLINED_PATH);
  };

  // While the overlay is open it owns focus: focus moves into the
  // dialog on open (with the previously focused element remembered),
  // Tab is trapped inside, and on close focus returns to the flow that
  // triggered the open. The pathname dep re-runs this after a soft
  // navigation so the gate re-takes focus on the next page.
  const gateOpen = !verified;
  useEffect(() => {
    if (!gateOpen) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    (getDialogFocusables(dialog)[0] ?? dialog)?.focus();
    return () => {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [gateOpen, pathname]);

  const handleTrapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusables = getDialogFocusables(dialog);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!(active instanceof Node) || !dialog.contains(active)) {
      // Focus escaped (or never entered) the dialog — pull it back in.
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // The decline destination must stay reachable — it is neutral, and
  // re-gating it would replay the question that was just answered.
  if (pathname === DECLINED_PATH) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      {gateOpen && (
        <div
          data-age-gate-overlay=""
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onKeyDown={handleTrapKeyDown}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="age-gate-title"
            aria-describedby="age-gate-body"
            tabIndex={-1}
            className="mx-4 w-full max-w-md rounded-lg bg-white p-8 text-center shadow-xl"
          >
            <h2 id="age-gate-title" className="text-xl font-semibold text-gray-900">
              {t('title')}
            </h2>
            <p id="age-gate-body" className="mt-3 text-gray-600">
              {t('body')}
            </p>
            <div className="mt-6 flex justify-center gap-4">
              <Button size="lg" onClick={handleConfirm}>
                {t('confirm')}
              </Button>
              <Button variant="secondary" size="lg" onClick={handleDeny}>
                {t('deny')}
              </Button>
            </div>
            <p className="mt-4 text-xs text-gray-400">{t('note')}</p>
          </div>
        </div>
      )}
    </>
  );
}
