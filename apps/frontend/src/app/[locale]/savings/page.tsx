// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BASE_URL, SERVER_AGE_CONFIRMATION_TOKEN } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import SavingsListing from './components/SavingsListing';
import {
  SAVINGS_CATEGORY_KEYS,
  SAVINGS_DEFAULT_CATEGORY,
  toSavingsCategoryKey,
} from './categories';

interface SavingsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// ---------------------------------------------------------------------------
// Market overview (task 5.2, price-intelligence-roadmap) — server read
// ---------------------------------------------------------------------------

/** One category's aggregates as GET /api/v1/savings/overview serves them. */
interface SavingsOverviewCategory {
  readonly category: string;
  readonly productCount: number;
  readonly averageObservedPriceCents: number;
  readonly largestDifference: {
    readonly productId: number;
    readonly productName: string;
    readonly merchant: string;
    readonly merchantCountry: string;
    readonly observedPriceCents: number;
    readonly referenceCents: number;
    readonly gapCents: number;
    readonly gapBasisPoints: number;
  } | null;
}

interface SavingsOverviewResponse {
  readonly asOf: string | null;
  readonly categories: readonly SavingsOverviewCategory[];
}

/**
 * Server-side overview read (the getServerProductDetail/sitemap
 * precedent): the endpoint is age-gated, so the server presents the
 * fixed first-party prerender token. Any failure or unexpected shape
 * degrades to null and the page renders without the section — the same
 * degradation contract as every other server fetch.
 */
async function getSavingsOverview(): Promise<SavingsOverviewResponse | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/savings/overview`, {
      headers: {
        accept: 'application/json',
        'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN,
      },
      next: { revalidate: 900 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SavingsOverviewResponse | null;
    if (body === null || typeof body !== 'object' || !Array.isArray(body.categories)) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

/** Euro amount from integer cents — the listing's `12.34 €` form. */
function formatEur(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

export async function generateMetadata({
  params,
}: SavingsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'SavingsPage' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

/**
 * Landed-cost gap page (insight-surfaces task 2.4, spec savings-discovery).
 *
 * The server shell owns everything that does not need the visitor's
 * cookies: title, informational framing (including the ordering rule,
 * stated exactly like the value and ranking pages state theirs), and the
 * category selector — plain links navigating `?category=`, so the
 * selection is URL state and no client state of its own. The table
 * itself loads client-side through the shared API client: the savings
 * endpoint is age-gated like every other product surface, and only
 * browser fetches carry the confirmation cookie and trigger the
 * 403 → age-gate recovery event.
 *
 * Content stance (savings-discovery spec): the listing is informational
 * only. Copy states what the numbers are — a computed difference between
 * an estimated landed total and the Alko reference — never that any
 * product is a worthwhile purchase; the content-policy lint enforces the
 * vocabulary.
 */
export default async function SavingsPage({ params, searchParams }: SavingsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const query = await searchParams;
  const raw = Array.isArray(query.category) ? query.category[0] : query.category;
  // Unknown or missing category falls back to the default (the value
  // page's normalization precedent).
  const category = toSavingsCategoryKey(raw) ?? SAVINGS_DEFAULT_CATEGORY;

  const t = await getTranslations('SavingsPage');
  const tOverview = await getTranslations('SavingsOverview');

  // Market overview — server-rendered (task 5.2). Absent from the HTML
  // on fetch failure or when no category has sufficient data.
  const overview = await getSavingsOverview();
  const overviewLocale = locale === 'fi' ? 'fi-FI' : 'en-GB';
  const overviewDate = (iso: string): string => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? iso
      : date.toLocaleDateString(overviewLocale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
  };
  const overviewCategoryLabel = (category: string): string =>
    (SAVINGS_CATEGORY_KEYS as readonly string[]).includes(category)
      ? // Canonical categories reuse the listing's established labels.
        t(`category.${category}`)
      : category;

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Title ── */}
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-6 text-sm leading-relaxed text-gray-500">{t('subtitle')}</p>

      {/* ── Informational framing ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <p className="text-sm leading-relaxed text-gray-600">
          {t('informationalNote')}
        </p>
      </section>

      {/* ── Market overview (task 5.2) — deterministic cross-category
          aggregates, server-rendered; omitted entirely on fetch failure
          or when no category has sufficient data ── */}
      {overview !== null && overview.categories.length > 0 && (
        <section
          aria-label={tOverview('heading')}
          data-testid="savings-overview"
          className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 className="mb-1 text-base font-semibold text-gray-900">
            {tOverview('heading')}
          </h2>
          <p className="mb-2 text-xs text-gray-400">
            {overview.asOf !== null
              ? tOverview('asOfLine', { date: overviewDate(overview.asOf) })
              : null}
          </p>
          <p className="mb-4 text-xs leading-relaxed text-gray-400">
            {tOverview('methodLine')}
          </p>

          <dl className="space-y-4">
            {overview.categories.map((entry) => {
              const gap = entry.largestDifference;
              return (
                <div
                  key={entry.category}
                  data-testid="savings-overview-category"
                  className="border-b border-gray-100 pb-4 last:border-b-0 last:pb-0"
                >
                  <dt className="text-sm font-semibold text-gray-900">
                    {overviewCategoryLabel(entry.category)}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-600">
                    {tOverview('countLine', { count: entry.productCount })} ·{' '}
                    {tOverview('averageLine', {
                      average: formatEur(entry.averageObservedPriceCents),
                    })}
                    {gap !== null && (
                      <>
                        {' '}
                        ·{' '}
                        {tOverview('largestLine', {
                          product: gap.productName,
                          figure: formatEur(Math.abs(gap.gapCents)),
                          direction: tOverview(
                            // gapCents = landed total − Alko reference
                            // (core-domain gap.ts): positive means the
                            // landed estimate sits ABOVE the reference.
                            gap.gapCents > 0
                              ? 'direction.dearer'
                              : gap.gapCents < 0
                                ? 'direction.cheaper'
                                : 'direction.equal',
                          ),
                        })}
                      </>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {/* ── Category selector — server-rendered links, URL-driven state ── */}
      <nav
        aria-label={t('categorySelectorLabel')}
        className="mb-8 flex flex-wrap gap-2"
      >
        {SAVINGS_CATEGORY_KEYS.map((key) => {
          const active = key === category;
          return (
            <Link
              key={key}
              href={`/savings?category=${key}`}
              aria-current={active ? 'page' : undefined}
              className={[
                'inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              {t(`category.${key}`)}
            </Link>
          );
        })}
      </nav>

      {/* ── Savings table (client-fetched, age-gated endpoint) ── */}
      <SavingsListing category={category} />
    </main>
  );
}
