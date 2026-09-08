// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';
import type { ReliabilityStatus } from '@/lib/types';
import AccuracyStat from './components/AccuracyStat';

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
 * Homepage (OpenSpec: design-system-foundation, tasks 4.1 + 4.2;
 * trust-and-reach-roadmap task 3.3 extends the trust row).
 *
 * Static catalog copy only (D6): gradient hero with a floating search
 * card as the primary CTA, a "Why Rajahinta.fi" feature section surfacing
 * the platform's genuine differentiators, and the existing trust row
 * (data sources, reliability model, accuracy statistic, methodology).
 * No API calls on this page; AccuracyStat is a self-contained client island.
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
    <div className="flex min-h-screen flex-col">
      {/* ── Hero section ──────────────────────────────────────────────── */}
      <section
        aria-labelledby="home-hero-heading"
        className="relative overflow-hidden bg-gradient-to-br from-slate-900 to-primary-800 px-4 pb-24 pt-16 sm:pb-32 sm:pt-20"
      >
        {/* Subtle radial glow centred behind the content */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-[600px] w-[600px] rounded-full bg-primary-700 opacity-20 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-3xl text-center">
          {/* Trust pill badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium text-blue-100 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" aria-hidden="true" />
            {t('heroPillBadge')}
          </div>

          {/* Primary headline — larger scale overrides the base h1 style */}
          <h1
            id="home-hero-heading"
            className="text-balance text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl"
          >
            {t('heroHeadline')}
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-blue-100">
            {t('heroSubline')}
          </p>

          {/* ── Floating search / CTA card ── */}
          <div className="mx-auto mt-10 max-w-xl rounded-2xl bg-white p-3 shadow-xl ring-1 ring-white/10">
            <div className="flex items-center gap-3">
              {/* Decorative search field — clicking anywhere opens the calculator */}
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-gray-50 px-4 py-2.5 ring-1 ring-gray-200">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-4 w-4 shrink-0 text-gray-400"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="9" cy="9" r="6" />
                  <path d="M15 15l3 3" strokeLinecap="round" />
                </svg>
                <span className="select-none text-sm text-gray-400">
                  {t('heroSearchPlaceholder')}
                </span>
              </div>
              <Link
                href="/calculator"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                {tNav('openCalculator')}
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
            </div>
          </div>

          {/* Micro trust badges below the card */}
          <p className="mt-4 text-center text-xs text-blue-300">
            {t('heroTrustLine')}
          </p>
        </div>
      </section>

      {/* ── "Why Rajahinta.fi" feature section ───────────────────────── */}
      <section
        aria-labelledby="home-why-heading"
        className="border-b border-gray-100 bg-white px-4 py-16 sm:px-6"
      >
        <div className="mx-auto max-w-5xl">
          <h2
            id="home-why-heading"
            className="mb-10 text-center text-2xl font-bold tracking-tight text-gray-900"
          >
            {t('whyTitle')}
          </h2>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Feature 1 — Total landed cost */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M16 8h-6a2 2 0 100 4h4a2 2 0 110 4H8M12 6v2m0 8v2" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">{t('feature1Title')}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{t('feature1Body')}</p>
            </div>

            {/* Feature 2 — Verified data */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-status-verified">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">{t('feature2Title')}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{t('feature2Body')}</p>
            </div>

            {/* Feature 3 — Neutral ranking */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-200 text-gray-600">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">{t('feature3Title')}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{t('feature3Body')}</p>
            </div>

            {/* Feature 4 — Price history */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">{t('feature4Title')}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{t('feature4Body')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust row (task 4.2, D6) ──────────────────────────────────── */}
      <section
        aria-labelledby="home-trust-heading"
        className="bg-gray-50 px-4 py-16 sm:px-6"
      >
        <div className="mx-auto max-w-5xl">
          {/* Section landmark needs an accessible name; the three item
              titles below are visible and self-describing. */}
          <h2 id="home-trust-heading" className="sr-only">
            {t('trustHeading')}
          </h2>

          <div className="grid gap-8 text-left sm:grid-cols-2 lg:grid-cols-4">
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

            {/* ── Accuracy statistic (task 3.3) ──
                The user-reported outcome share in the trust row: always
                with its sample size and the API-supplied wording, honest
                empty state until outcomes exist. The fetch failure
                degrades quietly inside the component. */}
            <AccuracyStat variant="trust-row" />
          </div>
        </div>
      </section>
    </div>
  );
}
