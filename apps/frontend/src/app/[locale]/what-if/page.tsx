// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import WhatIfView from './what-if-view';

interface WhatIfPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Unique, descriptive metadata for the what-if route
 * (price-intelligence-roadmap task 2.4): hypothetical duty-rate framing,
 * distinct from the site-default and every other page title. (The
 * "scenario calculator" relabeling is task 4.6 — not here.)
 */
export async function generateMetadata({
  params,
}: WhatIfPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'WhatIfPage' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

/**
 * What-if simulator page (price-intelligence-roadmap task 2.4, the D2
 * server-shell + client-view split).
 *
 * The server shell owns everything that does not need the visitor's
 * interaction state: the unique metadata above, the intro copy carrying
 * the example scenario questions (illustrative questions a visitor might
 * ask — a duty-rate change, a price change), and the "how this
 * calculation works" summary — all crawlable in the server HTML. The
 * interactive scenario flow is the client view in `what-if-view.tsx`,
 * unchanged in behavior.
 */
export default async function WhatIfPage({ params }: WhatIfPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('WhatIfPage');

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Intro copy (server-rendered) ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Example scenario questions (server-rendered, illustrative) ── */}
      <section
        aria-labelledby="what-if-examples-heading"
        className="mb-8 rounded-lg border border-primary-200 bg-primary-50 p-5"
      >
        <h2
          id="what-if-examples-heading"
          className="mb-2 text-base font-semibold text-gray-900"
        >
          {t('examplesTitle')}
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-600">
          <li>{t('example1')}</li>
          <li>{t('example2')}</li>
          <li>{t('example3')}</li>
        </ul>
      </section>

      {/* ── How this calculation works (server-rendered summary) ── */}
      <section
        aria-labelledby="what-if-how-heading"
        className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5"
      >
        <h2 id="what-if-how-heading" className="mb-2 text-base font-semibold text-gray-900">
          {t('howTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">{t('howBody')}</p>
      </section>

      {/* ── Interactive flow (client view) ── */}
      <WhatIfView />
    </main>
  );
}
