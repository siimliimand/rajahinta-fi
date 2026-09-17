// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import CompareView from './compare-view';

interface ComparePageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Unique, descriptive metadata for the comparison route
 * (price-intelligence-roadmap task 2.2): side-by-side landed-cost
 * comparison framing, distinct from the site-default and every other
 * page title.
 */
export async function generateMetadata({
  params,
}: ComparePageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Compare' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

/**
 * Product comparison page (price-intelligence-roadmap task 2.2, the D2
 * server-shell + client-view split).
 *
 * The server shell owns everything that does not need the visitor's
 * interaction state: the unique metadata above, the intro copy, and the
 * "how this comparison works" summary — all crawlable in the server
 * HTML. The interactive add → compare flow is the client view in
 * `compare-view.tsx`, unchanged in behavior.
 */
export default async function ComparePage({ params }: ComparePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Compare');

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Intro copy (server-rendered) ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── How this comparison works (server-rendered summary) ── */}
      <section
        aria-labelledby="compare-how-heading"
        className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5"
      >
        <h2 id="compare-how-heading" className="mb-2 text-base font-semibold text-gray-900">
          {t('howTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">{t('howBody')}</p>
      </section>

      {/* ── Interactive flow (client view) ── */}
      <CompareView />
    </main>
  );
}
