'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  AlkoBenchmark,
  CalculatorResult as CalculatorResultType,
  CostCategory,
  EvidenceCode,
  ReliabilityStatus,
  DataFreshnessEntry,
  RetailOffer,
} from '@/lib/types';
import { logClick } from '@/lib/api';
import { formatMoney, formatSignedMoney } from '@/lib/format/money';
import { formatDate, formatDateTime } from '@/lib/format/date';
import {
  CONFIDENCE_LEVEL_META,
  RELIABILITY_STATUS_META,
} from '@/lib/design/status';
import { ConfidenceBadge, ReliabilityBadge } from '@/components/ui';
import ConfidenceMeter from '../../components/ConfidenceMeter';
import { MerchantLink } from '../../compare/components/MerchantLink';
import DisclaimerBanner from './DisclaimerBanner';
import OutcomeNudge from './OutcomeNudge';
import ReportExportActions from './ReportExportActions';
import SanityNoteList from './SanityNoteList';
import ShareResultAction from './ShareResultAction';
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
 * The display-only Alko benchmark comparison. A separate section below
 * the itemized breakdown — never inside the total row — because the
 * reference is not a cost component of the landed cost.
 */
function AlkoBenchmarkLine({ benchmark }: { benchmark: AlkoBenchmark }) {
  const t = useTranslations('CalculatorResult');
  const locale = useLocale();
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
            price: formatMoney(benchmark.referencePriceCents, locale),
          })}
        </span>
        <span className="text-sm tabular-nums text-gray-600">
          {t('alkoBenchmark.difference', {
            difference: formatSignedMoney(benchmark.differenceCents, locale),
            percent: formatSignedPercent(benchmark.differencePercent),
          })}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {t(`alkoBenchmark.${postureKey}`)} ·{' '}
        {t('alkoBenchmark.observedAt', {
          timestamp: formatDateTime(benchmark.observedAt, locale),
        })}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence localization (task 3.2, design D3): code + values → locale text
// ---------------------------------------------------------------------------

/**
 * Evidence code → message key. `Record<EvidenceCode, …>` is the type-level
 * exhaustiveness check (design D3's risk note): a code added to the
 * core-domain union without a mapping here fails compilation, so the
 * frontend mapping can never silently drop a new code. The message group
 * itself is exhaustiveness-tested against both catalogs in
 * `messages.test.ts` and `CalculatorResult.test.tsx`.
 */
export const EVIDENCE_MESSAGE_KEYS: Record<
  EvidenceCode,
  `evidence.${EvidenceCode}`
> = {
  BUYER_TRAVELLING: 'evidence.BUYER_TRAVELLING',
  PERSONAL_ALLOWANCE_APPLIES: 'evidence.PERSONAL_ALLOWANCE_APPLIES',
  SELLER_CARRIAGE: 'evidence.SELLER_CARRIAGE',
  BUYER_CARRIAGE: 'evidence.BUYER_CARRIAGE',
  SELLER_NOT_INVOLVED: 'evidence.SELLER_NOT_INVOLVED',
  SELLER_IDENTITY_CONFIRMED: 'evidence.SELLER_IDENTITY_CONFIRMED',
  SELLER_IDENTITY_UNVERIFIED: 'evidence.SELLER_IDENTITY_UNVERIFIED',
  TRANSPORT_UNDETERMINED: 'evidence.TRANSPORT_UNDETERMINED',
};

/**
 * Localized labels for the structured data the classification service
 * carries in `supportingData` (a closed `key: value` / bare-phrase
 * vocabulary emitted by the classification rules). Values themselves are
 * locale-neutral identifiers (country codes, carrier ids, seller ids) and
 * ride as-is; the `personalTransport` value and the bare phrases are the
 * localized exceptions.
 */
const EVIDENCE_DATA_LABELS = {
  carrier: 'evidence.data.carrier',
  sellerCountry: 'evidence.data.sellerCountry',
  buyerCountry: 'evidence.data.buyerCountry',
  destination: 'evidence.data.destination',
  seller: 'evidence.data.seller',
  transportArrangement: 'evidence.data.transportArrangement',
  personalTransport: 'evidence.data.personalTransport',
  carrierUnavailable: 'evidence.data.carrierUnavailable',
  noCarrierIdentified: 'evidence.data.noCarrierIdentified',
  sellerNotInvolvedInShipping: 'evidence.data.sellerNotInvolvedInShipping',
  sellerIdentifierMissing: 'evidence.data.sellerIdentifierMissing',
} as const;

