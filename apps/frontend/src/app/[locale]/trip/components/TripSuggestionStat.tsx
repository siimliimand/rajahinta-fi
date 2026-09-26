'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  getCategorySavings,
  type CategorySavingsRow,
} from '@/lib/api';

/** The snapshot category the suggestion summarizes (spec example: beers). */
const SUGGESTION_CATEGORY = 'beer';

/** The derived, render-ready suggestion figure. */
export interface TripSuggestionStatValue {
  /** Seller country the rows cover (ISO 3166-1 alpha-2). */
  readonly country: string;
  /** Average observed saving in percent, one decimal. */
  readonly averageSavingPercent: number;
  /** ISO date (YYYY-MM-DD) of the snapshot day the figures come from. */
  readonly asOf: string;
}

/**
 * Derive the factual suggestion from one snapshot day (pure — unit
 * testable without a fetch).
 *
 * Coverage rule: the best-covered merchant country wins (most rows;
 * alphabetical code breaks ties deterministically). Honesty rule: the
 * average gap across that country's rows must be an actual saving
 * (negative basis points) — anything else renders nothing, never a
 * placeholder or a negative "saving". Display-only by contract: the
 * returned figure never enters any calculation or ranking input.
 */
export function deriveTripSuggestion(
  rows: readonly CategorySavingsRow[],
  asOf: string | null,
): TripSuggestionStatValue | null {
  if (asOf === null || rows.length === 0) return null;

  const byCountry = new Map<string, { count: number; gapSumBp: number }>();
  for (const row of rows) {
    const entry = byCountry.get(row.merchantCountry) ?? {
      count: 0,
      gapSumBp: 0,
    };
    entry.count += 1;
    entry.gapSumBp += row.gapBasisPoints;
    byCountry.set(row.merchantCountry, entry);
  }

  let best: { country: string; count: number; avgGapBp: number } | null = null;
  for (const [country, { count, gapSumBp }] of byCountry) {
    const better =
      best === null ||
      count > best.count ||
      (count === best.count && country < best.country);
    if (better) {
      best = { country, count, avgGapBp: gapSumBp / count };
    }
  }

  if (best === null || best.avgGapBp >= 0) return null;
  return {
    country: best.country,
    averageSavingPercent: Math.round((-best.avgGapBp / 100) * 10) / 10,
    asOf,
  };
}

/**
 * Factual savings-snapshot suggestion (task 5.3, change
 * client-experience-improvement): a self-contained display-only island
 * in the AccuracyStat pattern. It fetches the latest materialized day
 * for one category and renders one factual sentence with its as-of
 * window. Without covering data — empty day, fetch failure, or no
 * average saving — it renders NOTHING.
 */
export default function TripSuggestionStat() {
  const t = useTranslations('TripPage');
  const tCommon = useTranslations('Common');
  const locale = useLocale();
  const [stat, setStat] = useState<TripSuggestionStatValue | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCategorySavings(SUGGESTION_CATEGORY)
      .then((res) => {
        if (!cancelled) {
          setStat(deriveTripSuggestion(res.rows, res.asOf));
        }
      })
      .catch(() => {
        // Honest absence on any failure — the suggestion is never worth
        // an error surface.
        if (!cancelled) setStat(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (stat === null) return null;

  // The as-of is data, not copy: locale-appropriate calendar date, with
  // the raw ISO string as the fallback.
  const asOfDate = new Date(`${stat.asOf}T00:00:00Z`);
  const dateLabel = Number.isNaN(asOfDate.getTime())
    ? stat.asOf
    : asOfDate.toLocaleDateString(locale === 'fi' ? 'fi-FI' : 'en-GB', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      });

  return (
    <aside
      data-testid="trip-suggestion"
      className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600"
    >
      {t('suggestion.stat', {
        country: tCommon(`countries.${stat.country}`),
        percent: stat.averageSavingPercent,
        date: dateLabel,
      })}
    </aside>
  );
}
