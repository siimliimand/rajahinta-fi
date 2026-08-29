// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';
import type { ReliabilityStatus } from '@/lib/types';

/**
 * Canonical status order for the trust-row legend: the same hue ladder the
 * result views use (green → blue → amber → gray, D1/D2).
 */
const TRUST_ROW_STATUSES = [
  'VERIFIED',
  'ESTIMATED',
  'STALE',
  'UNAVAILABLE',
] as const satisfies readonly ReliabilityStatus[];

/**
 * Homepage (OpenSpec: design-system-foundation, tasks 4.1 + 4.2).
 *
 * Static catalog copy only (D6): one-sentence value prop answering what
 * importing alcohol from Sweden to Finland costs, the calculator as the
 * primary call to action, quiet secondary links to the comparison view
 * and the ranking methodology, and a trust row naming the data sources,
 * the reliability model, and the methodology documentation. Typography
 * and spacing carry the hierarchy; no API calls are made from this page.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Home');
  const tNav = await getTranslations('Nav');
  // Root-scoped so the status labels resolve through the canonical
  // labelKey contract in RELIABILITY_STATUS_META.
  const tAll = await getTranslations();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        {/* One-sentence value prop; the cost components mirror the
            calculator's cost-category vocabulary (estimates, per the
            structural disclaimer). */}
        <h1 className="text-balance text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          {t('heroValueProp')}
        </h1>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {/* Mirrors Button primary/lg — the primitive renders a <button>,
              and the primary action must be a real navigable link. */}
          <Link
            href="/calculator"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {tNav('openCalculator')}
          </Link>
        </div>

        {/* Secondary destinations — subordinate to the calculator CTA. */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link
            href="/compare"
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            {tNav('compareProducts')}
          </Link>
          <Link
            href="/ranking"
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            {tNav('howRankingWorks')}
          </Link>
        </div>
      </div>

      {/* ── Trust row (task 4.2, D6) ──
          Static catalog copy: where the data comes from, how its
          reliability is marked, and where the method is documented.
          Freshness values themselves stay on the result views. */}
      <section
        aria-labelledby="home-trust-heading"
        className="mt-16 w-full max-w-4xl border-t border-gray-200 pt-10"
      >
        {/* Section landmark needs an accessible name; the three item
            titles below are visible and self-describing. */}
        <h2 id="home-trust-heading" className="sr-only">
          {t('trustHeading')}
        </h2>

        <div className="grid gap-8 text-left sm:grid-cols-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {t('trustSourcesTitle')}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
              {t('trustSourcesBody')}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {t('trustReliabilityTitle')}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
              {t('trustReliabilityBody')}
            </p>
            {/* The four reliability statuses with their canonical dots —
                shape + adjacent label, so hue is never the sole carrier
                of meaning. Explains the model; shows no live data. */}
            <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {TRUST_ROW_STATUSES.map((status) => {
                const meta = RELIABILITY_STATUS_META[status];
                return (
                  <li
                    key={status}
                    className="flex items-center gap-1.5 text-xs text-gray-600"
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block h-2 w-2 shrink-0 ${meta.dot}`}
                    />
                    {tAll(meta.labelKey)}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {t('trustMethodologyTitle')}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
              {t('trustMethodologyBody')}
            </p>
            {/* Same destination the header and footer link to. */}
            <Link
              href="/ranking"
              className="mt-2 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
            >
              {tNav('howRankingWorks')} →
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
