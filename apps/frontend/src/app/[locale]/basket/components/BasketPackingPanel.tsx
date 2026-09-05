'use client';

/**
 * BasketPackingPanel — advisory box-suggestion section of the basket
 * optimize result (task 3.4, change product-roadmap-phases-1-4).
 *
 * Rendered only when the optimize response carries the flag-gated
 * `packing` section (`enable_packing_optimizer`): the backend attaches
 * the section per request, so presence of the key IS the gate — the UI
 * never checks the flag itself and no gated UI can appear late.
 *
 * Content:
 *  - Per-box cards: box name + carrier, fill-rate bar (fillRate 0..1),
 *    grouped items (product + units) and the box's total weight.
 *  - Mixing-warning badge with the triggering figures (glass/can unit
 *    counts, combined weight) and every threshold that fired — shown
 *    only when the response includes the warning.
 *  - ESTIMATED state (status ESTIMATED or any excluded line): a distinct
 *    reliability badge per the canonical D1/D2 ladder, and every excluded
 *    product named with quantity and reason — never silently dropped.
 *
 * Product display names resolve from the basket builder state via
 * `productNames`; unknown ids degrade to `#id`, never to an empty label.
 *
 * @module BasketPackingPanel
 */

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type {
  ExcludedPackingItem,
  MixingWarning,
  PackedBox,
  PackingSuggestion,
} from '@/lib/basket.types';
import { Card, ReliabilityBadge } from '@/components/ui';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a gram figure with locale grouping (the app's fi-FI precedent). */
function formatGrams(grams: number): string {
  return `${grams.toLocaleString('fi-FI')} g`;
}

/** Clamp a fill rate to the 0..1 band for presentation only. */
function clampFillRate(fillRate: number): number {
  if (!Number.isFinite(fillRate)) return 0;
  return Math.min(1, Math.max(0, fillRate));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Fill-rate bar — presentation clamps to 0..100 %; data stays unrounded. */
function FillBar({ fillRate, label }: { fillRate: number; label: string }) {
  const clamped = clampFillRate(fillRate);
  const percent = Math.round(clamped * 100);
  return (
    <div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
      >
        <div
          className="h-full rounded-full bg-primary-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1 text-xs tabular-nums text-gray-500">
        {percent}&nbsp;%
      </p>
    </div>
  );
}

/** One suggested box: name + carrier header, fill bar, grouped items. */
function BoxCard({
  box,
  productNames,
}: {
  box: PackedBox;
  productNames: ReadonlyMap<number, string>;
}) {
  const t = useTranslations('BasketPacking');
  const tCommon = useTranslations('Common');
  return (
    <Card padding="sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{box.boxName}</h3>
          <p className="text-xs text-gray-500">{box.carrier}</p>
        </div>
        <span className="text-sm tabular-nums text-gray-700">
          {formatGrams(box.totalWeightG)}
        </span>
      </div>

      <FillBar
        fillRate={box.fillRate}
        label={t('fillAriaLabel', { boxName: box.boxName })}
      />

      <ul className="mt-2 divide-y divide-gray-100">
        {box.items.map((item) => {
          const name = productNames.get(item.productId) ?? `#${item.productId}`;
          return (
            <li key={item.productId} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-gray-700">{name}</span>
              <span className="text-xs tabular-nums text-gray-500">
                {tCommon('unitCount', { count: item.units })}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Mixing-warning callout with the triggering figures: unit counts per
 * material, the combined weight, and every threshold that fired.
 */
function MixingWarningBadge({ warning }: { warning: MixingWarning }) {
  const t = useTranslations('BasketPacking');
  const triggers = warning.triggeredBy.map((trigger) =>
    t(`warning.trigger.${trigger}`),
  );
  return (
    <div
      data-testid="mixing-warning"
      role="alert"
      className="rounded-md border border-error-border bg-error-bg px-3 py-2"
    >
      <p className="text-xs font-semibold text-error-fg">{t('warning.title')}</p>
      <p className="mt-1 text-xs tabular-nums text-error-fg">
        {t('warning.figures', {
          glassUnits: warning.glassUnits,
          canUnits: warning.canUnits,
          combinedWeight: formatGrams(warning.combinedWeightG),
        })}
      </p>
      <p className="mt-1 text-xs text-error-fg">
        {t('warning.triggered', { triggers: triggers.join(', ') })}
      </p>
    </div>
  );
}

/** Excluded basket lines — each named, with quantity and reason. */
function ExcludedItems({
  items,
  productNames,
}: {
  items: readonly ExcludedPackingItem[];
  productNames: ReadonlyMap<number, string>;
}) {
  const t = useTranslations('BasketPacking');
  return (
    <div data-testid="packing-excluded">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t('excluded.title')}
      </h3>
      <ul className="space-y-1">
        {items.map((item, i) => {
          const name = productNames.get(item.productId) ?? `#${item.productId}`;
          return (
            <li
              key={`${item.productId}-${i}`}
              className="flex items-start gap-2 text-xs"
            >
              <span
                aria-hidden="true"
                className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-[2px] bg-status-estimated"
              />
              <span className="text-gray-600">
                {t('excluded.item', {
                  name,
                  count: item.quantity,
                  reason: t(`excluded.reason.${item.reason}`),
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface BasketPackingPanelProps {
  /** Flag-gated packing section from the optimize response. */
  readonly packing: PackingSuggestion | undefined;
  /** Product names from the basket builder, keyed by product ID. */
  readonly productNames: ReadonlyMap<number, string>;
}

/**
 * Advisory packing panel. Renders nothing when the section is absent —
 * the flag-off response shape, so the panel is hidden from the first
 * render without any client-side flag check.
 */
export default function BasketPackingPanel({
  packing,
  productNames,
}: BasketPackingPanelProps) {
  const t = useTranslations('BasketPacking');
  const tRoot = useTranslations();
  if (packing === undefined) {
    return null;
  }

  // status ESTIMATED ⇔ excluded lines exist (engine invariant); the OR
  // keeps the presentation honest even if that ever decouples.
  const isEstimated =
    packing.status === 'ESTIMATED' || packing.excludedItems.length > 0;

  if (packing.boxes.length === 0 && packing.excludedItems.length === 0) {
    return null;
  }

  return (
    <section data-testid="packing-panel" aria-labelledby="packing-panel-title">
      {/* ── Header ── */}
      <div className="mb-1 flex items-center gap-2">
        <h2 id="packing-panel-title" className="text-base font-semibold text-gray-900">
          {t('title')}
        </h2>
        {isEstimated && (
          <ReliabilityBadge status="ESTIMATED">
            {/* Canonical label — same source of truth as every other
                ESTIMATED presentation (compare view, results). */}
            {tRoot('Common.reliability.ESTIMATED')}
          </ReliabilityBadge>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-500">{t('advisory')}</p>

      {/* ── Mixing warning — only when the response reports one ── */}
      {packing.mixingWarning !== null && (
        <div className="mb-3">
          <MixingWarningBadge warning={packing.mixingWarning} />
        </div>
      )}

      {/* ── Suggested boxes ── */}
      {packing.boxes.length > 0 && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          {packing.boxes.map((box) => (
            <BoxCard
              key={box.boxTypeId}
              box={box}
              productNames={productNames}
            />
          ))}
        </div>
      )}

      {/* ── Excluded lines — named, never silently dropped ── */}
      {packing.excludedItems.length > 0 && (
        <ExcludedItems
          items={packing.excludedItems}
          productNames={productNames}
        />
      )}
    </section>
  );
}
