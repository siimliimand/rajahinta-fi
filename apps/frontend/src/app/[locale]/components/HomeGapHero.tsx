// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { Link } from '@/i18n/navigation';

// ---------------------------------------------------------------------------
// API contract — mirrors GET /api/v1/savings/top's serialization EXACTLY
// (homepage-live-gap-hero task 1.1, apps/api-worker savings.routes.ts; the
// frontend type lives here because the touch set is the homepage scope and
// the route remains the single source of truth).
// ---------------------------------------------------------------------------

/** One top-N row — every figure carries its provenance fields. */
export interface SavingsTopRow {
  readonly productId: number;
  readonly productName: string;
  readonly category: string;
  readonly merchant: string;
  readonly merchantCountry: string;
  readonly priceCents: number;
  readonly observedAt: string;
  readonly landedTotalCents: number;
  readonly alkoReferenceCents: number;
  readonly alkoObservedAt: string | null;
  readonly gapCents: number;
  readonly gapBasisPoints: number;
  readonly reliability: string;
  readonly confidence: string;
  readonly taxDatasetVersion: string;
}

/** GET /api/v1/savings/top response — import-favourable rows only. */
export interface SavingsTopResponse {
  /** The materialized day (YYYY-MM-DD), or null while none has materialized. */
  readonly asOf: string | null;
  readonly coverage: {
    readonly evaluated: number;
    readonly importFavourable: number;
    readonly listed: number;
  };
  readonly rows: readonly SavingsTopRow[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The section's render state, derived in page.tsx (homepage-live-gap-hero
 * task 2.2, D3/D4): pending when the snapshot day has no eligible rows,
 * unavailable when the server read failed or the day is older than the
 * freshness cutoff. No figures ever render in either degraded state.
 */
export type HomeGapHeroState =
  | {
      readonly kind: 'ready';
      readonly asOf: string;
      readonly rows: readonly SavingsTopRow[];
    }
  | { readonly kind: 'pending' }
  | { readonly kind: 'unavailable' };

/** The Home-namespace translator page.tsx passes down (getTranslations). */
export type HomeGapHeroTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

interface HomeGapHeroProps {
  readonly state: HomeGapHeroState;
  readonly locale: string;
  readonly t: HomeGapHeroTranslator;
}

/**
 * The homepage's live observed-difference section (homepage-live-gap-hero
 * task 2.2, spec web-application "Homepage live observed-difference
 * section").
 *
 * Up to five rows with the largest observed landed-cost gaps against the
 * Alko reference, each row ONE whole-row link to the product's detail
 * page: the anchor in the product cell stretches over the row via its
 * ::after pseudo-element against the row's containing block — the same
 * Safari-safe construction the /savings listing uses (commit fca4aeb;
 * `position: relative` alone is not honored as a containing block on
 * `<tr>` by WebKit, so the row also carries a zero transform, which
 * creates a containing block in every engine, and clips painting to its
 * own box). The focus ring stays on the anchor inside the row, so the row
 * clip never hides it.
 *
 * Degradation is the section's core contract (D3/D4): no eligible rows →
 * the pending state linking /savings; a failed or stale read → the
 * unavailable state. Figures are never guessed and never presented as
 * current when the snapshot is not.
 */
export default function HomeGapHero({ state, locale, t }: HomeGapHeroProps) {
  return (
    <section
      aria-labelledby="home-gap-hero-heading"
      data-testid="home-gap-hero"
      className="border-b border-gray-100 bg-white px-4 py-16 sm:px-6"
    >
      <div className="mx-auto max-w-5xl">
        <h2
          id="home-gap-hero-heading"
          className="mb-2 text-center text-2xl font-bold tracking-tight text-gray-900"
        >
          {t('liveGapHeading')}
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm leading-relaxed text-gray-600">
          {t('liveGapIntro')}
        </p>

        {state.kind === 'ready' && (
          <>
            {/* As-of provenance beside the figures (D4) — the date is
                data, not copy, formatted like the savings page's
                overview. */}
            <p className="mb-4 text-center text-xs text-gray-400">
              {t('liveGapAsOf', { date: formatAsOfDate(state.asOf, locale) })}
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th scope="col" className="pb-2 pr-4 font-medium">
                      {t('liveGapColumnProduct')}
                    </th>
                    <th scope="col" className="pb-2 pr-4 font-medium">
                      {t('liveGapColumnMerchant')}
                    </th>
                    <th scope="col" className="pb-2 pr-4 font-medium">
                      {t('liveGapColumnObservedPrice')}
                    </th>
                    <th scope="col" className="pb-2 pr-4 font-medium">
                      {t('liveGapColumnLandedTotal')}
                    </th>
                    <th scope="col" className="pb-2 pr-4 font-medium">
                      {t('liveGapColumnAlkoReference')}
                    </th>
                    <th scope="col" className="pb-2 font-medium">
                      {t('liveGapColumnGap')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {state.rows.map((row) => (
                    <HomeGapHeroRow key={row.productId} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {state.kind === 'pending' && (
          <div
            data-testid="home-gap-hero-pending"
            className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-gray-50 p-5 text-center"
          >
            <p className="text-sm leading-relaxed text-gray-600">
              {t('liveGapPendingBody')}
            </p>
            <Link
              href="/savings"
              className="mt-3 inline-block text-sm font-medium text-primary-700 hover:text-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              {t('liveGapPendingLink')}
            </Link>
          </div>
        )}

        {state.kind === 'unavailable' && (
          <div
            data-testid="home-gap-hero-unavailable"
            className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-gray-50 p-5 text-center"
          >
            <p className="text-sm leading-relaxed text-gray-600">
              {t('liveGapUnavailableBody')}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

/**
 * One table row. Number columns are tabular-nums so the figures align
 * visually; the gap is the signed euro difference (gapCents = landed
 * total − Alko reference), rendered exactly like the /savings listing's
 * gap column — negative reads cheaper than the reference.
 */
function HomeGapHeroRow({ row }: { row: SavingsTopRow }) {
  return (
    <tr className="relative transform-gpu [clip-path:inset(0)] transition-colors hover:bg-gray-50">
      <td className="py-2 pr-4">
        <Link
          href={{
            pathname: '/products/[id]',
            params: { id: row.productId },
          }}
          className="font-medium text-primary-700 hover:underline after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {row.productName}
        </Link>
      </td>
      <td className="py-2 pr-4 text-gray-700">
        {row.merchant}
        <span className="block text-xs text-gray-500">{row.merchantCountry}</span>
      </td>
      <td className="py-2 pr-4 tabular-nums text-gray-700">
        {formatEuros(row.priceCents)}
      </td>
      <td className="py-2 pr-4 font-semibold tabular-nums text-gray-900">
        {formatEuros(row.landedTotalCents)}
      </td>
      <td className="py-2 pr-4 tabular-nums text-gray-700">
        {formatEuros(row.alkoReferenceCents)}
      </td>
      <td className="py-2 pr-4 tabular-nums text-gray-700">
        {formatEuros(row.gapCents)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers — the /savings page's local forms, copied rather than
// imported across route groups.
// ---------------------------------------------------------------------------

/** Euro amount from integer cents — the listing's `12.34 €` form. */
function formatEuros(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

/** Locale-appropriate date for the snapshot day (the overview's pattern). */
function formatAsOfDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale === 'fi' ? 'fi-FI' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
