'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  AlkoBenchmark,
  CalculatorResult as CalculatorResultType,
  CostCategory,
  ReliabilityStatus,
} from '@/lib/types';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';
import { ReliabilityBadge } from '@/components/ui';
import { formatMoney, formatSignedMoney } from '@/lib/format/money';
import { formatDate, formatDateTime } from '@/lib/format/date';
import DisclaimerBanner from './DisclaimerBanner';
import SanityNoteList from './SanityNoteList';
import TravellerAlternativeCallout from './TravellerAlternativeCallout';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Signed percent at one decimal — matches the API's rounding precision. */
function formatSignedPercent(percent: number): string {
  const sign = percent > 0 ? '+' : percent < 0 ? '-' : '';
  return `${sign}${Math.abs(percent).toFixed(1)} %`;
}

/**
 * Cost categories the traveller allowance can split (task 2.1, change
 * finnish-first-client-experience): in a PERSONAL result the taxed
 * engines apply to the surplus only, so these lines can appear twice —
 * the dataset-fact zero (within allowance) followed by the taxed
 * surplus. Labels disambiguate the pair; transport and retail never
 * split.
 */
const ALLOWANCE_SPLIT_CATEGORIES: ReadonlySet<CostCategory> = new Set([
  'alcoholExciseEstimate',
  'containerDutyEstimate',
  'importVatEstimate',
]);

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
 *   6. A transport component whose dataset is `UNAVAILABLE` renders an
 *      explicit "not included — dataset pending" line instead of a
 *      €0.00 figure, with a note naming the missing input (the
 *      transport dataset) that explains the downgraded confidence
 *      (data-quality-and-publication-trust 3.1). Every other figure
 *      stays verbatim — the honest state changes presentation, never
 *      amounts.
 *
 * No confidence score is invented here: reliability comes from the
 * result's own statuses, confidence display stays with the existing
 * breakdown components.
 */
