'use client';

import type {
  CalculatorResult as CalculatorResultType,
  ConfidenceLevel,
  CostCategory,
  ReliabilityStatus,
} from '@/lib/types';
import DisclaimerBanner from './DisclaimerBanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents to a euro string. */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/** Icon and colour config for each confidence level. */
const CONFIDENCE_META: Record<
  ConfidenceLevel,
  { bg: string; text: string; label: string }
> = {
  HIGH: { bg: 'bg-green-100', text: 'text-green-800', label: 'High confidence' },
  MEDIUM: {
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    label: 'Medium confidence',
  },
  LOW: { bg: 'bg-red-100', text: 'text-red-800', label: 'Low confidence' },
};

/** Colour coding for reliability status badges. */
const RELIABILITY_BADGE: Record<
  ReliabilityStatus,
  { bg: string; text: string }
> = {
  VERIFIED: { bg: 'bg-green-50', text: 'text-green-700' },
  ESTIMATED: { bg: 'bg-amber-50', text: 'text-amber-700' },
  STALE: { bg: 'bg-red-50', text: 'text-red-700' },
  UNAVAILABLE: { bg: 'bg-gray-100', text: 'text-gray-500' },
};

/** Human-readable label for each cost category. */
const CATEGORY_LABEL: Record<CostCategory, string> = {
  foreignRetailPrice: 'Foreign retail price',
  transportCost: 'Transport cost',
  alcoholExciseEstimate: 'Alcohol excise estimate',
  containerDutyEstimate: 'Container duty estimate',
  otherCharges: 'Other charges',
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
  const badge = RELIABILITY_BADGE[reliability];
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-700">
        {CATEGORY_LABEL[category]}
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
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CalculatorResultProps {
  result: CalculatorResultType;
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
export default function CalculatorResult({ result }: CalculatorResultProps) {
  const meta = result.metadata;

  return (
    <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      {/* ── Heading ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {meta.productName}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {meta.quantity} unit{meta.quantity !== 1 ? 's' : ''} ×{' '}
            {meta.input.destination}
          </p>
        </div>
        <ConfidenceBadge level={result.confidence} />
      </div>

      {/* ── Itemized costs ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Cost breakdown
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
          <span className="text-sm font-semibold text-gray-900">Total</span>
          <span className="text-sm font-semibold tabular-nums text-gray-900">
            {formatEur(result.totalCents)}
          </span>
        </div>
      </div>

      {/* ── Confidence breakdown ── */}
      {result.confidenceBreakdown.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Data reliability
          </h3>
          <ul className="space-y-1">
            {result.confidenceBreakdown.map((detail, i) => {
              const badge = RELIABILITY_BADGE[detail.status];
              return (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span
                    className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      detail.status === 'VERIFIED'
                        ? 'bg-green-400'
                        : detail.status === 'ESTIMATED'
                          ? 'bg-amber-400'
                          : 'bg-red-400'
                    }`}
                  />
                  <span className="text-gray-600">{detail.detail}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Classification ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Transaction classification
        </h3>
        <p className="text-sm font-medium text-gray-800">
          {result.classification.classification}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          {result.classification.evidenceSummary}
        </p>
      </div>

      {/* ── Metadata ── */}
      <div className="rounded-md bg-gray-50 px-3 py-2">
        <dl className="space-y-1 text-xs text-gray-500">
          <div className="flex justify-between">
            <dt>Calculated at</dt>
            <dd className="tabular-nums">
              {new Date(meta.calculationTimestamp).toLocaleString('fi-FI')}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Dataset versions</dt>
            <dd className="tabular-nums">
              {meta.datasetVersions.length > 0
                ? meta.datasetVersions.join(', ')
                : '—'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Record ID</dt>
            <dd className="tabular-nums">#{result.calculationRecordId}</dd>
          </div>
        </dl>
      </div>

      {/* ── Disclaimer ── */}
      <DisclaimerBanner disclaimer={result.disclaimer} />
    </div>
  );
}