type EvidenceDataLabel = keyof typeof EVIDENCE_DATA_LABELS;

/** `key: value` pair keys the parser recognizes in `supportingData`. */
const EVIDENCE_DATA_PAIR_KEYS: ReadonlyMap<string, EvidenceDataLabel> =
  new Map([
    ['carrier', 'carrier'],
    ['seller country', 'sellerCountry'],
    ['buyer country', 'buyerCountry'],
    ['destination', 'destination'],
    ['seller', 'seller'],
    ['transport arrangement', 'transportArrangement'],
  ]);

/** Bare data phrases (no value) the parser recognizes. */
const EVIDENCE_DATA_PHRASES: ReadonlyMap<string, EvidenceDataLabel> = new Map([
  ['carrier information not available', 'carrierUnavailable'],
  ['no carrier identified', 'noCarrierIdentified'],
  ['seller not involved in shipping', 'sellerNotInvolvedInShipping'],
  ['no seller identifier provided', 'sellerIdentifierMissing'],
  ['personal transport', 'personalTransport'],
]);

/**
 * Compose the localized values tail from `supportingData`: known pairs
 * keep their value verbatim behind a localized label, known phrases are
 * localized outright, and anything unrecognized rides as-is — an unknown
 * emission shape degrades to the raw data, never to a dropped fact.
 */
function formatEvidenceValues(
  supportingData: string,
  t: ReturnType<typeof useTranslations>,
): string {
  const composed = supportingData
    .split(', ')
    .map((part) => {
      const separator = part.indexOf(': ');
      if (separator > 0) {
        const pairKey = EVIDENCE_DATA_PAIR_KEYS.get(
          part.slice(0, separator).trim(),
        );
        if (pairKey !== undefined) {
          return `${t(EVIDENCE_DATA_LABELS[pairKey])}:${part.slice(separator + 1)}`;
        }
      }
      const phraseKey = EVIDENCE_DATA_PHRASES.get(part.trim());
      if (phraseKey !== undefined) {
        return t(EVIDENCE_DATA_LABELS[phraseKey]);
      }
      return part.trim();
    })
    .filter((part) => part !== '')
    .join(', ');
  return composed !== '' ? composed : supportingData.trim();
}

/**
 * One localized evidence line (task 3.2, design D3): coded evidence
 * composes its locale sentence from the code's message plus the values
 * tail; evidence without a code (the calculator-appended
 * traveller-allowance evidence) falls back to the unchanged English
 * `observation` verbatim.
 */
