// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface ContactPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: ContactPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ContactPage' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

/**
 * Contact page (task 3.3, price-intelligence-roadmap).
 *
 * A static server shell like the About page. The one channel the service
 * actually operates is the data-correction mechanism (the calculator
 * result page's CorrectionFlagPanel POSTing to /api/v1/corrections, with
 * operator-resolved, audit-logged review) — described at copy level and
 * named the way the catalog names it ("Ilmoita virheestä" / "Flag a
 * problem"). No invented email addresses, response-time promises, or tax
 * advice: authority matters are explicitly redirected to the officials.
 */
export default async function ContactPage({ params }: ContactPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('ContactPage');

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('subtitle')}
      </p>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-gray-900">
          {t('correctionsTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">
          {t('correctionsBody')}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          {t('correctionsReview')}
        </p>
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold text-gray-900">
          {t('generalTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">
          {t('generalBody')}
        </p>
      </section>
    </main>
  );
}
