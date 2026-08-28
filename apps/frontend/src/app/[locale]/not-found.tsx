'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * Not-found page for routes inside a locale segment. The middleware
 * rewrites unprefixed unknown paths into the default locale, so this
 * renders with the active locale's copy.
 */
export default function NotFoundPage() {
  const t = useTranslations('NotFound');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mt-3 text-sm text-gray-600">{t('body')}</p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-primary-600 px-6 py-3 text-sm font-medium text-white hover:bg-primary-700"
      >
        {t('goHome')}
      </Link>
    </main>
  );
}
