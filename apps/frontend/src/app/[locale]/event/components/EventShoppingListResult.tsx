'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { EventCalcResponse, ShoppingListLine } from '../event.types';
import { Badge, Card, EmptyState } from '@/components/ui';
import DisclaimerBanner from '../../calculator/components/DisclaimerBanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an API-returned litre figure for display.
 *
 * Values come from integer-millilitre arithmetic, so three fraction digits
 * are always exact — the figure is formatted, never re-rounded. `fi-FI`
 * gives the comma decimal separator (Finnish is the primary language; the
 * codebase formats for it regardless of locale, CalculatorResult precedent).
 */
function formatLitres(litres: number): string {
  return `${new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 3 }).format(litres)} l`;
}

/** One planned size rendered as "quantity × unit description". */
function PlannedUnitLine({
  line,
}: {
  readonly line: ShoppingListLine;
}) {
  const t = useTranslations('EventPage');
  if (line.plannedUnits.length === 0) {
    return <p className="text-sm text-gray-500">{t('result.noPurchase')}</p>;
  }
  return (
    <ul className="text-sm text-gray-700">
      {line.plannedUnits.map((unit) => (
        <li key={unit.description}>
          {t('result.unitQuantity', { quantity: unit.quantity })}{' '}
          {unit.description} ({formatLitres(unit.sizeLitres)})
        </li>
      ))}
    </ul>
  );
}

/** One shopping-list line: need, suggested purchase, surplus. */
function ShoppingListLineCard({ line }: { readonly line: ShoppingListLine }) {
  const t = useTranslations('EventPage');

  return (
    <Card padding="md" shadow="sm" data-testid="event-list-line">
      <h3 className="text-base font-semibold text-gray-900">
        {t(`drinkType.${line.drinkType}`)}
      </h3>
      <dl className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('result.need')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatLitres(line.needLitres)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('result.purchase')}</dt>
          <dd className="text-right text-sm font-medium text-gray-900">
            <PlannedUnitLine line={line} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('result.surplus')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatLitres(line.surplusLitres)}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EventShoppingListResultProps {
  /** The 200 response — both status states render, NO_PUBLISHED_NORMS explained. */
  readonly result: EventCalcResponse;
}

/**
 * Shopping-list output for the event calculator.
 *
 * Both result states carry the structural disclaimer from the API response
 * (rendered as returned, never a UI-only string). COMPUTED names the norms
 * version in the result view (design R5) and marks the figures with the
 * ESTIMATED badge — norms are estimates; the disclaimer covers the detail.
 * NO_PUBLISHED_NORMS is an explicit result value, rendered as a calm
 * explanation rather than an error.
 *
 * @module EventShoppingListResult
 */
export default function EventShoppingListResult({
  result,
}: EventShoppingListResultProps) {
  const t = useTranslations('EventPage');
  const tCommon = useTranslations('Common');

  return (
    <section aria-labelledby="event-result-heading" data-testid="event-result">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2
          id="event-result-heading"
          className="text-lg font-semibold text-gray-900"
        >
          {t('result.heading')}
        </h2>
        <Badge tone="estimated" size="sm">
          {tCommon('reliability.ESTIMATED')}
        </Badge>
      </div>

      {result.status === 'COMPUTED' ? (
        <>
          <p className="mb-4 text-xs text-gray-500">
            {t('result.normsVersion', { version: result.normsVersion })}
          </p>
          <div className="space-y-4">
            {result.lines.map((line) => (
              <ShoppingListLineCard key={line.drinkType} line={line} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          title={t('noNorms.title')}
          description={t('noNorms.body')}
        />
      )}

      {/* Structural disclaimer — the field from the API response. */}
      <div className="mt-6">
        <DisclaimerBanner disclaimer={result.disclaimer} />
      </div>
    </section>
  );
}
