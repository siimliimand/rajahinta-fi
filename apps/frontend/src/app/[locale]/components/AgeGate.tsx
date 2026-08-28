'use client';

import { useState, useEffect } from 'react';
import React from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

const STORAGE_KEY = 'age_confirmed';
const COOKIE_NAME = 'age_confirmed';
const DECLINED_PATH = '/age-gate/declined';

function getAgeVerified(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

function setAgeConfirmedCookie(): void {
  document.cookie = `${COOKIE_NAME}=true; path=/; SameSite=Lax; max-age=86400`;
}

function clearAgeConfirmedCookie(): void {
  document.cookie = `${COOKIE_NAME}=; path=/; SameSite=Lax; max-age=0`;
}

function setAgeVerified(): void {
  localStorage.setItem(STORAGE_KEY, 'true');
}

function clearAgeVerified(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Soft age gate — Phase 1 confirmation is self-attestation.
 *
 * The gate records only the visitor's own claim of being at least 18
 * (localStorage flag mirrored to the `age_confirmed` cookie) and proves
 * nothing beyond that claim. The backend's SimpleConfirmationProvider is
 * the same statement on the server side: it records that a confirmation
 * token was sent, nothing more. Both sides keep their interfaces so a
 * stronger verification can replace them without UI changes.
 *
 * SSR renders an inert placeholder and the stored decision is applied
 * after mount, so restricted content never appears in server-rendered
 * DOM. Declining clears the stored answer and navigates to the neutral
 * in-house page /age-gate/declined — never an external origin.
 */
export function AgeGate({ children }: { children: React.ReactNode }) {
  const [verified, setVerified] = useState<boolean | null>(null);
  const t = useTranslations('AgeGate');
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setVerified(getAgeVerified());
  }, []);

  const handleConfirm = () => {
    setAgeVerified();
    setAgeConfirmedCookie();
    setVerified(true);
  };

  const handleDeny = () => {
    // Keep the stored answer consistent with the denial, then leave via
    // the in-house page so the redirect cannot look broken or leak a referrer.
    clearAgeVerified();
    clearAgeConfirmedCookie();
    router.replace(DECLINED_PATH);
  };

  // The decline destination must stay reachable — it is neutral, and
  // re-gating it would replay the question that was just answered.
  if (pathname === DECLINED_PATH) {
    return <>{children}</>;
  }

  // Null means the stored decision has not been read yet (SSR and the
  // hydration pass): render the inert placeholder so restricted children
  // are absent from the initial HTML and the first client render matches it.
  if (verified === null) {
    return (
      <div
        aria-hidden="true"
        data-age-gate-placeholder=""
        className="min-h-[50vh]"
      />
    );
  }

  if (!verified) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="mx-4 w-full max-w-md rounded-lg bg-white p-8 text-center shadow-xl">
          <h2 className="text-xl font-semibold text-gray-900">{t('title')}</h2>
          <p className="mt-3 text-gray-600">{t('body')}</p>
          <div className="mt-6 flex justify-center gap-4">
            <button
              onClick={handleConfirm}
              className="rounded-md bg-primary-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              {t('confirm')}
            </button>
            <button
              onClick={handleDeny}
              className="rounded-md border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              {t('deny')}
            </button>
          </div>
          <p className="mt-4 text-xs text-gray-400">{t('note')}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
