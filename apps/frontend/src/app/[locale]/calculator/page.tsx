// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import CalculatorView from './calculator-view';

interface CalculatorPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Unique, descriptive metadata for the calculator route
 * (price-intelligence-roadmap task 2.1): cross-border cost calculator
 * framing, distinct from the site-default and every other page title.
 */
export async function generateMetadata({
  params,
}: CalculatorPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Calculator' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

/**
 * Landed-cost calculator page (price-intelligence-roadmap task 2.1,
 * design D2 — the reference conversion for the later server-shell +
 * client-view splits).
 *
 * The server shell owns everything that does not need the visitor's
 * interaction state: the unique metadata above, the intro copy, and the
 * "how this calculation works" summary — all crawlable in the server
 * HTML. The interactive search → calculate flow is the client view in
 * `calculator-view.tsx`, unchanged in behavior (the group-order / ops /
 * value pattern).
 */
export default async function CalculatorPage({ params }: CalculatorPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Calculator');

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      {/* ── Intro copy (server-rendered) ── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
      </div>

      {/* ── How this calculation works (server-rendered summary) ── */}
      <section
        aria-labelledby="calculator-how-heading"
        className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5"
      >
        <h2 id="calculator-how-heading" className="mb-2 text-base font-semibold text-gray-900">
          {t('howTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">{t('howBody')}</p>
      </section>

      {/* ── Interactive flow (client view) ── */}
      <CalculatorView />
    </main>
  );
}
