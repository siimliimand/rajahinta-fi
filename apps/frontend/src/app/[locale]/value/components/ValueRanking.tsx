'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { request } from '@/lib/api';
import type {
  UnitPriceRankingItem,
  UnitPriceRankingResponse,
} from '@/lib/types';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  ReliabilityBadge,
} from '@/components/ui';
import type { ValueCategoryKey } from '../categories';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The per-category €/g ranking table (trust-and-reach-roadmap task 7.2).
 *
 * Data comes from the age-gated `GET /api/v1/unitprice/ranking` through
 * the shared API client, so the visitor's confirmation cookie travels and
 * a 403 re-opens the age gate in place (the layout-wide AgeGate listens
 * for the client's recovery event). The API returns rows already in the
 * deterministic ascending order — this view renders that order verbatim
 * and sorts nothing of its own.
 *
 * Every row carries the standard reliability badge (canonical
 * VERIFIED/ESTIMATED presentation, labels resolved through the root
 * translator and RELIABILITY_STATUS_META — the same source of truth as
 * the compare view). An empty category renders the honest empty state;
 * rows are never invented.
 */
export default function ValueRanking({
  category,
}: {
  category: ValueCategoryKey;
}) {
  const t = useTranslations('ValuePage');
  const tCommon = useTranslations('Common');
  // Root translator: status labels resolve through the canonical labelKey
  // contract in RELIABILITY_STATUS_META.
  const tRoot = useTranslations();

  const [data, setData] = useState<UnitPriceRankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Bumping this value re-runs the effect — the retry affordance.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    request<UnitPriceRankingResponse>(
      `/api/v1/unitprice/ranking?category=${encodeURIComponent(category)}`,
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

  if (data === null || data.items.length === 0) {
    return <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />;
  }

  return (
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
              {t('columnEurPerGram')}
            </th>
            <th scope="col" className="pb-2 pr-4 font-medium">
              {t('columnEthanol')}
            </th>
            <th scope="col" className="pb-2 font-medium">
              {t('columnReliability')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.items.map((item, index) => (
            <RankingRow
              key={item.productId}
              item={item}
              position={index + 1}
              labelStatus={tRoot(
                RELIABILITY_STATUS_META[item.reliabilityStatus].labelKey,
              )}
              unitLabel={t('unit')}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

/**
 * One table row. Number columns are tabular-nums so the ascending values
 * align visually; the €/g presentation matches the compare view's
 * (toFixed(2) plus the localized unit).
 */
function RankingRow({
  item,
  position,
  labelStatus,
  unitLabel,
}: {
  item: UnitPriceRankingItem;
  position: number;
  labelStatus: string;
  unitLabel: string;
}) {
  return (
    <tr>
      <td className="py-2 pr-4 tabular-nums text-gray-400">{position}</td>
      <td className="py-2 pr-4">
        <span className="font-medium text-gray-900">{item.name}</span>
        {item.brand !== '' && (
          <span className="block text-xs text-gray-500">{item.brand}</span>
        )}
      </td>
      <td className="py-2 pr-4 font-semibold tabular-nums text-gray-900">
        {item.centsPerGram.toFixed(2)} {unitLabel}
      </td>
      <td className="py-2 pr-4 tabular-nums text-gray-700">
        {item.ethanolGrams.toFixed(1)} g
      </td>
      <td className="py-2">
        <ReliabilityBadge status={item.reliabilityStatus}>
          {labelStatus}
        </ReliabilityBadge>
      </td>
    </tr>
  );
}