export function localizedEvidenceLine(
  item: CalculatorResultType['classification']['evidence'][number],
  t: ReturnType<typeof useTranslations>,
): string {
  if (item.code === undefined) {
    return item.observation;
  }
  return t(EVIDENCE_MESSAGE_KEYS[item.code], {
    values: formatEvidenceValues(item.supportingData, t),
  });
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
  const locale = useLocale();
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-700">
        {t(`category.${category}`)}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums text-gray-600">
          {formatMoney(cents, locale)}
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
  const locale = useLocale();
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
            {formatDateTime(timestamp, locale)}
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
  const locale = useLocale();
  const meta = result.metadata;
  const freshnessEntries = useFreshnessEntries(result);
  const benchmark = result.alkoBenchmark;

  // ── Savings summary (task 5.1) ──
  // Display-only, factual: a prominent estimated-saving statement built
  // from the benchmark figures already on the result. It renders only
  // when a benchmark exists AND the calculated offer sits below the
  // reference (differenceCents < 0 — a saving). No benchmark, or an
  // offer priced at/above the reference, renders nothing — never a
  // placeholder figure or a negative "saving".
  const showSavingsSummary =
    benchmark !== undefined &&
    benchmark.status === 'available' &&
    benchmark.differenceCents < 0;

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

      {/* ── Degraded state: plausibility-rail trip notes, beside the
          confidence badge they explain. Rendered only when the result
          carries `sanityNotes` — key absent (plausible calculation)
          renders nothing, per the render-nothing convention. ── */}
      {result.sanityNotes && result.sanityNotes.length > 0 && (
        <SanityNoteList notes={result.sanityNotes} />
      )}

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

        {/* ── Hero pair (task 3.2, design D4): a delivery-mode result
            carrying a travellerAlternative renders the delivery hero and
            the traveller estimate side by side at the same rank; without
            one the hero renders exactly as before. Amounts come straight
            from the payload — byte-identical, display-only — and the
            callout keeps its conditional presence: live POST payload
            only, GET/persisted results never carry the field. ── */}
        <div
          className={
            result.travellerAlternative !== undefined
              ? 'mt-4 grid gap-3 md:grid-cols-2'
              : 'mt-4'
          }
          data-testid="hero-pair"
        >
          <div className="rounded-xl bg-primary-600 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-200">
              {t('total')}
            </p>
            <p className="tabular-money mt-1 text-3xl font-extrabold text-white">
              {formatMoney(result.totalCents, locale)}
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

        {/* ── Empirical margin (hedge-dedup-confidence-meter 4.1,
            design D4): display-only ± figure beside the hero total,
            basis (percent, n, as-of) always adjacent; the margin never
            enters any figure. Absent margin renders nothing. ── */}
        <ConfidenceMeter
          margin={result.empiricalMargin}
          totalCents={result.totalCents}
        />
      </div>

      {/* ── Savings summary (task 5.1) — display-only: prominent factual
          statement derived from the alkoBenchmark above; never a cost
          line, never a calculation or ranking input. Present only when
          the comparison yields an actual estimated saving. ── */}
      {showSavingsSummary && benchmark.status === 'available' && (
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

      {/* ── Alko benchmark — display-only comparison, not a cost line:
          renders nothing when the result carries no reference ── */}
      {benchmark && <AlkoBenchmarkLine benchmark={benchmark} />}

      {/* ── Confidence breakdown (hedge-dedup-confidence-meter 3.1,
          design D7): reachable in one interaction behind the collapsed
          disclosure — the same `<details>` pattern the declaration
          guidance panel uses — instead of always-on. LOW-confidence
          results keep the SanityNoteList above always visible; that is
          the degraded-state exception. ── */}
      {result.confidenceBreakdown.length > 0 && (
        <details
          className="group rounded-md border border-gray-200 bg-white"
          data-testid="confidence-breakdown-disclosure"
        >
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-gray-700 marker:hidden">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">
              &rsaquo;
            </span>
            {tCommon('dataReliability')}
          </summary>
          <ul className="space-y-1 border-t border-gray-100 px-3 py-2">
            {result.confidenceBreakdown.map((detail, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 ${RELIABILITY_STATUS_META[detail.status].dot}`}
                />
                <span className="text-gray-600">{detail.detail}</span>
              </li>
            ))}
          </ul>
        </details>
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

      {/* ── Classification (task 3.2): the label localizes from the
          ClassificationLabel enum and the evidence lines compose locale
          sentences from the closed-set evidence codes (design D3). The
          API's English `evidenceSummary` stays unchanged on the wire;
          the page renders the localized evidence instead. Evidence
          without a code falls back to the English observation. ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('transactionClassification')}
        </h3>
        <p className="text-sm font-medium text-gray-800">
          {result.classification.classification === 'NotPersisted'
            ? t('notStored')
            : t(`classification.${result.classification.classification}`)}
        </p>
        {result.classification.evidence.length > 0 && (
          <ul
            data-testid="classification-evidence"
            className="mt-1 space-y-0.5"
          >
            {result.classification.evidence.map((item, i) => (
              <li key={i} className="text-xs leading-relaxed text-gray-500">
                {localizedEvidenceLine(item, t)}
              </li>
            ))}
          </ul>
        )}
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
              {formatDateTime(meta.calculationTimestamp, locale)}
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

      {/* ── Report export actions ── */}
      <ReportExportActions recordId={result.calculationRecordId} />

      {/* ── Share action (task 5.2) — frozen snapshot + copyable
          /share/[publicId] link for this record ── */}
      <ShareResultAction recordId={result.calculationRecordId} />

      {/* ── Outcome nudge (task 3.3, design D7) — one dismissible prompt
          after a successful calculation, in both buying modes: logged-in
          visitors get the account deep-link with this record preselected,
          anonymous ones the sign-in path. Session-sticky dismissal, never
          blocks the result, sends nothing on its own. ── */}
      <OutcomeNudge recordId={result.calculationRecordId} />

      {/* ── Disclaimer — the view's single render, sourced from the
          result object; intensity keys to the result confidence
          (hedge-dedup-confidence-meter 3.1, design D1) ── */}
      <DisclaimerBanner
        disclaimer={result.disclaimer}
        confidence={result.confidence}
      />
    </div>
  );
}
