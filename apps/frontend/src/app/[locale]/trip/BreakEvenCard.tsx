'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Card } from '@/components/ui';
import type { TripBreakEvenLine } from './trip.types';

// ---------------------------------------------------------------------------
// Derivation (design D5: break-even baskets is a DISPLAYED DERIVATION —
// not a new engine output and not part of the result object contract)
// ---------------------------------------------------------------------------

/** One category's contribution to the suggested basket's saving. */
export interface BreakEvenBasketContribution {
  /** Allowance category key (the result echoes it as a plain string). */
  readonly category: string;
  /** Suggested duty-free volume — whole litres, as displayed on the line. */
  readonly litres: number;
  /** `domestic − foreign` in cents per litre, echoed from the line. */
  readonly differenceCentsPerLitre: number;
  /** `litres × difference` — exact integer cents. */
  readonly savingCents: number;
}

/** The suggested basket's total saving and the per-line trace behind it. */
export interface TripBasketSaving {
  /** Σ of the contributions — exact integer cents. */
  readonly totalCents: number;
  /** Per-line figures, so the card can show where the saving comes from. */
  readonly contributions: readonly BreakEvenBasketContribution[];
  /**
   * BREAK_EVEN categories excluded from the basket because no suggested
   * volume exists (no allowance row, or a cap that is not a volume).
   * The card names them so the omission stays explicit.
   */
  readonly excludedCategories: readonly string[];
}

/**
 * Saving of ONE basket filled with the suggested duty-free volumes,
 * derived from figures the break-even result already carries: for each
 * BREAK_EVEN line with a suggested volume,
 * `priceDifferenceCentsPerLitre × cappedBreakEvenLitres`.
 *
 * Lines without a suggested volume are excluded — never invented
 * (TripBreakEvenResult precedent) — and reported through
 * `excludedCategories`. NO_BREAK_EVEN lines have no basket volume at
 * all, so their non-positive differences cannot enter the total.
 */
export function tripPerBasketSavingCents(
  lines: readonly TripBreakEvenLine[],
): TripBasketSaving {
  const contributions: BreakEvenBasketContribution[] = [];
  const excludedCategories: string[] = [];
  let totalCents = 0;
  for (const line of lines) {
    if (line.status !== 'BREAK_EVEN') continue;
    const litres = line.cappedBreakEvenLitres;
    if (litres === null) {
      excludedCategories.push(line.category);
      continue;
    }
    const savingCents = line.priceDifferenceCentsPerLitre * litres;
    contributions.push({
      category: line.category,
      litres,
      differenceCentsPerLitre: line.priceDifferenceCentsPerLitre,
      savingCents,
    });
    totalCents += savingCents;
  }
  return { totalCents, contributions, excludedCategories };
}

/**
 * Break-even baskets: `(total trip costs) / per-basket saving`, rounded
 * half-up to one decimal. `null` when the saving is zero or negative —
 * no number of baskets then recovers the costs, and the quotient is
 * meaningless instead of negative.
 */
