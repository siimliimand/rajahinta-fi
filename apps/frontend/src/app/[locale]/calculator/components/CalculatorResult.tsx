'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type {
  CalculatorResult as CalculatorResultType,
  CostCategory,
  ReliabilityStatus,
  DataFreshnessEntry,
  RetailOffer,
} from '@/lib/types';
import { logClick } from '@/lib/api';
import {
  CONFIDENCE_LEVEL_META,
  RELIABILITY_STATUS_META,
} from '@/lib/design/status';
import { ConfidenceBadge, ReliabilityBadge } from '@/components/ui';
import { MerchantLink } from '../../compare/components/MerchantLink';
import DisclaimerBanner from './DisclaimerBanner';
import ReportExportActions from './ReportExportActions';

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
 * from `@/lib/design/status`, rendering from the ui primitive. This is the
 * adoption pattern for every component that used to keep its own
 * RELIABILITY_BADGE map.
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
 * Wire shape of the optional Alko benchmark. Declared locally and read
 * through a narrow lookup instead of `@/lib/types` — this task's touch
 * set is this component plus the catalogs, the same rule the flag
 * readers apply while the shared client type lags the API contract.
 * The backend emits the key only when a reference exists, so presence
 * implies the `'available'` variant.
 */
interface AlkoBenchmarkView {
  readonly status: 'available';
  readonly referencePriceCents: number;
  readonly differenceCents: number;
  readonly differencePercent: number;
  readonly reliabilityStatus: ReliabilityStatus;
  readonly observedAt: string;
}

/**
 * The display-only Alko benchmark comparison. A separate section below
 * the itemized breakdown — never inside the total row — because the
 * reference is not a cost component of the landed cost.
 */
function AlkoBenchmarkLine({ benchmark }: { benchmark: AlkoBenchmarkView }) {
  const t = useTranslations('CalculatorResult');
  const postureKey =
    benchmark.differenceCents > 0
      ? 'alkoCheaper'
      : benchmark.differenceCents < 0
        ? 'importCheaper'
        : 'samePrice';
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2" data-testid="alko-benchmark">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('alkoBenchmark.label')}
        </span>
        <LocalizedReliabilityBadge status={benchmark.reliabilityStatus} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-sm text-gray-700">
          {t('alkoBenchmark.referencePrice', {
            price: formatEur(benchmark.referencePriceCents),
          })}
        </span>
        <span className="text-sm tabular-nums text-gray-600">
          {t('alkoBenchmark.difference', {
            difference: formatSignedEur(benchmark.differenceCents),
            percent: formatSignedPercent(benchmark.differencePercent),
          })}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {t(`alkoBenchmark.${postureKey}`)} ·{' '}
        {t('alkoBenchmark.observedAt', {
          timestamp: new Date(benchmark.observedAt).toLocaleString('fi-FI'),
        })}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A single itemized cost line. */
function CostLine({
  category,
  cents,
  reliability,
}: {
  category: CostCategory;
  cents: number;
  reliability: ReliabilityStatus;
}) {
  const t = useTranslations('CalculatorResult');
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-700">
        {t(`category.${category}`)}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums text-gray-600">
          {formatEur(cents)}
        </span>
        <LocalizedReliabilityBadge status={reliability} />
      </div>
    </div>
  );
}

