'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { RankingMethodology, SortOrder } from '@/lib/types';
import { getRankingMethodology } from '@/lib/api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fallback sort-order list when the methodology API is unreachable. */
const SORT_ORDER_VALUES: readonly SortOrder[] = [
  'LOWEST_LANDED_COST',
  'LOWEST_PER_LITRE',
  'LOWEST_PER_UNIT',
  'ALPHABETICAL',
  'ALCOHOL_PERCENTAGE',
  'PRODUCT_CATEGORY',
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Public ranking methodology page.
 *
 * Documents how product sorting works in plain language, generated from
 * descriptions that are kept in lockstep with the Ranking & Sorting module
 * (catalog descriptions mirror `RankingService.describeSortOrder()`; a
 * catalog parity test and the compliance lockstep test guard the chain).
 * Explains that all rankings are objective and no paid placement exists.
 */
export default function RankingPage() {
  const t = useTranslations('Ranking');
  const tNav = useTranslations('Nav');
  const tSorts = useTranslations('SortOrders');
  const [apiData, setApiData] = useState<RankingMethodology | null>(null);
  const [apiLoaded, setApiLoaded] = useState(false);

  // Try to fetch from API; fall back to embedded data
  useEffect(() => {
    async function fetchMethodology() {
      const data = await getRankingMethodology();
      setApiData(data);
      setApiLoaded(true);
    }
    fetchMethodology();
  }, []);

  // Decide whether to show API data or embedded data
  const showApi = apiLoaded && apiData !== null && apiData.sortOrders.length > 0;

  const sortOrders: Array<{ name: SortOrder; label: string; description: string }> = (
    showApi
      ? apiData!.sortOrders.map((s) => ({
          name: s.name,
          label: tSorts(`${s.name}.label`),
          description: s.description,
        }))
      : SORT_ORDER_VALUES.map((key) => ({
          name: key,
          label: tSorts(`${key}.label`),
          description: tSorts(`${key}.description`),
        }))
  );

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Navigation ── */}
      <nav className="mb-6">
        <Link
          href="/"
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          {tNav('backHome')}
        </Link>
      </nav>

      {/* ── Title ── */}
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Neutrality statement ── */}
      <section className="mb-8 rounded-lg border border-green-200 bg-green-50 p-5">
        <h2 className="mb-2 text-sm font-semibold text-green-800">
          {t('neutralityTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-green-700">
          {showApi ? apiData!.introduction : t('neutralityStatement')}
        </p>
      </section>

      {/* ── Sort orders ── */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('sortOrdersTitle')}
        </h2>

        {!apiLoaded && (
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="mb-1 h-4 w-1/3 rounded bg-gray-200" />
                <div className="h-3 w-5/6 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        )}

        {apiLoaded && (
          <div className="space-y-3">
            {sortOrders.map((order) => (
              <article
                key={order.name}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
              >
                <h3 className="text-sm font-medium text-gray-900">
                  {order.label}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-600">
                  {order.description}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── Tiebreaker and determinism ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          {t('tiebreakerTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">
          {showApi && apiData!.tiebreaker
            ? apiData!.tiebreaker
            : t('tiebreakerStatement')}
        </p>
        {showApi && (
          <p className="mt-2 text-xs text-gray-400">
            {t('deterministic', {
              value: apiData!.deterministic ? t('yes') : t('no'),
            })}
          </p>
        )}
      </section>

      {/* ── Technical enforcement ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          {t('enforcementTitle')}
        </h2>
        <div className="space-y-3 text-xs leading-relaxed text-gray-600">
          <p>
            {t.rich('enforcementP1', {
              code: (chunks) => (
                <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-700">
                  {chunks}
                </code>
              ),
            })}
          </p>
          <p>{t('enforcementP2')}</p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>
              <strong className="text-gray-700">{t('layer1Name')}</strong>
              {t.rich('layer1Desc', {
                code: (chunks) => (
                  <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 font-mono">
                    {chunks}
                  </code>
                ),
              })}
            </li>
            <li>
              <strong className="text-gray-700">{t('layer2Name')}</strong>
              {t.rich('layer2Desc', {
                code: (chunks) => (
                  <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 font-mono">
                    {chunks}
                  </code>
                ),
              })}
            </li>
            <li>
              <strong className="text-gray-700">{t('layer3Name')}</strong>
              {t.rich('layer3Desc', {
                code: (chunks) => (
                  <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 font-mono">
                    {chunks}
                  </code>
                ),
              })}
            </li>
          </ol>
        </div>
      </section>

      {/* ── Correction flow link ── */}
      <section className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-5">
        <h2 className="mb-2 text-sm font-semibold text-amber-800">
          {t('spotTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-amber-700">
          {t.rich('spotBody', {
            link: (chunks) => (
              <Link
                href="/calculator"
                className="font-medium text-amber-900 underline hover:text-amber-950"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </section>

      {/* ── Footer ── */}
      <nav className="mt-8 flex flex-wrap gap-4">
        <Link
          href="/calculator"
          className="inline-flex items-center rounded-md bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700"
        >
          {tNav('openCalculator')}
        </Link>
        <Link
          href="/compare"
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {tNav('compareProducts')}
        </Link>
      </nav>
    </main>
  );
}
