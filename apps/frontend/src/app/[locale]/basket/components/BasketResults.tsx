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
 * All badge/freshness conventions come from the canonical status module
 * (`@/lib/design/status`) and the ui primitives, matching CalculatorResult:
 * green VERIFIED, blue ESTIMATED, amber STALE, gray UNAVAILABLE (D1/D2).
 *
 * @module BasketResults
 */

import { useTranslations } from 'next-intl';
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
import {
  CONFIDENCE_LEVEL_META,
  RELIABILITY_STATUS_META,
} from '@/lib/design/status';
import {
  Badge,
  Card,
  ConfidenceBadge,
  ReliabilityBadge,
} from '@/components/ui';
import type { BadgeTone } from '@/components/ui';
import DisclaimerBanner from '../../calculator/components/DisclaimerBanner';
import BasketPackingPanel from './BasketPackingPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents to a euro string. */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/**
 * Transport reliability is a domain enum the shared status module does not
 * key, so it maps onto the canonical ladder tones (EXACT → verified green,
 * ESTIMATED → estimated blue, PARTIAL → error red); every colour class
 * itself comes from the shared module via the Badge primitive.
 */
const TRANSPORT_RELIABILITY_TONE: Record<
  ConsolidatedTransportReliability,
  BadgeTone
> = {
  EXACT: 'verified',
  ESTIMATED: 'estimated',
  PARTIAL: 'error',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Reliability badge reusing the calculator's visual convention. */
function LocalizedReliabilityBadge({ status }: { status: ReliabilityStatus }) {
  const tAll = useTranslations();
  return (
    <ReliabilityBadge status={status}>
      {tAll(RELIABILITY_STATUS_META[status].labelKey)}
    </ReliabilityBadge>
  );
}

/** Transport reliability badge. */
function TransportReliabilityBadge({
  reliability,
}: {
  reliability: ConsolidatedTransportReliability;
}) {
  const tCommon = useTranslations('Common');
  const tBasket = useTranslations('BasketCommon');
  return (
    <Badge tone={TRANSPORT_RELIABILITY_TONE[reliability]} size="sm">
      {reliability === 'ESTIMATED'
        ? tCommon('reliability.ESTIMATED')
        : tBasket(`transportReliability.${reliability}`)}
    </Badge>
  );
}

/** Confidence badge matching the calculator's ConfidenceBadge component. */
function LocalizedConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const tAll = useTranslations();
  return (
    <ConfidenceBadge level={level}>
      {tAll(CONFIDENCE_LEVEL_META[level].labelKey)}
    </ConfidenceBadge>
  );
}

/** Threshold check line. */
function ThresholdCheckLine({
  thresholdCheck,
}: {
  thresholdCheck: MinimumOrderThresholdCheck;
}) {
  const t = useTranslations('BasketCommon');
  if (thresholdCheck.minimumOrderValueCents === null) {
    return (
      <p className="text-xs text-gray-400">{t('thresholdUnknown')}</p>
    );
  }
  const meets = thresholdCheck.meetsThreshold;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500">
        {t('minimumOrder', {
          value: formatEur(thresholdCheck.minimumOrderValueCents),
        })}
      </span>
      {meets ? (
        <span className="text-green-700">{t('met')}</span>
      ) : (
        <span className="text-red-700">{t('notMet')}</span>
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
  const tCommon = useTranslations('Common');
  return (
    <div className="mt-3 rounded-md bg-gray-50 px-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-700">
            {tCommon('transport')}
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
  const dot = RELIABILITY_STATUS_META[reliability].dot;
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 ${dot}`}
        />
        <span className="text-sm text-gray-700">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums text-gray-600">
          {formatEur(cents)}
        </span>
        <LocalizedReliabilityBadge status={reliability} />
      </div>
    </div>
  );
}

/** One shipment card (per merchant/store). */
function ShipmentCard({ shipment }: { shipment: BasketShipment }) {
  return (
    <Card padding="sm">
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
    </Card>
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
  const t = useTranslations('BasketResults');
  if (breakdown.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t('dataReliability')}
      </h3>
      <ul className="space-y-1">
        {breakdown.map((detail, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span
              className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 ${RELIABILITY_STATUS_META[detail.status].dot}`}
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
  const tCommon = useTranslations('Common');
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2">
      <dl className="space-y-1 text-xs text-gray-500">
        <div className="flex justify-between">
          <dt>{tCommon('calculatedAt')}</dt>
          <dd className="tabular-nums">
            {new Date(metadata.calculationTimestamp).toLocaleString('fi-FI')}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>{tCommon('datasetVersions')}</dt>
          <dd className="tabular-nums">
            {metadata.datasetVersions.length > 0
              ? metadata.datasetVersions.join(', ')
              : '—'}
          </dd>
        </div>
        {metadata.calculationRecordId !== null && (
          <div className="flex justify-between">
            <dt>{tCommon('recordId')}</dt>
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
        <LocalizedConfidenceBadge level={confidence} />
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
  /**
   * Product names from the basket builder, keyed by product ID — lets the
   * packing section name excluded products instead of bare IDs.
   */
  readonly productNames?: ReadonlyMap<number, string>;
}

/**
 * Displays the full basket optimization result: recommended combination,
 * per-store breakdowns, confidence, disclaimer, up to three cost-ordered
 * alternatives with identical neutral styling, and — when the response
 * carries the flag-gated packing section — the advisory packing panel.
 */
export default function BasketResults({ result, productNames }: BasketResultsProps) {
  const t = useTranslations('BasketResults');
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
        heading={t('recommended')}
      />

      {/* ── Flag-gated packing section — rendered only when present ── */}
      {result.packing !== undefined && (
        <BasketPackingPanel
          packing={result.packing}
          productNames={productNames ?? new Map()}
        />
      )}

      {/* ── Alternatives — neutral, cost-ordered, no visual preference cues ── */}
      {hasAlternatives && (
        <div>
          <h2 className="mb-4 text-base font-semibold text-gray-700">
            {t('alternatives')}
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
                  heading={t('alternative', { index: i + 1 })}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
