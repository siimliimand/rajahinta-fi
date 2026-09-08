'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  ApiFetchError,
  confirmNewsletterSubscription,
} from '@/lib/api';

/**
 * Newsletter confirmation landing page (task 5.4, change
 * trust-and-reach-roadmap; spec content-publication). The emailed
 * confirmation link lands here with the raw token in the query string;
 * the page consumes it once through `GET /api/v1/newsletter/confirm`
 * and renders the outcome. The token is read from `window.location`
 * instead of `useSearchParams` so the page stays out of the
 * Suspense-boundary prerender path (verify-email precedent).
 *
 * Honest outcomes: ACTIVE answers one confirmed state whether the
 * confirmation is fresh or a repeat (idempotent endpoint); an
 * UNSUBSCRIBED row renders the ended state — the consent is gone and
 * an old link does not resurrect it; invalid and missing tokens render
 * one uniform rejection without existence feedback.
 *
 * @module NewsletterConfirmPage
 */
type ConfirmOutcome =
  | { state: 'working' }
  | { state: 'missing' }
  | { state: 'confirmed' }
  | { state: 'ended' }
  | { state: 'invalid' }
  | { state: 'error' };

export default function NewsletterConfirmPage() {
  const t = useTranslations('NewsletterConfirm');
  const [outcome, setOutcome] = useState<ConfirmOutcome>({ state: 'working' });

  useEffect(() => {
    let cancelled = false;
    const token = new URLSearchParams(window.location.search).get('token');
    if (token === null || token === '') {
      setOutcome({ state: 'missing' });
      return;
    }
    confirmNewsletterSubscription(token)
      .then((result) => {
        if (cancelled) return;
        setOutcome(
          result.status === 'UNSUBSCRIBED'
            ? { state: 'ended' }
            : { state: 'confirmed' },
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Invalid and unknown tokens answer one uniform 400
        // InvalidToken — rendered as one outcome, no existence oracle.
        setOutcome(
          err instanceof ApiFetchError && err.status === 400
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
          <p data-testid="newsletter-confirm-status" className="mt-4 text-sm text-gray-600">
            {t('checking')}
          </p>
        )}

        {outcome.state === 'confirmed' && (
          <div data-testid="newsletter-confirm-status" className="mt-4">
            <p className="text-sm font-semibold text-green-700">
              {t('confirmedTitle')}
            </p>
            <p className="mt-2 text-sm text-gray-600">{t('confirmedBody')}</p>
          </div>
        )}

        {outcome.state === 'ended' && (
          <div data-testid="newsletter-confirm-status" className="mt-4">
            <p className="text-sm font-semibold text-gray-900">
              {t('endedTitle')}
            </p>
            <p className="mt-2 text-sm text-gray-600">{t('endedBody')}</p>
          </div>
        )}

        {(outcome.state === 'missing' || outcome.state === 'invalid') && (
          <div data-testid="newsletter-confirm-status" className="mt-4">
            <p role="alert" className="text-sm font-medium text-error">
              {outcome.state === 'missing'
                ? t('missingToken')
                : t('invalidBody')}
            </p>
            <p className="mt-2 text-sm text-gray-600">{t('invalidHint')}</p>
          </div>
        )}

        {outcome.state === 'error' && (
          <div data-testid="newsletter-confirm-status" className="mt-4">
            <p role="alert" className="text-sm font-medium text-error">
              {t('errorBody')}
            </p>
          </div>
        )}

        {/* The link renders only after the outcome is known — the
            working state keeps no dead controls. */}
        {outcome.state !== 'working' && (
          <div className="mt-6">
            <Link
              href="/blog"
              className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              {t('toBlog')}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
