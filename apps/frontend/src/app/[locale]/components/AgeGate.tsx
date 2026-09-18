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
 * The server hands the gate decision down (`initialVerified`, read from
 * the same cookie in the [locale] layout), so the first client render
 * matches the server HTML — no hydration mismatch. Children always
 * render: an unconfirmed visitor gets the dialog as a fixed overlay on
 * top, never a placeholder replacement, so restricted content stays in
 * the crawlable server payload and the gate is not a cloak (gated data
 * remains server-enforced via the APIs' 403s). The mount-time cookie
 * re-read and the `age-gate:required` recovery event re-open the
 * overlay if the decision flips after hydration or a gated call 403s.
 * Declining clears the cookie and navigates to the neutral in-house
 * page /age-gate/declined — never an external origin.
 */
export function AgeGate({
  children,
  initialVerified,
}: {
  children: React.ReactNode;
  /**
   * Server-read gate decision. `null` only where no server decision
   * exists (client-only call sites) — treated as unverified until the
   * mount-time cookie re-read.
   */
  initialVerified: boolean | null;
}) {
  const [verified, setVerified] = useState<boolean | null>(initialVerified);
  const t = useTranslations('AgeGate');
  const router = useRouter();
  const pathname = usePathname();

  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Cleanup for visitors still carrying the old dual-store state.
    removeLegacyStorageKey();
    // Fallback re-read: the cookie can lapse between the server-rendered
    // decision and hydration, and client-only call sites pass null.
    setVerified(getAgeVerified());

    // Recovery hook for an expired cookie: when a client request comes
    // back 403 AGE_GATE_REQUIRED, the api client dispatches this event
    // and the prompt re-opens in place instead of the visitor being
    // stuck on silently failing calls. Opening an already-open gate
    // (verified already false) is a no-op.
    const handleGateRequired = () => setVerified(false);
    window.addEventListener(AGE_GATE_REQUIRED_EVENT, handleGateRequired);
    return () => {
      window.removeEventListener(AGE_GATE_REQUIRED_EVENT, handleGateRequired);
    };
  }, []);

  const handleConfirm = () => {
    setAgeConfirmedCookie();
    setVerified(true);
  };

  const handleDeny = () => {
    // Clear the cookie (and any stale legacy key) so the denial sticks,
    // then leave via the in-house page so the redirect cannot look
    // broken or leak a referrer.
    removeLegacyStorageKey();
    clearAgeConfirmedCookie();
    router.replace(DECLINED_PATH);
  };

  // While the overlay is open it owns focus: focus moves into the
  // dialog on open (with the previously focused element remembered),
  // Tab is trapped inside, and on close focus returns to the flow that
  // triggered the open. The pathname dep re-runs this after a soft
  // navigation so the gate re-takes focus on the next page.
  const gateOpen = verified !== true;
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
