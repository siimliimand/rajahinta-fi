import React from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Layout-level header: the five primary destinations on every page.
 * Server-rendered and placed outside the age gate so navigation exists
 * in the SSR payload — per-page back-links were removed in its favour.
 */
export default async function SiteHeader() {
  const t = await getTranslations('SiteHeader');

  const linkClassName =
    'text-sm font-medium text-gray-600 hover:text-primary-700';

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="text-lg font-bold text-primary-700 hover:text-primary-800"
        >
          Rajahinta.fi
        </Link>
        <nav
          aria-label={t('navLabel')}
          className="flex flex-wrap items-center gap-x-5 gap-y-1"
        >
          <Link href="/calculator" className={linkClassName}>
            {t('calculator')}
          </Link>
          <Link href="/compare" className={linkClassName}>
            {t('compare')}
          </Link>
          <Link href="/basket" className={linkClassName}>
            {t('basket')}
          </Link>
          <Link href="/account" className={linkClassName}>
            {t('account')}
          </Link>
          <Link href="/ranking" className={linkClassName}>
            {t('ranking')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
