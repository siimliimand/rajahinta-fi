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
  unsubscribeNewsletter,
} from '@/lib/api';

/**
 * Newsletter one-click unsubscribe landing page (task 5.4, change
 * trust-and-reach-roadmap; spec content-publication — every newsletter
 * email carries a one-click unsubscribe link, effective immediately).
 * The emailed link points here with the token (or stored digest) in the
 * query string; the page forwards it to
 * `GET /api/v1/newsletter/unsubscribe`, which is immediate and
 * terminal. Token handling mirrors the confirm page (verify-email
 * precedent — window.location, no Suspense-boundary prerender).
 *
 * @module NewsletterUnsubscribePage
 */
type UnsubscribeOutcome =
  | { state: 'working' }
  | { state: 'missing' }
  | { state: 'done' }
  | { state: 'invalid' }
  | { state: 'error' };

export default function NewsletterUnsubscribePage() {
  const t = useTranslations('NewsletterUnsubscribe');
  const [outcome, setOutcome] = useState<UnsubscribeOutcome>({
    state: 'working',
  });

  useEffect(() => {
    let cancelled = false;
    const token = new URLSearchParams(window.location.search).get('token');
    if (token === null || token === '') {
      setOutcome({ state: 'missing' });
      return;
    }
    unsubscribeNewsletter(token)
      .then(() => {
        // Uniform UNSUBSCRIBED — fresh and repeat clicks converge on
        // the same honest ended state.
        if (!cancelled) setOutcome({ state: 'done' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
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
          <p data-testid="newsletter-unsubscribe-status" className="mt-4 text-sm text-gray-600">
            {t('working')}
          </p>
        )}

        {outcome.state === 'done' && (
          <div data-testid="newsletter-unsubscribe-status" className="mt-4">
            <p className="text-sm font-semibold text-green-700">
              {t('doneTitle')}
            </p>
            <p className="mt-2 text-sm text-gray-600">{t('doneBody')}</p>
          </div>
        )}

        {(outcome.state === 'missing' || outcome.state === 'invalid') && (
          <div data-testid="newsletter-unsubscribe-status" className="mt-4">
            <p role="alert" className="text-sm font-medium text-error">
              {outcome.state === 'missing'
                ? t('missingToken')
                : t('invalidBody')}
            </p>
            <p className="mt-2 text-sm text-gray-600">{t('invalidHint')}</p>
          </div>
        )}

        {outcome.state === 'error' && (
          <div data-testid="newsletter-unsubscribe-status" className="mt-4">
            <p role="alert" className="text-sm font-medium text-error">
              {t('errorBody')}
            </p>
          </div>
        )}

        {outcome.state !== 'working' && (
          <div className="mt-6">
            <Link
              href="/"
              className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              {t('toHome')}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
