'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type {
  BudgetCheck,
  EventPackingSection,
  EventSourcingPlan,
  SourcingPlanLine,
} from '../event.types';
import { Badge, Card, ConfidenceBadge } from '@/components/ui';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format cents to a euro string — the CalculatorResult precedent. */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// One plan line — winning source with its figure provenance
// ---------------------------------------------------------------------------

function PlanLineCard({ line }: { readonly line: SourcingPlanLine }) {
  const t = useTranslations('EventPage');
  const tCommon = useTranslations('Common');

  const foreign = line.sourceKind === 'FOREIGN';

  return (
    <Card padding="md" shadow="sm" data-testid="event-plan-line">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">
          {t(`drinkType.${line.drinkType}`)}
        </h3>
        <div className="flex items-center gap-2">
          {/* Badge forwards no extra props — the test id lives on the wrapper. */}
          <span data-testid="event-plan-source">
            <Badge tone="neutral" size="sm">
              {foreign
                ? t('plan.bringFrom', { country: t(`form.sourcing.countryName.${line.sourceCountry}`) })
                : t('plan.buyHere')}
            </Badge>
          </span>
          <ConfidenceBadge level={line.confidenceOverall} size="sm">
            {tCommon(`confidence.${line.confidenceOverall}`)}
          </ConfidenceBadge>
        </div>
      </div>

      <dl className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('plan.retail')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatEur(line.components.retailCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('plan.excise')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatEur(line.components.exciseCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">{t('plan.containerDuty')}</dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatEur(line.components.containerDutyCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-gray-500">
            {t('plan.transport')}{' '}
            <span className="text-xs text-gray-400">
              ({tCommon(`reliability.${line.statuses.transport}`)})
            </span>
          </dt>
          <dd className="text-sm font-medium text-gray-900">
            {formatEur(line.components.transportCents)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-gray-100 pt-2">
          <dt className="text-sm font-medium text-gray-700">{t('plan.lineTotal')}</dt>
          <dd className="text-sm font-bold text-gray-900">{formatEur(line.totalCents)}</dd>
        </div>
      </dl>

      {line.savingsVsDomesticCents > 0 && (
        <p className="mt-2 text-xs text-green-700" data-testid="event-plan-savings">
          {t('plan.savings', { amount: formatEur(line.savingsVsDomesticCents) })}
        </p>
      )}

      {/* Traceability: the datasets that produced this line's figures. */}
      {line.datasetVersions.length > 0 && (
        <p className="mt-1 text-xs text-gray-400">
          {t('plan.datasets', { versions: line.datasetVersions.join(', ') })}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Budget state — explicit, never a silently truncated plan
// ---------------------------------------------------------------------------

function BudgetBanner({ budget }: { readonly budget: BudgetCheck }) {
  const t = useTranslations('EventPage');
  if (budget.met) {
    return (
      <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800" data-testid="event-plan-budget-met">
        {t('plan.budgetMet', { total: formatEur(budget.totalCents), limit: formatEur(budget.limitCents) })}
      </p>
    );
  }
  return (
    <p
      role="alert"
      className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
      data-testid="event-plan-budget-exceeded"
    >
      {t('plan.budgetExceeded', {
        total: formatEur(budget.totalCents),
        limit: formatEur(budget.limitCents),
        overrun: formatEur(budget.overrunCents),
      })}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Packing panel — the R4 module's output over the foreign haul
// ---------------------------------------------------------------------------

function PackingPanel({ packing }: { readonly packing: EventPackingSection }) {
  const t = useTranslations('EventPage');
  const tCommon = useTranslations('Common');
  const { suggestion } = packing;
  const typeByProductId = new Map(packing.lines.map((line) => [line.productId, line.drinkType]));

  return (
    <Card padding="md" shadow="sm" data-testid="event-plan-packing">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-gray-900">{t('plan.packing.heading')}</h3>
        <Badge tone={suggestion.status === 'COMPUTED' ? 'verified' : 'estimated'} size="sm">
          {tCommon(`reliability.${suggestion.status}`)}
        </Badge>
      </div>

      {suggestion.boxes.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{t('plan.packing.noBoxes')}</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-gray-700">
          {suggestion.boxes.map((box) => (
            <li key={box.boxTypeId}>
              {t('plan.packing.box', {
                name: box.boxName,
                units: box.items.reduce((sum, item) => sum + item.units, 0),
                fill: new Intl.NumberFormat('fi-FI', { style: 'percent', maximumFractionDigits: 0 }).format(box.fillRate),
              })}
            </li>
          ))}
        </ul>
      )}

      {suggestion.excludedItems.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-500">{t('plan.packing.excludedHeading')}</p>
          <ul className="mt-1 text-xs text-gray-600">
            {suggestion.excludedItems.map((item) => (
              <li key={item.productId}>
                {t('plan.packing.excludedItem', {
                  type: typeByProductId.get(item.productId) ?? String(item.productId),
                  quantity: item.quantity,
                })}{' '}
                — {t(`plan.packing.reason.${item.reason}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestion.mixingWarning && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('plan.packing.mixingWarning', {
            glass: suggestion.mixingWarning.glassUnits,
            can: suggestion.mixingWarning.canUnits,
          })}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EventPlanResultProps {
  readonly plan: EventSourcingPlan;
  readonly packing?: EventPackingSection | undefined;
}

/**
 * The V2 sourcing plan view (task 4.5): per-line source assignment with
 * the full component figures, plan total, explicit budget state, and
 * the optional packing panel. Every figure comes from the response —
 * the plan names the winning source, the components that produced each
 * line total, and the datasets behind them (guardrail: every number is
 * explainable).
 *
 * @module EventPlanResult
 */
export default function EventPlanResult({ plan, packing }: EventPlanResultProps) {
  const t = useTranslations('EventPage');

  return (
    <section aria-labelledby="event-plan-heading" data-testid="event-plan">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="event-plan-heading" className="text-lg font-semibold text-gray-900">
          {t('plan.heading')}
        </h2>
        <p className="text-sm text-gray-700">
          {t('plan.total')} <span className="font-bold">{formatEur(plan.totalCents)}</span>
        </p>
      </div>

      {plan.budget && <BudgetBanner budget={plan.budget} />}

      <div className="space-y-4">
        {plan.lines.map((line) => (
          <PlanLineCard key={line.drinkType} line={line} />
        ))}
      </div>

      {plan.unpricedDrinkTypes.length > 0 && (
        <p className="mt-3 text-xs text-gray-500" data-testid="event-plan-unpriced">
          {t('plan.unpriced', { types: plan.unpricedDrinkTypes.map((type) => t(`drinkType.${type}`)).join(', ') })}
        </p>
      )}

      {packing && (
        <div className="mt-4">
          <PackingPanel packing={packing} />
        </div>
      )}
    </section>
  );
}
