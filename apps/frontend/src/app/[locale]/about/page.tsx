// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface AboutPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: AboutPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'AboutPage' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

/**
 * About page (task 3.3, price-intelligence-roadmap).
 *
 * A static server shell in the value/allowances page precedent:
 * title, informational framing, and the service's factual stance —
 * all copy from the message catalogs, no data fetching, nothing that
 * needs the visitor's cookies. Content stance: the page states what the
 * service does and that every figure is an estimate; no claims beyond
 * the compliance vocabulary.
 */
export default async function AboutPage({ params }: AboutPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('AboutPage');

  const sections = [
    { titleKey: 'whatTitle', bodyKey: 'whatBody' },
    { titleKey: 'dataTitle', bodyKey: 'dataBody' },
    { titleKey: 'neutralityTitle', bodyKey: 'neutralityBody' },
  ] as const;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('subtitle')}
      </p>

      {sections.map((section) => (
        <section
          key={section.titleKey}
          className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            {t(section.titleKey)}
          </h2>
          <p className="text-sm leading-relaxed text-gray-600">
            {t(section.bodyKey)}
          </p>
        </section>
      ))}
    </main>
  );
}
