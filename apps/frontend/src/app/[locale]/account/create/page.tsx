'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { getSessionUserId } from '@/lib/api';

/**
 * Account creation confirmation page.
 *
 * Phase 1: anonymous-only. The session is created automatically on first
 * visit (by getSessionUserId), so this page serves as a confirmation that
 * the anonymous account is ready. No email or personal data is collected.
 *
 * @module AccountCreatePage
 */
export default function AccountCreatePage() {
  const t = useTranslations('AccountCreate');
  const tNav = useTranslations('Nav');
  const tCommon = useTranslations('Common');
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    setSessionId(getSessionUserId());
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <nav className="mb-6">
        <Link
          href="/account"
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          {tNav('backToAccount')}
        </Link>
      </nav>

      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-100">
          <svg
            className="h-6 w-6 text-primary-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('body')}</p>

        {sessionId && (
          <p className="mt-3 text-xs text-gray-400">
            {tCommon('sessionId', { id: sessionId.slice(0, 8) })}
          </p>
        )}

        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/account"
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            {t('goToAccount')}
          </Link>
          <Link
            href="/"
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('startBrowsing')}
          </Link>
        </div>
      </div>
    </main>
  );
}
