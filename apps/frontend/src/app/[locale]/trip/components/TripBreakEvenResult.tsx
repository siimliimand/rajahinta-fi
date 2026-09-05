'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type {
  TripBreakEvenLine,
  TripBreakEvenVolumeLine,
  TripFeasibilityResponse,
  TripNoBreakEvenLine,
} from '../trip.types';
import { Badge, Card } from '@/components/ui';
import DisclaimerBanner from '../../calculator/components/DisclaimerBanner';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format cents to a euro string — the CalculatorResult/EventPlanResult
 * precedent. Figures are formatted, never re-rounded.
 */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/** Per-litre variant of the above — price bases and differences are cents/l. */
function formatEurPerLitre(cents: number): string {
  return `${formatEur(cents)}/l`;
}

/**
 * Format an API-returned litre figure for display. The tripcalc module
 * states whole litres (the caps' granularity), so the figure is rendered
 * as returned — fi-FI separator, formatted never re-rounded.
 */
function formatLitres(litres: number): string {
  return `${new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 2 }).format(litres)} l`;
}

// ---------------------------------------------------------------------------
// One line — break-even volume with its capping, or the no-savings state
// ---------------------------------------------------------------------------

/** Explained value-state note under a line's figures. */
function StateNote({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="mt-2 rounded-md bg-gray-50 px-3 py-2">
      <p className="text-xs font-medium text-gray-700">{title}</p>
      <p className="mt-0.5 text-xs text-gray-500">{body}</p>
    </div>
  );
}

function BreakEvenLineCard({ line }: { readonly line: TripBreakEvenVolumeLine }) {
  const t = useTranslations('TripPage');

  return (
    <Card padding="md" shadow="sm" data-testid={`trip-line-${line.category}`}>
      <h3 className="text-base font-semibold text-gray-900">
        {t(`category.${line.category}`)}
      </h3>
      <dl className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('result.priceDifference')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatEurPerLitre(line.priceDifferenceCentsPerLitre)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('result.breakEven')}</dt>
          <dd className="flex items-center gap-2 text-sm font-medium text-gray-900">
            {formatLitres(line.breakEvenLitres)}
            {line.capStatus === 'CAPPED' && (
              <Badge tone="stale" size="sm">
                {t('result.capExceeded')}
              </Badge>
            )}
            {line.capStatus === 'WITHIN_ALLOWANCE' && (
              <Badge tone="verified" size="sm">
                {t('result.withinAllowance')}
              </Badge>
            )}
          </dd>
        </div>
        {line.capLitres !== null && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-gray-500">{t('result.cap')}</dt>
            <dd className="text-sm font-medium text-gray-900">
              {formatLitres(line.capLitres)}
            </dd>
          </div>
        )}
        {/* Cap visualization for the exceeded state: the suggested (capped)
            volume with the uncapped figure stated beside it — the loss the
            cap causes stays visible instead of silently replacing it. */}
        {line.capStatus === 'CAPPED' && line.cappedBreakEvenLitres !== null && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-gray-500">{t('result.suggested')}</dt>
            <dd className="text-sm font-medium text-gray-900">
              {t('result.cappedWith', {
                cap: formatLitres(line.cappedBreakEvenLitres),
                uncapped: formatLitres(line.breakEvenLitres),
              })}
            </dd>
          </div>
        )}
      </dl>
      {line.capStatus === 'NO_ALLOWANCE_ROW' && (
        <StateNote
          title={t('result.noAllowanceRow')}
          body={t('result.noAllowanceRowBody')}
        />
      )}
      {line.capStatus === 'CAP_NOT_VOLUME' && (
        <StateNote title={t('result.capNotVolume')} body={t('result.capNotVolumeBody')} />
      )}
    </Card>
  );
}

function NoBreakEvenLineCard({ line }: { readonly line: TripNoBreakEvenLine }) {
  const t = useTranslations('TripPage');

  return (
    <Card padding="md" shadow="sm" data-testid={`trip-line-${line.category}`}>
      <h3 className="text-base font-semibold text-gray-900">
        {t(`category.${line.category}`)}
      </h3>
      <dl className="mt-3">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('result.priceDifference')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatEurPerLitre(line.priceDifferenceCentsPerLitre)}
          </dd>
        </div>
      </dl>
      {/* Expected value state, never an error: the foreign basis is not
          below the domestic reference, so no break-even volume exists. */}
      <StateNote title={t('result.noBreakEven')} body={t('result.noBreakEvenBody')} />
    </Card>
  );
}

function TripLineCard({ line }: { readonly line: TripBreakEvenLine }) {
  return line.status === 'BREAK_EVEN' ? (
    <BreakEvenLineCard line={line} />
  ) : (
    <NoBreakEvenLineCard line={line} />
  );
}

// ---------------------------------------------------------------------------
// Partner block — the visually distinct, labeled container (design R8)
// ---------------------------------------------------------------------------

function FerryOffersBlock({
  offers,
}: {
  readonly offers: TripFeasibilityResponse['ferryOffers'];
}) {
  const t = useTranslations('TripPage');

  // Rendered only when the curated block is populated; it sits OUTSIDE
  // the results section as a sibling, so the results markup is identical
  // whether this block is present or absent (design R8 compliance).
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
        {/* Links go through the redirect path — the API exposes no raw
            url, and the calculation figures above never depend on this
            block (neutrality: separate data path). */}
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

interface TripBreakEvenResultProps {
  /** The 200 response — lines, citation, structural disclaimer, ferry block. */
  readonly result: TripFeasibilityResponse;
}

/**
 * Break-even output for the trip feasibility calculator.
 *
 * Names the resolved allowance dataset version (design R5/R7 provenance)
 * and carries the structural disclaimer from the response — rendered as
 * returned, never a UI-only string. Every cap state is an explained
 * value; NO_BREAK_EVEN is a per-line value state, not an error.
 *
 * @module TripBreakEvenResult
 */
export default function TripBreakEvenResult({
  result,
}: TripBreakEvenResultProps) {
  const t = useTranslations('TripPage');
  const tCommon = useTranslations('Common');

  return (
    <>
      <section aria-labelledby="trip-result-heading" data-testid="trip-result">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2
            id="trip-result-heading"
            className="text-lg font-semibold text-gray-900"
          >
            {t('result.heading')}
          </h2>
          <Badge tone="estimated" size="sm">
            {tCommon('reliability.ESTIMATED')}
          </Badge>
        </div>

        {/* Travel-cost derivation, echoed from the response. */}
        <p className="mb-1 text-sm text-gray-700">
          {t('result.travelCost', { total: formatEur(result.travelCostCents) })}
        </p>
        <p className="mb-4 text-sm text-gray-700">
          {t('result.perTraveller', {
            amount: formatEur(result.travelCostPerTravellerCents),
            passengers: result.passengers,
          })}
        </p>

        {/* R7 provenance: the allowance dataset version is named. */}
        <p className="mb-4 text-xs text-gray-500">
          {t('result.allowanceVersion', { version: result.allowanceDatasetVersion })}
        </p>

        <div className="space-y-4">
          {result.lines.map((line) => (
            <TripLineCard key={line.category} line={line} />
          ))}
        </div>

        {/* Structural disclaimer — the field from the API response. */}
        <div className="mt-6">
          <DisclaimerBanner disclaimer={result.disclaimer} />
        </div>
      </section>

      {/* Partner block — separate sibling container, never interleaved
          with the results (design R8). */}
      <FerryOffersBlock offers={result.ferryOffers} />
    </>
  );
}