export default function ResultCard({ result }: ResultCardProps) {
  const t = useTranslations('CalculatorResult');
  const tCommon = useTranslations('Common');
  const locale = useLocale();
  const meta = result.metadata;
  const benchmark = result.alkoBenchmark;
  // Traveller mode (task 2.1): the allowance dataset version is present
  // exactly on PERSONAL results that resolved a published dataset —
  // delivery results never carry the key.
  const allowanceDatasetVersion = meta.allowanceDatasetVersion;

  // The price data feeding the result: the retail line's own reliability
  // status. Rendered with the calculation timestamp — the same freshness
  // pairing the itemized freshness section uses (no per-line observedAt
  // exists on the API result object).
  const priceLine = result.itemizedCosts.find(
    (cost) => cost.category === 'foreignRetailPrice',
  );

  // Transport without a dataset arrives as a €0.00 line (the calculator
  // stores 0 cents with `UNAVAILABLE`). The honest presentation states
  // the omission and explains the downgraded confidence; nothing else
  // about the result changes.
  const transportPending = result.itemizedCosts.some(
    (cost) =>
      cost.category === 'transportCost' &&
      cost.reliability === 'UNAVAILABLE',
  );

  return (
    <div
      className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="result-card"
    >
      {/* ── Answer-first hero pair (task 3.4, design D4): the estimated
          landed cost leads; a delivery-mode result carrying a
          travellerAlternative renders the traveller estimate as a
          co-equal labeled block beside it — the same treatment the
          record-page card got in 3.2, same message keys, no new copy.
          Without the field the hero renders exactly as before in a
          plain (non-grid) block — the card's first child, so unlike
          the record card no top margin rides on the wrapper. Amounts
          come straight from the payload — byte-identical, display-only
          — and the callout keeps its conditional presence: live POST
          payload only, GET/persisted results never carry the field. ── */}
      <div
        className={
          result.travellerAlternative !== undefined
            ? 'grid gap-3 md:grid-cols-2'
            : undefined
        }
        data-testid="hero-pair"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t('total')}
          </p>
          <p
            data-testid="landed-cost-total"
            className="tabular-money mt-1 text-4xl font-extrabold text-gray-900"
          >
            {formatMoney(result.totalCents, locale)}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {t('unitsTimesDestination', {
              count: meta.quantity,
              destination: meta.input.destination,
            })}
          </p>
        </div>
        {result.travellerAlternative && (
          <TravellerAlternativeCallout
            alternative={result.travellerAlternative}
            productId={meta.input.productId}
            quantity={meta.input.quantity}
          />
        )}
      </div>

      {/* ── Savings summary (task 5.1 follow-through) — the same
          display-only statement the result-record view renders: only
          when a benchmark exists AND the calculated offer sits below the
          reference (an actual estimated saving), same copy keys, never a
          cost line or a calculation input. No benchmark, or an offer at
          or above the reference, renders nothing. ── */}
      {benchmark !== undefined &&
        benchmark.status === 'available' &&
        benchmark.differenceCents < 0 && (
          <div
            data-testid="savings-summary"
            className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-3"
          >
            <p className="text-sm font-semibold text-primary-900">
              {t('savingsSummary.title', {
                amount: formatMoney(-benchmark.differenceCents, locale),
              })}
            </p>
            <p className="mt-1 text-xs text-primary-800">
              {t('savingsSummary.asOf', {
                date: formatDate(benchmark.observedAt.slice(0, 10), locale),
              })}
            </p>
          </div>
        )}

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
              {formatDateTime(meta.calculationTimestamp, locale)}
            </time>
          </span>
        </div>
      )}

      {/* ── Degraded state: plausibility-rail trip notes. Rendered only
          when the result carries `sanityNotes` — key absent (plausible
          calculation) renders nothing, per the render-nothing convention. ── */}
      {result.sanityNotes && result.sanityNotes.length > 0 && (
        <SanityNoteList notes={result.sanityNotes} />
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
                price: formatMoney(benchmark.referencePriceCents, locale),
              })}
            </span>
            <span
              data-testid="comparison-figure"
              className="text-sm tabular-nums text-gray-600"
            >
              {t('alkoBenchmark.difference', {
                difference: formatSignedMoney(benchmark.differenceCents, locale),
                percent: formatSignedPercent(benchmark.differencePercent),
              })}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {t('alkoBenchmark.observedAt', {
              timestamp: formatDateTime(benchmark.observedAt, locale),
            })}
          </p>
        </div>
      )}

      {/* ── Breakdown beneath the answer — figures verbatim from the
          result object, labeled by category so every number stays
          traceable to its input. In a traveller-mode result (task 2.1)
          the split tax lines carry their within/surplus portion labels;
          delivery results keep the plain category labels. ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('costBreakdown')}
        </h3>
        <div className="divide-y divide-gray-100">
          {(() => {
            // Emission-order discriminator: within-allowance lines are
            // dataset-fact zeros (VERIFIED) emitted before the taxed
            // surplus line of the same canonical category.
            const seenSplitCategories = new Set<CostCategory>();
            return result.itemizedCosts.map((cost, i) => {
              let labelText = t(`category.${cost.category}`);
              if (
                allowanceDatasetVersion !== undefined &&
                ALLOWANCE_SPLIT_CATEGORIES.has(cost.category)
              ) {
                if (seenSplitCategories.has(cost.category)) {
                  labelText = t('allowance.lineSurplus', {
                    category: labelText,
                  });
                } else if (
                  cost.cents === 0 &&
                  cost.reliability === 'VERIFIED'
                ) {
                  labelText = t('allowance.lineWithin', {
                    category: labelText,
                  });
                }
              }
              seenSplitCategories.add(cost.category);
              return (
                <div
                  key={`${cost.category}-${i}`}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className="text-sm text-gray-700">{labelText}</span>
                  {cost.category === 'transportCost' &&
                  cost.reliability === 'UNAVAILABLE' ? (
                    <div className="flex items-center gap-2">
                      <span
                        data-testid="transport-not-included"
                        className="text-sm text-gray-500"
                      >
                        {t('transportPending.notIncluded')}
                      </span>
                      <LocalizedReliabilityBadge status={cost.reliability} />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm tabular-nums text-gray-600">
                        {formatMoney(cost.cents, locale)}
                      </span>
                      <LocalizedReliabilityBadge status={cost.reliability} />
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
        {transportPending && (
          <p
            data-testid="transport-pending-note"
            className="mt-2 text-xs leading-relaxed text-gray-500"
          >
            {t('transportPending.explanation')}
          </p>
        )}
        {/* ── Traveller-mode provenance (task 2.1): the explicit
            one-traveller assumption plus the allowance dataset version
            the caps were applied from. Delivery results render neither. ── */}
        {allowanceDatasetVersion !== undefined && (
          <div
            data-testid="traveller-mode-notes"
            className="mt-3 space-y-1 rounded-md bg-gray-50 px-3 py-2"
          >
            <p
              data-testid="single-traveller-note"
              className="text-xs leading-relaxed text-gray-600"
            >
              {t('allowance.singleTravellerNote')}
            </p>
            <p
              data-testid="allowance-dataset-version"
              className="text-xs text-gray-400"
            >
              {t('allowance.datasetVersion', {
                version: allowanceDatasetVersion,
              })}
            </p>
          </div>
        )}
      </div>

      {/* ── Structural disclaimer — consumed from the result object ── */}
      <DisclaimerBanner disclaimer={result.disclaimer} />
    </div>
  );
}
