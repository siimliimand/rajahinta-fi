'use client';

/**
 * MerchantFreshnessSection — factual per-merchant data-freshness display
 * for compare product columns (task 4.3, change phase2-advanced-features).
 *
 * Behaviour:
 *  - `enable_advanced_features` off ⇒ the section renders nothing and the
 *    reliability request is never fired. A failed flag lookup also
 *    degrades to hidden. An empty merchant list also renders nothing.
 *  - Data comes from GET /api/v1/merchants/reliability via a single-flight
 *    cached client, so N product columns share one request.
 *  - Neutrality: every merchant row is styled identically — factual
 *    fields only (offer count, per-status shares as percentages in a
 *    fixed status order, freshest observation, governance status,
 *    computation timestamp). The display never alters, feeds, or suggests
 *    a change to the objective sort order.
 *  - Failures degrade to hidden — the freshness display is informational
 *    and must not interrupt the comparison.
 *
 * @module MerchantFreshnessSection
 */

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  MerchantReliabilityScore,
  ReliabilityStatus,
} from '@/lib/types';
import { getMerchantReliability } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed status display order — identical for every merchant row. */
const STATUS_ORDER: readonly ReliabilityStatus[] = [
  'VERIFIED',
  'ESTIMATED',
  'STALE',
  'UNAVAILABLE',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an exact share ratio [0, 1] as a whole-percent string. */
function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Format an ISO timestamp with the fi-FI locale conventions used elsewhere. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('fi-FI', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MerchantFreshnessSectionProps {
  /** Merchant names whose offers surface for this product (sorted). */
  readonly merchants: readonly string[];
}

export default function MerchantFreshnessSection({
  merchants,
}: MerchantFreshnessSectionProps) {
  const t = useTranslations('MerchantFreshness');
  const tAll = useTranslations();
  const tCommon = useTranslations('Common');
  // Flag state is inlined with the initial HTML payload (task 9.4).
  const flags = useFeatureFlags();
  const flagEnabled = flags.flags.ADVANCED_FEATURES;
  const [scores, setScores] = useState<
    Readonly<Record<string, MerchantReliabilityScore>>
  >({});

  // ── Reliability fetch — guarded by the flag and a non-empty list ──
  useEffect(() => {
    if (!flagEnabled || merchants.length === 0) return;
    let cancelled = false;

    getMerchantReliability()
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, MerchantReliabilityScore> = {};
        for (const score of res.merchants) {
          map[score.merchant] = score;
        }
        setScores(map);
      })
      .catch(() => {
        // Informational display — degrade to hidden, not an error state.
      });

    return () => {
      cancelled = true;
    };
  }, [flagEnabled, merchants]);

  // ── Hidden states: flag off in the inlined payload, no merchants/data ──
  if (!flagEnabled || merchants.length === 0) {
    return null;
  }
  const visible = merchants.filter((m) => scores[m] !== undefined);
  if (visible.length === 0) {
    return null;
  }

  return (
    <div
      className="rounded-md border border-gray-100 px-3 py-2"
      data-testid="merchant-freshness"
    >
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t('title')}
      </h4>
      <ul className="mt-1.5 space-y-1.5" data-testid="merchant-freshness-list">
        {visible.map((merchant) => {
          const score = scores[merchant];
          const shares = STATUS_ORDER.filter(
            (s) => score.statusCounts[s] > 0,
          ).map(
            (s) =>
              // Status labels resolve through the canonical status module's
              // labelKeys, the same source every other status badge uses.
              `${tAll(RELIABILITY_STATUS_META[s].labelKey)} ${formatShare(score.statusShares[s])}`,
          );

          return (
            <li
              key={merchant}
              className="text-xs text-gray-500"
              data-testid="merchant-freshness-row"
            >
              <span className="font-medium text-gray-700">{merchant}</span>
              {' — '}
              {tCommon('offerCount', { count: score.offerCount })}
              {shares.length > 0 && ` · ${shares.join(' · ')}`}
              {score.freshestObservedAt !== null && (
                <> · {t('freshest', { date: formatTimestamp(score.freshestObservedAt) })}</>
              )}
              {' · '}
              {t('governanceLabel', {
                status: t(`governance.${score.governancePermissionStatus}`),
              })}
              {' · '}
              {t('computed', { date: formatTimestamp(score.computedAt) })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