/** A single data-freshness line with color-coded badge. */
function FreshnessLine({
  label,
  status,
  timestamp,
  detail,
}: DataFreshnessEntry) {
  const dot = RELIABILITY_STATUS_META[status].dot;
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 shrink-0 ${dot}`} />
        <span className="text-sm text-gray-700">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {timestamp && (
          <span className="text-xs text-gray-400">
            {new Date(timestamp).toLocaleString('fi-FI')}
          </span>
        )}
        <LocalizedReliabilityBadge status={status} />
        {detail && (
          <span className="hidden text-xs text-gray-400 sm:inline">{detail}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Build data-freshness entries from a calculation result.
 *
 * Derives freshness information from the itemized costs and metadata.
 * Each externally sourced fact (price, transport, tax rates) gets a
 * reliability status and a display label.
 */
function useFreshnessEntries(result: CalculatorResultType): DataFreshnessEntry[] {
  const t = useTranslations('CalculatorResult');
  const entries: DataFreshnessEntry[] = [];
  const meta = result.metadata;

  for (const cost of result.itemizedCosts) {
    const label = t(`category.${cost.category}`);
    entries.push({
      label,
      status: cost.reliability,
      timestamp: meta.calculationTimestamp,
      detail: '',
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CalculatorResultProps {
  readonly result: CalculatorResultType;
  /** Optional retail offers for rendering merchant outbound links */
  readonly offers?: readonly RetailOffer[];
}

/**
 * Full itemized breakdown of a landed-cost calculation result.
 *
 * Displays:
 *  - Individual cost lines with reliability badges
 *  - Total
 *  - Confidence level with indicator
 *  - Calculation metadata (timestamp, dataset versions)
 *  - Structural disclaimer banner
 */
export default function CalculatorResult({ result, offers }: CalculatorResultProps) {
  const t = useTranslations('CalculatorResult');
  const tAll = useTranslations();
  const tCommon = useTranslations('Common');
  const meta = result.metadata;
  const freshnessEntries = useFreshnessEntries(result);
  const benchmark = (
    result as CalculatorResultType & { alkoBenchmark?: AlkoBenchmarkView }
  ).alkoBenchmark;

  return (
    <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      {/* ── Heading ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {meta.productName}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {t('unitsTimesDestination', {
              count: meta.quantity,
              destination: meta.input.destination,
            })}
          </p>
        </div>
        <ConfidenceBadge level={result.confidence}>
          {tAll(CONFIDENCE_LEVEL_META[result.confidence].labelKey)}
        </ConfidenceBadge>
      </div>

      {/* ── Itemized costs ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('costBreakdown')}
        </h3>
        <div className="divide-y divide-gray-100">
          {result.itemizedCosts.map((cost, i) => (
            <CostLine
              key={`${cost.category}-${i}`}
              category={cost.category}
              cents={cost.cents}
              reliability={cost.reliability}
            />
          ))}
        </div>
        {/* Total line */}
        <div className="flex items-center justify-between border-t border-gray-300 pt-3">
          <span className="text-sm font-semibold text-gray-900">
            {t('total')}
          </span>
          <span className="text-sm font-semibold tabular-nums text-gray-900">
            {formatEur(result.totalCents)}
          </span>
        </div>
      </div>

      {/* ── Alko benchmark — display-only comparison, not a cost line:
          renders nothing when the result carries no reference ── */}
      {benchmark && <AlkoBenchmarkLine benchmark={benchmark} />}

      {/* ── Confidence breakdown ── */}
      {result.confidenceBreakdown.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {tCommon('dataReliability')}
          </h3>
          <ul className="space-y-1">
            {result.confidenceBreakdown.map((detail, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 ${RELIABILITY_STATUS_META[detail.status].dot}`}
                />
                <span className="text-gray-600">{detail.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Data freshness ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('dataFreshness')}
        </h3>
        <div className="divide-y divide-gray-100 rounded-md border border-gray-100 px-3 py-1">
          {freshnessEntries.length > 0 ? (
            freshnessEntries.map((entry, i) => (
              <FreshnessLine
                key={`${entry.label}-${i}`}
                label={entry.label}
                status={entry.status}
                timestamp={entry.timestamp}
                detail={entry.detail}
              />
            ))
          ) : (
            <p className="py-2 text-xs text-gray-400">{t('noFreshnessData')}</p>
          )}
        </div>
        {meta.datasetVersions.length > 0 && (
          <p className="mt-1 text-xs text-gray-400">
            {t('taxRateDataset', { versions: meta.datasetVersions.join(', ') })}
          </p>
        )}
      </div>

      {/* ── Classification ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('transactionClassification')}
        </h3>
        <p className="text-sm font-medium text-gray-800">
          {result.classification.classification === 'NotPersisted'
            ? t('notStored')
            : result.classification.classification}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          {result.classification.evidenceSummary}
        </p>
      </div>

      {/* ── Merchant offers ── */}
      {offers && offers.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t('availableAt')}
          </h3>
          <ul className="space-y-1">
            {offers.map((offer) =>
              offer.sourceUrl ? (
                <li key={offer.id}>
                  <MerchantLink
                    label={t('viewAt', { merchant: offer.merchant })}
                    offerId={offer.id}
                    onClick={() => {
                      logClick(offer.merchant, offer.sourceUrl!);
                    }}
                    className="text-xs text-primary-600 hover:text-primary-800"
                  />
                </li>
              ) : null,
            )}
          </ul>
        </div>
      )}

      {/* ── Metadata ── */}
      <div className="rounded-md bg-gray-50 px-3 py-2">
        <dl className="space-y-1 text-xs text-gray-500">
          <div className="flex justify-between">
            <dt>{tCommon('calculatedAt')}</dt>
            <dd className="tabular-nums">
              {new Date(meta.calculationTimestamp).toLocaleString('fi-FI')}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>{tCommon('datasetVersions')}</dt>
            <dd className="tabular-nums">
              {meta.datasetVersions.length > 0
                ? meta.datasetVersions.join(', ')
                : '—'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>{tCommon('recordId')}</dt>
            <dd className="tabular-nums">#{result.calculationRecordId}</dd>
          </div>
        </dl>
      </div>

      {/* ── Report export actions — hidden and unfetched while the
          enable_advanced_features flag is off ── */}
      <ReportExportActions recordId={result.calculationRecordId} />

      {/* ── Disclaimer ── */}
      <DisclaimerBanner disclaimer={result.disclaimer} />
    </div>
  );
}
