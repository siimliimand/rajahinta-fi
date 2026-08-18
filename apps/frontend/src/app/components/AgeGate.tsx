'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'rajahinta_age_verified';

function getAgeVerified(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

const COOKIE_NAME = 'age_confirmed';

function setAgeConfirmedCookie(): void {
  document.cookie = `${COOKIE_NAME}=true; path=/; SameSite=Lax; max-age=86400`;
}

function setAgeVerified(): void {
  localStorage.setItem(STORAGE_KEY, 'true');
}

/**
 * Lightweight age gate — simple confirmation, no identity verification.
 * Stores a boolean flag in localStorage. No DOB, no documents.
 * Upgradeable to 15.2 stronger verification without changing the interface.
 */
export function AgeGate({ children }: { children: React.ReactNode }) {
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    setVerified(getAgeVerified());
  }, []);

  const handleConfirm = () => {
    setAgeVerified();
    setAgeConfirmedCookie();
    setVerified(true);
  };

  const handleDeny = () => {
    // Redirect to a safe page — no age-restricted content shown.
    window.location.href = 'https://www.google.com';
  };

  // SSR / hydration: render children to avoid layout shift; gate applies client-side.
  if (verified === null || verified) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-8 text-center shadow-xl">
        <h2 className="text-xl font-semibold text-gray-900">
          Age Verification
        </h2>
        <p className="mt-3 text-gray-600">
          This site contains alcohol-related content. Are you 18 or older?
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <button
            onClick={handleConfirm}
            className="rounded-md bg-primary-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            Yes, I am 18+
          </button>
          <button
            onClick={handleDeny}
            className="rounded-md border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            No
          </button>
        </div>
        <p className="mt-4 text-xs text-gray-400">
          No personal data is collected. A local flag is stored in your browser.
        </p>
      </div>
    </div>
  );
}
