'use client';

/**
 * BasketResults — recommended combination and cost-ordered alternatives.
 *
 * Renders the optimization result with:
 *  - Per-store cards: merchant name, country, per-item costs with reliability
 *    badges, consolidated transport (weight tier, package tier, reliability),
 *    retail subtotal, minimum-order threshold check.
 *  - Aggregate confidence with per-data-point breakdown.
 *  - Structural disclaimer from the API response (never a UI-only string).
 *  - Up to three alternatives with identical styling — zero visual preference
 *    cues beyond objective cost ordering.
 *
 * All badge/freshness conventions match the existing calculator result view
 * (see CalculatorResult.tsx): color-coded reliability badges (green = VERIFIED,
 * amber = ESTIMATED, orange = STALE, red = UNAVAILABLE), confidence dot indicators.
 *
 * @module BasketResults
 */

import type {
  BasketOptimizationResult,
  BasketShipment,
  ConsolidatedTransport,
  ConsolidatedTransportReliability,
  MinimumOrderThresholdCheck,
} from '@/lib/basket.types';
import type {
  ConfidenceLevel,
  ReliabilityStatus,
} from '@/lib/types';
import DisclaimerBanner from '../../calculator/components/DisclaimerBanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents to a euro string. */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/** Colour coding for reliability status badges (matches CalculatorResult). */
const RELIABILITY_BADGE: Record<ReliabilityStatus, { bg: string; text: string }> = {
  VERIFIED: { bg: 'bg-green-50', text: 'text-green-700' },
  ESTIMATED: { bg: 'bg-amber-50', text: 'text-amber-700' },
  STALE: { bg: 'bg-orange-50', text: 'text-orange-700' },
  UNAVAILABLE: { bg: 'bg-red-50', text: 'text-red-700' },
};

/** Colour for reliability dot indicators (matches CalculatorResult). */
const RELIABILITY_DOT: Record<ReliabilityStatus, string> = {
  VERIFIED: 'bg-green-400',
  ESTIMATED: 'bg-amber-400',
  STALE: 'bg-orange-400',
  UNAVAILABLE: 'bg-red-400',
};

/** Human-readable labels for reliability (matches CalculatorResult). */
const RELIABILITY_LABEL: Record<ReliabilityStatus, string> = {
  VERIFIED: 'Verified',
  ESTIMATED: 'Estimated',
  STALE: 'Stale',
  UNAVAILABLE: 'Unavailable',
};

/** Label for consolidated transport reliability. */
const TRANSPORT_RELIABILITY_LABEL: Record<ConsolidatedTransportReliability, string> = {
  EXACT: 'Exact',
  ESTIMATED: 'Estimated',
  PARTIAL: 'Partial',
};

/** Transport reliability badge colours. */
const TRANSPORT_RELIABILITY_BADGE: Record<
  ConsolidatedTransportReliability,
  { bg: string; text: string }
> = {
  EXACT: { bg: 'bg-green-50', text: 'text-green-700' },
  ESTIMATED: { bg: 'bg-amber-50', text: 'text-amber-700' },
  PARTIAL: { bg: 'bg-red-50', text: 'text-red-700' },
};

/** Confidence indicator colours (matches CalculatorResult). */
const CONFIDENCE_META: Record<
  ConfidenceLevel,
  { bg: string; text: string; dot: string; label: string }
> = {
  HIGH: {
    bg: 'bg-green-50',
    text: 'text-green-800',
    dot: 'bg-green-500',
    label: 'High confidence',
  },
  MEDIUM: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    dot: 'bg-amber-500',
    label: 'Medium confidence',
  },
  LOW: {
    bg: 'bg-red-50',
    text: 'text-red-800',
    dot: 'bg-red-500',
    label: 'Low confidence',
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Reliability badge reusing the calculator's visual convention. */
function ReliabilityBadge({ status }: { status: ReliabilityStatus }) {
  const badge = RELIABILITY_BADGE[status];
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase leading-tight ${badge.bg} ${badge.text}`}
    >
      {RELIABILITY_LABEL[status]}
    </span>
  );
}

/** Transport reliability badge. */
function TransportReliabilityBadge({
  reliability,
}: {
  reliability: ConsolidatedTransportReliability;
}) {
  const badge = TRANSPORT_RELIABILITY_BADGE[reliability];
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase leading-tight ${badge.bg} ${badge.text}`}
    >
      {TRANSPORT_RELIABILITY_LABEL[reliability]}
    </span>
  );
}

