'use client';

import { useTranslations } from 'next-intl';
import type {
  CalculatorResult as CalculatorResultType,
  ConfidenceLevel,
  CostCategory,
  ReliabilityStatus,
  DataFreshnessEntry,
  RetailOffer,
} from '@/lib/types';
import { logClick } from '@/lib/api';
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

/** Icon and colour config for each confidence level. */
const CONFIDENCE_META: Record<ConfidenceLevel, { bg: string; text: string }> = {
  HIGH: { bg: 'bg-green-100', text: 'text-green-800' },
  MEDIUM: { bg: 'bg-amber-100', text: 'text-amber-800' },
  LOW: { bg: 'bg-red-100', text: 'text-red-800' },
};

/** Colour coding for reliability status badges. */
const RELIABILITY_BADGE: Record<
  ReliabilityStatus,
  { bg: string; text: string }
> = {
  VERIFIED: { bg: 'bg-green-50', text: 'text-green-700' },
  ESTIMATED: { bg: 'bg-amber-50', text: 'text-amber-700' },
  STALE: { bg: 'bg-orange-50', text: 'text-orange-700' },
  UNAVAILABLE: { bg: 'bg-red-50', text: 'text-red-700' },
};

/** Dot colour for each reliability status. */
const RELIABILITY_DOT: Record<ReliabilityStatus, string> = {
  VERIFIED: 'bg-green-400',
  ESTIMATED: 'bg-amber-400',
  STALE: 'bg-orange-400',
  UNAVAILABLE: 'bg-red-400',
};

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
  const badge = RELIABILITY_BADGE[reliability];
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-700">
        {t(`category.${category}`)}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums text-gray-600">
          {formatEur(cents)}
        </span>
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase leading-tight ${badge.bg} ${badge.text}`}
        >
          {reliability}
        </span>
      </div>
    </div>
  );
}

/** Confidence badge with label. */
function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const tCommon = useTranslations('Common');
  const meta = CONFIDENCE_META[level];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.text}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          level === 'HIGH'
            ? 'bg-green-500'
            : level === 'MEDIUM'
              ? 'bg-amber-500'
              : 'bg-red-500'
        }`}
      />
      {tCommon(`confidence.${level}`)}
    </span>
  );
}

/** A single data-freshness line with color-coded badge. */
function FreshnessLine({
  label,
  status,
  timestamp,
  detail,
}: DataFreshnessEntry) {
  const tCommon = useTranslations('Common');
  const badge = RELIABILITY_BADGE[status];
  const dot = RELIABILITY_DOT[status];
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="text-sm text-gray-700">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {timestamp && (
          <span className="text-xs text-gray-400">
            {new Date(timestamp).toLocaleString('fi-FI')}
          </span>
        )}
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase leading-tight ${badge.bg} ${badge.text}`}
        >
          {tCommon(`reliability.${status}`)}
        </span>
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
  const tCommon = useTranslations('Common');
  const meta = result.metadata;
  const freshnessEntries = useFreshnessEntries(result);

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
        <ConfidenceBadge level={result.confidence} />
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
                  className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${RELIABILITY_DOT[detail.status]}`}
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
