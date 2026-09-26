'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type {
  AlkoBenchmark,
  CalculatorResult as CalculatorResultType,
  ReliabilityStatus,
} from '@/lib/types';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';
import { ReliabilityBadge } from '@/components/ui';
import DisclaimerBanner from './DisclaimerBanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents to a euro string. */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/**
 * Signed variant for the benchmark gap — the API's sign convention is
 * positive when the calculated offer costs more than the reference, so
 * the sign stays visible even at zero or negative figures (WhatIfResult
 * precedent).
 */
function formatSignedEur(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
  return `${sign}${formatEur(Math.abs(cents))}`;
}

/** Signed percent at one decimal — matches the API's rounding precision. */
function formatSignedPercent(percent: number): string {
  const sign = percent > 0 ? '+' : percent < 0 ? '-' : '';
  return `${sign}${Math.abs(percent).toFixed(1)} %`;
}

/**
 * Reliability badge composed from the canonical status module: label key
 * from `@/lib/design/status`, rendering from the ui primitive. Meaning
 * rides on the visible label (and the badge's grayscale-safe icon), never
 * on hue alone.
 */
function LocalizedReliabilityBadge({ status }: { status: ReliabilityStatus }) {
  const t = useTranslations();
  return (
    <ReliabilityBadge status={status}>
      {t(RELIABILITY_STATUS_META[status].labelKey)}
    </ReliabilityBadge>
  );
}

/**
 * Plain cheaper/dearer statement for the Finland comparison. Rendered as
 * text next to the signed figure — the direction of the difference is
 * never conveyed by color alone (design.md presentation invariant).
 */
function benchmarkPostureKey(
  benchmark: AlkoBenchmark,
): 'alkoCheaper' | 'importCheaper' | 'samePrice' {
  if (benchmark.differenceCents > 0) return 'alkoCheaper';
  if (benchmark.differenceCents < 0) return 'importCheaper';
  return 'samePrice';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ResultCardProps {
  /** The calculation result from the API — the card's only data source. */
  readonly result: CalculatorResultType;
}

/**
 * Answer-first result card (price-intelligence-roadmap task 4.1).
 *
 * Presentation contract (change spec "Result presentation"):
 *   1. The estimated landed cost is the prominent figure at the top.
 *   2. The Finland comparison follows — explicit "cheaper/dearer" text
 *      together with the signed figure, never color alone.
 *   3. The itemized breakdown renders beneath, every figure straight from
 *      the result object with its category label (traceability).
 *   4. The price-data reliability status (via `RELIABILITY_STATUS_META`)
 *      and the calculation timestamp are surfaced on the card.
 *   5. The structural disclaimer is consumed from the result object —
 *      the card never restates disclaimer copy as a UI string.
 *
 * No confidence score is invented here: reliability comes from the
 * result's own statuses, confidence display stays with the existing
 * breakdown components.
 */
export default function ResultCard({ result }: ResultCardProps) {
  const t = useTranslations('CalculatorResult');
  const tCommon = useTranslations('Common');
  const meta = result.metadata;
  const benchmark = result.alkoBenchmark;

  // The price data feeding the result: the retail line's own reliability
  // status. Rendered with the calculation timestamp — the same freshness
  // pairing the itemized freshness section uses (no per-line observedAt
  // exists on the API result object).
  const priceLine = result.itemizedCosts.find(
    (cost) => cost.category === 'foreignRetailPrice',
  );

  return (
    <div
      className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="result-card"
    >
      {/* ── Answer-first: the estimated landed cost ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('total')}
        </p>
        <p
          data-testid="landed-cost-total"
          className="tabular-money mt-1 text-4xl font-extrabold text-gray-900"
        >
          {formatEur(result.totalCents)}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          {t('unitsTimesDestination', {
            count: meta.quantity,
            destination: meta.input.destination,
          })}
        </p>
      </div>

      {/* ── Price-data reliability + timestamp (status via the canonical
          meta map — label and icon carry the meaning, not hue) ── */}
      {priceLine && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="price-reliability"
        >
          <LocalizedReliabilityBadge status={priceLine.reliability} />
          <span className="text-xs text-gray-500">
            {tCommon('calculatedAt')}{' '}
            <time dateTime={meta.calculationTimestamp}>
              {new Date(meta.calculationTimestamp).toLocaleString('fi-FI')}
            </time>
          </span>
        </div>
      )}

      {/* ── Finland comparison — display-only, never a cost line: explicit
          posture text WITH the signed figure, before the breakdown ── */}
      {benchmark && (
        <div
          className="rounded-md bg-gray-50 px-3 py-2"
          data-testid="finland-comparison"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('alkoBenchmark.label')}
            </span>
            <LocalizedReliabilityBadge status={benchmark.reliabilityStatus} />
          </div>
          <p
            data-testid="comparison-posture"
            className="mt-1 text-sm font-semibold text-gray-900"
          >
            {t(`alkoBenchmark.${benchmarkPostureKey(benchmark)}`)}
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-gray-700">
              {t('alkoBenchmark.referencePrice', {
                price: formatEur(benchmark.referencePriceCents),
              })}
            </span>
            <span
              data-testid="comparison-figure"
              className="text-sm tabular-nums text-gray-600"
            >
              {t('alkoBenchmark.difference', {
                difference: formatSignedEur(benchmark.differenceCents),
                percent: formatSignedPercent(benchmark.differencePercent),
              })}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {t('alkoBenchmark.observedAt', {
              timestamp: new Date(benchmark.observedAt).toLocaleString('fi-FI'),
            })}
          </p>
        </div>
      )}

      {/* ── Breakdown beneath the answer — figures verbatim from the
          result object, labeled by category so every number stays
          traceable to its input ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('costBreakdown')}
        </h3>
        <div className="divide-y divide-gray-100">
          {result.itemizedCosts.map((cost, i) => (
            <div
              key={`${cost.category}-${i}`}
              className="flex items-center justify-between py-1.5"
            >
              <span className="text-sm text-gray-700">
                {t(`category.${cost.category}`)}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm tabular-nums text-gray-600">
                  {formatEur(cost.cents)}
                </span>
                <LocalizedReliabilityBadge status={cost.reliability} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Structural disclaimer — consumed from the result object ── */}
      <DisclaimerBanner disclaimer={result.disclaimer} />
    </div>
  );
}
