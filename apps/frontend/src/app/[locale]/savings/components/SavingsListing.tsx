'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ConfidenceBadge, ReliabilityBadge } from '@/components/ui';
import { EmptyState } from '@/components/ui';
import { ErrorState } from '@/components/ui';
import { LoadingSkeleton } from '@/components/ui';
import { request } from '@/lib/api';
import {
  CONFIDENCE_LEVEL_META,
  RELIABILITY_STATUS_META,
} from '@/lib/design/status';
import type { SavingsCategoryKey } from '../categories';

// ---------------------------------------------------------------------------
// API contract — mirrors the route's serialization EXACTLY
// (insight-surfaces task 2.3, api-worker savings.routes.ts; the frontend
// type lives here because the touch set is the savings scope and the
// route remains the single source of truth).
// ---------------------------------------------------------------------------

/** One snapshot row — every figure carries its provenance fields. */
export interface SavingsRow {
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

/** GET /api/v1/savings?category= response. */
export interface SavingsResponse {
  /** The materialized day, or null while the daily pass has never run. */
  readonly asOf: string | null;
  readonly category: string;
  readonly coverage: {
    readonly evaluated: number;
    readonly withReference: number;
    readonly listed: number;
  };
  readonly rows: readonly SavingsRow[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The savings table (insight-surfaces task 2.4, spec savings-discovery).
 *
 * Client-fetched like the value ranking: the endpoint is age-gated, and
 * only browser fetches carry the confirmation cookie and trigger the
 * 403 → age-gate recovery event. Loading, failure, and the honest zero
 * state are explicit; rows are never invented.
 *
 * The header strip renders the snapshot's as-of day and the three
 * coverage counts verbatim from the response, so the funnel size is
 * visible even when the category narrows the list to zero.
 */
export default function SavingsListing({
  category,
}: {
  category: SavingsCategoryKey;
}) {
  const t = useTranslations('SavingsPage');
  const tCommon = useTranslations('Common');
  const locale = useLocale();

  const [data, setData] = useState<SavingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Bumping this value re-runs the effect — the retry affordance.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    request<SavingsResponse>(
      `/api/v1/savings?category=${encodeURIComponent(category)}`,
    )
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [category, reloadToken]);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  if (loading) {
    return (
      <div aria-live="polite">
        {/* Skeleton is decorative; the live region announces the wait. */}
        <LoadingSkeleton variant="text" count={6} />
        <span className="sr-only">{t('loading')}</span>
      </div>
    );
  }

  if (failed) {
    return (
      <ErrorState
        title={t('errorTitle')}
        description={t('errorBody')}
        onRetry={retry}
        retryLabel={tCommon('retry')}
      />
    );
  }

  if (data === null) {
    return null;
  }

  return (
    <div data-testid="savings-listing">
      {/* ── As-of + coverage header ── */}
      <section
        data-testid="savings-coverage"
        className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4"
      >
        <p className="text-sm text-gray-700">
          {data.asOf !== null
            ? t('asOfLabel', { date: formatAsOf(data.asOf, locale) })
            : t('asOfNone')}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {t('coverageLabel', {
            evaluated: data.coverage.evaluated,
            withReference: data.coverage.withReference,
            listed: data.coverage.listed,
          })}
        </p>
      </section>

      {data.rows.length === 0 && (
        <div data-testid="savings-empty">
          <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
        </div>
      )}

      {data.rows.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <table className="w-full text-sm">
            <caption className="sr-only">
              {/* The validated prop, not the echoed response field — the
                  caption key must always resolve to a known category. */}
              {t('tableCaption', { category: t(`category.${category}`) })}
            </caption>
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnPosition')}
                </th>
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnProduct')}
                </th>
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnLandedTotal')}
                </th>
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnAlkoReference')}
                </th>
                <th scope="col" className="pb-2 pr-4 font-medium">
                  {t('columnGap')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('columnReliability')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.rows.map((row, index) => (
                <SavingsRowView
                  key={row.productId}
                  row={row}
                  position={index + 1}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

/**
 * One table row. Number columns are tabular-nums so the figures align
 * visually; the reliability and confidence badges resolve their labels
 * through the canonical status metadata, and an unknown status string
 * degrades to the UNAVAILABLE ladder rung instead of crashing.
 */
function SavingsRowView({
  row,
  position,
}: {
  row: SavingsRow;
  position: number;
}) {
  const t = useTranslations('SavingsPage');
  const tRoot = useTranslations();

  const reliability = row.reliability in RELIABILITY_STATUS_META
    ? (row.reliability as keyof typeof RELIABILITY_STATUS_META)
    : 'UNAVAILABLE';
  const confidence = row.confidence in CONFIDENCE_LEVEL_META
    ? (row.confidence as keyof typeof CONFIDENCE_LEVEL_META)
    : null;

  return (
    <tr>
      <td className="py-2 pr-4 tabular-nums text-gray-400">{position}</td>
      <td className="py-2 pr-4">
        <span className="font-medium text-gray-900">{row.productName}</span>
        <span className="block text-xs text-gray-500">
          {row.merchant} · {row.merchantCountry}
        </span>
      </td>
      <td className="py-2 pr-4 font-semibold tabular-nums text-gray-900">
        {formatEuros(row.landedTotalCents)}
      </td>
      <td className="py-2 pr-4 tabular-nums text-gray-700">
        {formatEuros(row.alkoReferenceCents)}
      </td>
      <td className="py-2 pr-4 tabular-nums text-gray-700">
        {formatEuros(row.gapCents)}
        <span className="block text-xs text-gray-400">
          {t('gapBasisPoints', { value: row.gapBasisPoints })}
        </span>
      </td>
      <td className="py-2">
        <ReliabilityBadge status={reliability}>
          {tRoot(RELIABILITY_STATUS_META[reliability].labelKey)}
        </ReliabilityBadge>
        {confidence !== null && (
          <span className="ml-1.5 inline-flex">
            <ConfidenceBadge level={confidence}>
              {tRoot(CONFIDENCE_LEVEL_META[confidence].labelKey)}
            </ConfidenceBadge>
          </span>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Euros with two decimals — the same presentation as the offers table. */
function formatEuros(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

/** Locale-appropriate date for the snapshot day (as-of is data, not copy). */
function formatAsOf(iso: string, locale: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale === 'fi' ? 'fi-FI' : 'en-GB', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}
