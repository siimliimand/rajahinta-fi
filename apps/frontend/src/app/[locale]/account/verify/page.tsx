'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ApiFetchError, confirmEmailVerification } from '@/lib/api';

/**
 * Email-verification landing page (design D4/D8, change
 * email-password-auth). The emailed link lands here with the raw token in
 * the query string; the page consumes it once through
 * `POST /account/verify-email/confirm` and renders the outcome. The token
 * is read from `window.location` instead of `useSearchParams` so the page
 * stays out of the Suspense-boundary prerender path (what-if precedent).
 *
 * The unverified state elsewhere is a status badge, never a lockout; this
 * page only reports the confirmation result.
 *
 * @module VerifyEmailPage
 */
type VerifyOutcome =
  | { state: 'working' }
  | { state: 'missing' }
  | { state: 'success'; email: string }
  | { state: 'invalid' }
  | { state: 'error' };

export default function VerifyEmailPage() {
  const t = useTranslations('VerifyEmail');
  const [outcome, setOutcome] = useState<VerifyOutcome>({ state: 'working' });

  useEffect(() => {
    let cancelled = false;
    const token = new URLSearchParams(window.location.search).get('token');
    if (token === null || token === '') {
      setOutcome({ state: 'missing' });
      return;
    }
    confirmEmailVerification(token)
      .then((result) => {
        if (!cancelled) setOutcome({ state: 'success', email: result.email });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Invalid, expired, and replayed tokens all answer one uniform
        // 401 InvalidToken — rendered as one outcome.
        setOutcome(
          err instanceof ApiFetchError && err.status === 401
            ? { state: 'invalid' }
            : { state: 'error' },
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-8 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-primary-700">{t('title')}</h1>

        {outcome.state === 'working' && (
          <p data-testid="verify-status" className="mt-4 text-sm text-gray-600">
            {t('verifying')}
          </p>
        )}

        {outcome.state === 'missing' && (
          <div data-testid="verify-status" className="mt-4">
            <p role="alert" className="text-sm font-medium text-error">
              {t('missingToken')}
            </p>
            <p className="mt-2 text-sm text-gray-600">{t('resendHint')}</p>
            <div className="mt-6">
              <Link
                href="/login"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {t('toLogin')}
              </Link>
            </div>
          </div>
        )}

        {outcome.state === 'success' && (
          <div data-testid="verify-status" className="mt-4">
            <p className="text-sm font-semibold text-green-700">{t('successTitle')}</p>
            <p className="mt-2 text-sm text-gray-600">{t('successBody')}</p>
            <p className="mt-1 text-xs text-gray-400">{outcome.email}</p>
            <div className="mt-6">
              <Link
                href="/account"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {t('toAccount')}
              </Link>
            </div>
          </div>
        )}

        {(outcome.state === 'invalid' || outcome.state === 'error') && (
          <div data-testid="verify-status" className="mt-4">
            <p className="text-sm font-semibold text-gray-900">{t('invalidTitle')}</p>
            <p role="alert" className="mt-2 text-sm font-medium text-error">
              {outcome.state === 'invalid' ? t('invalidBody') : t('errorBody')}
            </p>
            <p className="mt-2 text-sm text-gray-600">{t('resendHint')}</p>
            <div className="mt-6">
              <Link
                href="/login"
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {t('toLogin')}
              </Link>
            </div>
          </div>
        )}

        {/* Actions render only after the outcome is known — the working
            state keeps no dead controls. */}
      </div>
    </main>
  );
}
