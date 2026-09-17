// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import RankingView from './ranking-view';

interface RankingPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Unique, descriptive metadata for the methodology route
 * (price-intelligence-roadmap task 2.4): neutral-ranking methodology
 * framing, distinct from the site-default and every other page title.
 */
export async function generateMetadata({
  params,
}: RankingPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Ranking' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

/**
 * Ranking methodology page (price-intelligence-roadmap task 2.4, the D2
 * server-shell + client-view split).
 *
 * The server shell owns everything that does not need the visitor's
 * interaction state: the unique metadata above, the intro copy, and the
 * "how the orderings are formed" summary — all crawlable in the server
 * HTML. The API-backed methodology content is the client view in
 * `ranking-view.tsx`, unchanged in behavior.
 */
export default async function RankingPage({ params }: RankingPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Ranking');

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Intro copy (server-rendered) ── */}
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── How the orderings are formed (server-rendered summary) ── */}
      <section
        aria-labelledby="ranking-how-heading"
        className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5"
      >
        <h2 id="ranking-how-heading" className="mb-2 text-base font-semibold text-gray-900">
          {t('howTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">{t('howBody')}</p>
      </section>

      {/* ── Methodology content (client view) ── */}
      <RankingView />
    </main>
  );
}
