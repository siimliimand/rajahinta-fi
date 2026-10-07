'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format/money';
import type { EmpiricalMargin } from '@/lib/types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ConfidenceMeterProps {
  /**
   * The response's optional empirical margin (hedge-dedup-confidence-meter
   * 2.2). Absent renders NOTHING (design D4, render-nothing convention):
   * no placeholder, no dash, no zero — cold-start results without earned
   * outcome data show no meter at all, which is the honest state.
   */
  readonly margin?: EmpiricalMargin;
  /** The euro-cents total the margin qualifies (its own view's total). */
  readonly totalCents: number;
}

/**
 * Empirical-margin meter beside a result's hero total (task 4.1, change
 * hedge-dedup-confidence-meter, designs D3/D4).
 *
 * Display-only: renders ± € computed from the persisted quantile and the
 * total it qualifies (`p × total`, rounded to whole cents) with its basis
 * ALWAYS adjacent — the relative percent, the sample count, and the as-of
 * date — plus a one-click link to the methodology explanation (the same
 * /ranking destination the SiteFooter "Menetelmä" link uses). The meter
 * never interacts with totals, breakdowns, ordering, or inputs; it is a
 * secondary signal next to the confidence badge, in the quiet gray
 * vocabulary.
 *
 * The component is a pure function of its props: a non-finite quantile or
 * total renders nothing (a figure is never fabricated), and an absent
 * margin renders nothing — never a placeholder.
 *
 * @module ConfidenceMeter
 */
export default function ConfidenceMeter({
  margin,
  totalCents,
}: ConfidenceMeterProps) {
  const t = useTranslations('ConfidenceMeter');
  const locale = useLocale();

  if (margin === undefined) return null;
  if (!Number.isFinite(margin.quantile) || !Number.isFinite(totalCents)) {
    return null;
  }

  // p × total, rounded to whole cents — the only arithmetic on this path.
  const marginCents = Math.round(margin.quantile * totalCents);

  return (
    <p
      data-testid="confidence-meter"
      className="mt-2 text-xs leading-relaxed text-gray-500"
    >
      <span className="font-medium text-gray-600">{t('label')}:</span>{' '}
      <span className="text-sm font-semibold tabular-nums text-gray-700">
        ±{formatMoney(marginCents, locale)}
      </span>{' '}
      <span className="tabular-nums">
        ({t('percentLine', { percent: formatRelativePercent(margin.quantile, locale) })})
      </span>
      {' · '}
      <span className="tabular-nums">
        {t('sampleLine', { count: margin.sampleCount })}
      </span>
      {' · '}
      <span className="tabular-nums">
        {t('asOfLine', { date: formatAsOf(margin.asOf, locale) })}
      </span>
      {' · '}
      <Link
        href="/ranking"
        className="underline decoration-gray-300 underline-offset-2 hover:text-gray-700"
      >
        {t('methodologyLink')}
      </Link>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * The quantile as a relative percent at one decimal — the figure is a
 * fraction in [0, 1]; percent form mirrors the AccuracyStat share
 * convention (fi comma decimals, space before %).
 */
function formatRelativePercent(quantile: number, locale: string): string {
  const formatted = (quantile * 100).toFixed(1);
  return locale === 'fi' ? formatted.replace('.', ',') : formatted;
}

/**
 * The as-of instant as a localized numeric calendar date — the
 * AccuracyStat `toLocaleDateString` pattern (fi-FI / en-GB). An
 * unparseable value renders verbatim: the raw string is data, never
 * invented copy (date-formatter module precedent).
 */
function formatAsOf(asOf: string, locale: string): string {
  if (Number.isNaN(Date.parse(asOf))) return asOf;
  return new Date(asOf).toLocaleDateString(locale === 'fi' ? 'fi-FI' : 'en-GB', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}