/** Confidence badge matching the calculator's ConfidenceBadge component. */
function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const meta = CONFIDENCE_META[level];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

/** Threshold check line. */
function ThresholdCheckLine({
  thresholdCheck,
}: {
  thresholdCheck: MinimumOrderThresholdCheck;
}) {
  if (thresholdCheck.minimumOrderValueCents === null) {
    return (
      <p className="text-xs text-gray-400">
        Minimum order threshold: unknown
      </p>
    );
  }
  const meets = thresholdCheck.meetsThreshold;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500">
        Minimum order: {formatEur(thresholdCheck.minimumOrderValueCents)}
      </span>
      {meets ? (
        <span className="text-green-700">Met</span>
      ) : (
        <span className="text-red-700">Not met</span>
      )}
      {thresholdCheck.termsReliability && (
        <span className="text-gray-400">
          ({thresholdCheck.termsReliability})
        </span>
      )}
    </div>
  );
}

/** Consolidated transport section for a shipment. */
function TransportSection({
  transport,
}: {
  transport: ConsolidatedTransport;
}) {
  return (
    <div className="mt-3 rounded-md bg-gray-50 px-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-700">
            Transport
          </p>
          <p className="text-xs text-gray-500">
            {transport.weightTier} · {transport.packageTier}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-gray-700">
            {formatEur(transport.totalCents)}
          </span>
          <TransportReliabilityBadge reliability={transport.reliability} />
        </div>
      </div>
    </div>
  );
}

/** Per-item cost line in a shipment. */
function ShipmentItemCost({
  label,
  cents,
  reliability,
}: {
  label: string;
  cents: number;
  reliability: ReliabilityStatus;
}) {
  const dot = RELIABILITY_DOT[reliability];
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
        />
        <span className="text-sm text-gray-700">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums text-gray-600">
          {formatEur(cents)}
        </span>
        <ReliabilityBadge status={reliability} />
      </div>
    </div>
  );
}

/** One shipment card (per merchant/store). */
function ShipmentCard({ shipment }: { shipment: BasketShipment }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {/* Merchant header */}
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {shipment.merchant}
          </h3>
          <p className="text-xs text-gray-500">
            {shipment.country}
          </p>
        </div>
        <span className="text-sm font-semibold tabular-nums text-gray-900">
          {formatEur(shipment.retailSubtotalCents)}
        </span>
      </div>

      {/* Per-item costs */}
      <div className="divide-y divide-gray-100">
        {shipment.items.map((item, i) => (
          <ShipmentItemCost
            key={`${item.label}-${i}`}
            label={item.label}
            cents={item.cents}
            reliability={item.reliability}
          />
        ))}
      </div>

      {/* Transport */}
      <TransportSection transport={shipment.consolidatedTransport} />

      {/* Threshold check */}
      <div className="mt-2">
        <ThresholdCheckLine thresholdCheck={shipment.thresholdCheck} />
      </div>
    </div>
  );
}