export function breakEvenBaskets(
  totalCostCents: number,
  perBasketSavingCents: number,
): number | null {
  if (perBasketSavingCents <= 0) return null;
  return Math.round((totalCostCents / perBasketSavingCents) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Formatting — the TripBreakEvenResult conventions (figures formatted,
// never re-rounded)
// ---------------------------------------------------------------------------

function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function formatLitres(litres: number): string {
  return `${new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 2 }).format(litres)} l`;
}

function formatBaskets(baskets: number): string {
  return new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 1 }).format(
    baskets,
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BreakEvenCardProps {
  /** The trip's transport cost — `travelCostCents` (tickets + fuel). */
  readonly transportCostCents: number;
  /** The suggested basket's saving — `tripPerBasketSavingCents(lines)`. */
  readonly basketSaving: TripBasketSaving;
  /**
   * Other trip costs beyond transport (e.g. accommodation). GAP SLOT:
   * no trip input collects these today, so the view omits the prop and
   * the card counts €0.00 and says so. A future form field passes the
   * parsed figure here without any card change.
   */
  readonly otherCostsCents?: number;
}

/**
 * Trip break-even card (price-intelligence-roadmap task 4.4, design D5).
 *
 * Displays the derivation `break-even baskets = (transport + other
 * costs) / per-basket saving` WITH its input values, so every number on
 * the card is explainable from the break-even result: transport is the
 * echoed travel cost, the per-basket saving is the sum of each
 * category's suggested duty-free volume times its price difference
 * (listed), and the basket count is the quotient. Zero or negative
 * saving renders the "trip does not pay for itself" state instead of a
 * meaningless quotient. A hint links the traveller to the allowance
 * limits that cap the basket.
 *
 * @module TripBreakEvenCard
 */
export default function BreakEvenCard({
  transportCostCents,
  basketSaving,
  otherCostsCents,
}: BreakEvenCardProps) {
  const t = useTranslations('TripPage');

  const otherCostsCollected = otherCostsCents !== undefined;
  const otherCostsCentsValue = otherCostsCollected ? otherCostsCents : 0;
  const totalCostCents = transportCostCents + otherCostsCentsValue;
  const baskets = breakEvenBaskets(totalCostCents, basketSaving.totalCents);

  return (
    <Card data-testid="trip-break-even-card" className="mt-8">
      <h3 className="text-base font-semibold text-gray-900">
        {t('breakEvenCard.heading')}
      </h3>

      {/* The formula's input values — each traced to its source. */}
      <dl className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">
            {t('breakEvenCard.transport')}
          </dt>
          <dd
            data-testid="trip-break-even-transport"
            className="text-sm font-medium text-gray-900"
          >
            {formatEur(transportCostCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">
            {t('breakEvenCard.other')}
          </dt>
          <dd
            data-testid="trip-break-even-other"
            className="text-sm font-medium text-gray-900"
          >
            {formatEur(otherCostsCentsValue)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('breakEvenCard.saving')}</dt>
          <dd
            data-testid="trip-break-even-saving"
            className="text-sm font-medium text-gray-900"
          >
            {formatEur(basketSaving.totalCents)}
          </dd>
        </div>
      </dl>

      {!otherCostsCollected && (
        <p className="mt-2 text-xs text-gray-500">
          {t('breakEvenCard.otherNote')}
        </p>
      )}

      {/* Where the basket saving comes from — the per-line trace. */}
      {basketSaving.contributions.length > 0 && (
        <div className="mt-3 rounded-md bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium text-gray-700">
            {t('breakEvenCard.compositionHeading')}
          </p>
          <ul className="mt-1 space-y-0.5">
            {basketSaving.contributions.map((contribution) => (
              <li
                key={contribution.category}
                className="text-xs text-gray-600"
              >
                {t(`category.${contribution.category}`)}:{' '}
                {t('breakEvenCard.compositionLine', {
                  litres: formatLitres(contribution.litres),
                  difference: formatEur(contribution.differenceCentsPerLitre),
                  saving: formatEur(contribution.savingCents),
                })}
              </li>
            ))}
          </ul>
          {basketSaving.excludedCategories.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              {t('breakEvenCard.excludedNote', {
                categories: basketSaving.excludedCategories
                  .map((category) => t(`category.${category}`))
                  .join(', '),
              })}
            </p>
          )}
        </div>
      )}

      {/* The derivation itself — formula with its values, or the
          does-not-pay-for-itself state (never a negative quotient). */}
      {baskets !== null ? (
        <p
          data-testid="trip-break-even-baskets"
          className="mt-3 text-sm font-semibold text-gray-900"
        >
          {t('breakEvenCard.formula', {
            transport: formatEur(transportCostCents),
            other: formatEur(otherCostsCentsValue),
            saving: formatEur(basketSaving.totalCents),
            baskets: t('breakEvenCard.baskets', {
              count: formatBaskets(baskets),
            }),
          })}
        </p>
      ) : (
        <div
          data-testid="trip-break-even-not-paying"
          className="mt-3 rounded-md bg-gray-50 px-3 py-2"
        >
          <p className="text-xs font-medium text-gray-700">
            {t('breakEvenCard.notPayingOff')}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {t('breakEvenCard.notPayingOffBody')}
          </p>
        </div>
      )}

      {/* Allowance hint — the limits that cap the suggested basket. */}
      <p className="mt-3 text-sm text-gray-600">
        {t('breakEvenCard.allowanceHint')}{' '}
        <Link
          href="/allowances"
          className="text-primary-600 underline hover:text-primary-800"
        >
          {t('breakEvenCard.allowanceLink')}
        </Link>
      </p>
    </Card>
  );
}
