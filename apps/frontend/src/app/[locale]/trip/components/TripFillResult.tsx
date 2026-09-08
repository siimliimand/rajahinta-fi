'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type {
  TripFillCategoryHeadroom,
  TripFillLine,
  TripFillResponse,
} from '../trip.types';
import { Badge, Card } from '@/components/ui';
import DisclaimerBanner from '../../calculator/components/DisclaimerBanner';

// ---------------------------------------------------------------------------
// Formatting — the TripBreakEvenResult precedent: figures are formatted,
// never re-rounded
// ---------------------------------------------------------------------------

function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function formatLitres(litres: number): string {
  return `${new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 2 }).format(litres)} l`;
}

// ---------------------------------------------------------------------------
// One candidate line's outcome
// ---------------------------------------------------------------------------

/** Per-line status badge tone — decorative; the label carries the meaning. */
function lineStatusTone(status: TripFillLine['status']): 'verified' | 'stale' | 'neutral' {
  if (status === 'FILLED') return 'verified';
  if (status === 'CAP_EXHAUSTED' || status === 'NO_ALLOWANCE_ROW') return 'stale';
  return 'neutral';
}

function FillLineCard({
  line,
  productName,
}: {
  readonly line: TripFillLine;
  readonly productName: string;
}) {
  const t = useTranslations('TripPage');

  return (
    <Card padding="md" shadow="sm" data-testid={`trip-fill-line-${line.productId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-gray-900">{productName}</h3>
        <Badge tone={lineStatusTone(line.status)} size="sm">
          {t(`fill.lineStatus.${line.status}`)}
        </Badge>
      </div>
      <dl className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('fill.line.filledQuantity')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {t('fill.line.unitsValue', { count: line.filledQuantity })}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('fill.line.unitPrice')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatEur(line.unitPriceCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('fill.line.merchant')}</dt>
          <dd className="text-sm font-medium text-gray-900">{line.merchant}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('fill.line.contribution')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatEur(line.valueContributionCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('fill.line.consumedVolume')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatLitres(line.consumedVolumeLitres)}
          </dd>
        </div>
        {/* Headroom after this line's consumption — the running remainder
            the next line was bounded by; absent under NO_ALLOWANCE_ROW
            (never an invented cap). */}
        {line.headroomAfter !== null && line.headroomAfter.remainingLitres !== null && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-gray-500">
              {t('fill.line.remainingLitres', {
                category: t(`category.${line.headroomAfter.category}`),
              })}
            </dt>
            <dd className="text-sm font-medium text-gray-900">
              {formatLitres(line.headroomAfter.remainingLitres)}
            </dd>
          </div>
        )}
        {line.headroomAfter !== null && line.headroomAfter.remainingUnits !== null && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-gray-500">
              {t('fill.line.remainingUnits', {
                category: t(`category.${line.headroomAfter.category}`),
              })}
            </dt>
            <dd className="text-sm font-medium text-gray-900">
              {t('fill.line.unitsValue', { count: line.headroomAfter.remainingUnits })}
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Final per-category headroom
// ---------------------------------------------------------------------------

function CategoryHeadroomRows({
  headroom,
}: {
  readonly headroom: readonly TripFillCategoryHeadroom[];
}) {
  const t = useTranslations('TripPage');

  return (
    <dl className="space-y-2">
      {headroom.map((row) => (
        <div
          key={row.category}
          data-testid={`trip-fill-headroom-${row.category}`}
          className="flex items-baseline justify-between gap-4"
        >
          <dt className="text-sm text-gray-500">
            {t(`category.${row.category}`)}
          </dt>
          <dd className="text-sm font-medium text-gray-900">
            {row.remainingLitres !== null
              ? formatLitres(row.remainingLitres)
              : t('fill.line.unitsValue', { count: row.remainingUnits ?? 0 })}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Partner block — the separate sibling container (design R8), identical
// markup contract to the break-even mode's block
// ---------------------------------------------------------------------------

function FerryOffersBlock({
  offers,
}: {
  readonly offers: TripFillResponse['ferryOffers'];
}) {
  const t = useTranslations('TripPage');

  if (offers.length === 0) return null;

  return (
    <aside
      aria-label={t('partners.label')}
      data-testid="trip-partners"
      className="mt-8 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t('partners.label')}
      </p>
      <ul className="mt-2 space-y-1">
        {offers.map((offer) => (
          <li key={offer.id}>
            <a
              href={offer.redirectPath}
              target="_blank"
              rel="noopener"
              className="text-sm text-gray-700 underline hover:text-primary-700"
            >
              {offer.operator} — {offer.routeLabel}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TripFillResultProps {
  /** The 200 response — itemized lines, provenance, disclaimer, ferry block. */
  readonly result: TripFillResponse;
  /** Candidate names known to the page, keyed by productId (display only). */
  readonly productNames: ReadonlyMap<number, string>;
}

/**
 * Fill output (task 8.3): the per-line itemization with each line's value
 * contribution and headroom, the resolved dataset version, and the
 * structural disclaimer from the response — rendered as returned, never
 * a UI-only string. The ferry block stays a separate sibling section;
 * the itemization markup never depends on it.
 *
 * @module TripFillResult
 */
export default function TripFillResult({
  result,
  productNames,
}: TripFillResultProps) {
  const t = useTranslations('TripPage');
  const tCommon = useTranslations('Common');

  return (
    <>
      <section aria-labelledby="trip-fill-result-heading" data-testid="trip-fill-result">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2
            id="trip-fill-result-heading"
            className="text-lg font-semibold text-gray-900"
          >
            {t('fill.result.heading')}
          </h2>
          <Badge tone="estimated" size="sm">
            {tCommon('reliability.ESTIMATED')}
          </Badge>
        </div>

        {/* Provenance: the dataset version the caps were resolved from. */}
        <p className="mb-1 text-xs text-gray-500">
          {t('result.allowanceVersion', { version: result.allowanceDatasetVersion })}
        </p>

        {/* Totals — the maximized objective, echoed from the response. */}
        <p className="mb-1 text-sm text-gray-700">
          {t('fill.result.filledValue', { total: formatEur(result.filledValueCents) })}
        </p>
        <p className="mb-4 text-sm text-gray-700">
          {t('fill.result.filledUnits', {
            count: t('fill.line.unitsValue', { count: result.filledUnits }),
          })}
        </p>

        {/* Honest empty fills — explicit result values, never errors. */}
        {result.status === 'BOUND_EXHAUSTED' && (
          <div className="mb-4 rounded-md bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium text-gray-700">
              {t('fill.result.boundExhausted')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {t('fill.result.boundExhaustedBody')}
            </p>
          </div>
        )}
        {result.status === 'NO_BOUNDABLE_LINE' && (
          <div className="mb-4 rounded-md bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium text-gray-700">
              {t('fill.result.noBoundableLine')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {t('fill.result.noBoundableLineBody')}
            </p>
          </div>
        )}

        {/* Per-line itemization, in input order. */}
        <div className="space-y-4">
          {result.lines.map((line) => (
            <FillLineCard
              key={line.productId}
              line={line}
              productName={
                productNames.get(line.productId) ??
                t('fill.result.productFallback', { id: line.productId })
              }
            />
          ))}
        </div>

        {/* Final per-category headroom after the fill. */}
        {result.categoryHeadroom.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-sm font-medium text-gray-700">
              {t('fill.result.headroomHeading')}
            </p>
            <CategoryHeadroomRows headroom={result.categoryHeadroom} />
          </div>
        )}

        {/* Structural disclaimer — the field from the API response. */}
        <div className="mt-6">
          <DisclaimerBanner disclaimer={result.disclaimer} />
        </div>
      </section>

      {/* Partner block — separate sibling container, never interleaved
          with the itemization (design R8). */}
      <FerryOffersBlock offers={result.ferryOffers} />
    </>
  );
}