/** Confidence breakdown list. */
function ConfidenceBreakdown({
  breakdown,
}: {
  breakdown: readonly {
    readonly status: ReliabilityStatus;
    readonly detail: string;
    readonly inputName?: string;
  }[];
}) {
  if (breakdown.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Data reliability
      </h3>
      <ul className="space-y-1">
        {breakdown.map((detail, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span
              className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${RELIABILITY_DOT[detail.status]}`}
            />
            <span className="text-gray-600">{detail.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Metadata section for a result or alternative. */
function ResultMetadata({
  metadata,
}: {
  metadata: {
    readonly calculationTimestamp: string;
    readonly datasetVersions: readonly string[];
    readonly calculationRecordId: number | null;
  };
}) {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2">
      <dl className="space-y-1 text-xs text-gray-500">
        <div className="flex justify-between">
          <dt>Calculated at</dt>
          <dd className="tabular-nums">
            {new Date(metadata.calculationTimestamp).toLocaleString('fi-FI')}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Dataset versions</dt>
          <dd className="tabular-nums">
            {metadata.datasetVersions.length > 0
              ? metadata.datasetVersions.join(', ')
              : '—'}
          </dd>
        </div>
        {metadata.calculationRecordId !== null && (
          <div className="flex justify-between">
            <dt>Record ID</dt>
            <dd className="tabular-nums">#{metadata.calculationRecordId}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** Single optimization combination (recommended or alternative). */
function OptimizationCombination({
  shipments,
  totalCents,
  confidence,
  confidenceBreakdown,
  disclaimer,
  metadata,
  heading,
}: {
  readonly shipments: readonly BasketShipment[];
  readonly totalCents: number;
  readonly confidence: ConfidenceLevel;
  readonly confidenceBreakdown: readonly {
    readonly status: ReliabilityStatus;
    readonly detail: string;
    readonly inputName?: string;
  }[];
  readonly disclaimer: {
    readonly text: string;
    readonly language: 'fi' | 'en';
    readonly version: string;
  };
  readonly metadata: {
    readonly calculationTimestamp: string;
    readonly datasetVersions: readonly string[];
    readonly calculationRecordId: number | null;
  };
  readonly heading: string;
}) {
  return (
    <div className="mb-8 space-y-4" data-testid="optimization-combination">
      {/* Heading with total and confidence */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-primary-700">
            {formatEur(totalCents)}
          </p>
        </div>
        <ConfidenceBadge level={confidence} />
      </div>

      {/* Shipment cards */}
      {shipments.map((shipment) => (
        <ShipmentCard key={shipment.merchant} shipment={shipment} />
      ))}

      {/* Confidence breakdown */}
      {confidenceBreakdown.length > 0 && (
        <ConfidenceBreakdown breakdown={confidenceBreakdown} />
      )}

      {/* Disclaimer — structural, from the API response */}
      <DisclaimerBanner disclaimer={disclaimer} />

      {/* Metadata */}
      <ResultMetadata metadata={metadata} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface BasketResultsProps {
  /** Full optimization result from the API. */
  readonly result: BasketOptimizationResult;
}

/**
 * Displays the full basket optimization result: recommended combination,
 * per-store breakdowns, confidence, disclaimer, and up to three cost-ordered
 * alternatives with identical neutral styling.
 */
export default function BasketResults({ result }: BasketResultsProps) {
  const hasAlternatives =
    result.alternatives && result.alternatives.length > 0;

  return (
    <div className="space-y-4">
      {/* ── Recommended combination ── */}
      <OptimizationCombination
        shipments={result.shipments}
        totalCents={result.totalCents}
        confidence={result.confidence}
        confidenceBreakdown={result.confidenceBreakdown}
        disclaimer={result.disclaimer}
        metadata={result.metadata}
        heading="Recommended combination"
      />

      {/* ── Alternatives — neutral, cost-ordered, no visual preference cues ── */}
      {hasAlternatives && (
        <div>
          <h2 className="mb-4 text-base font-semibold text-gray-700">
            Alternatives
          </h2>
          <div className="divide-y divide-gray-200">
            {result.alternatives.map((alt, i) => (
              <div key={i} className="py-4 first:pt-0 last:pb-0">
                <OptimizationCombination
                  shipments={alt.shipments}
                  totalCents={alt.totalCents}
                  confidence={alt.confidence}
                  confidenceBreakdown={alt.confidenceBreakdown}
                  disclaimer={alt.disclaimer}
                  metadata={alt.metadata}
                  heading={`Alternative ${i + 1}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}