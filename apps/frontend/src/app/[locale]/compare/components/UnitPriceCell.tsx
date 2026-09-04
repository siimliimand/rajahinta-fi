'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { UnitPriceResult } from '@/lib/types';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';
import { ReliabilityBadge } from '@/components/ui';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The €/g ethanol cell of a compare column (flag-gated by the caller).
 *
 * - computed/ESTIMATED: value in localized ¢/g plus the input price's
 *   reliability badge — the canonical VERIFIED/ESTIMATED presentation.
 * - unavailable / not resolved: an explicit "no value" dash — never a
 *   substituted 0 — and, when the API reported a reason, that reason.
 *
 * The ⓘ affordance opens an accessible tooltip stating the formula,
 * the ethanol density constant (789 g/l), and the reliability of the
 * underlying price input (unit-price-metrics spec: formula transparency).
 */
export default function UnitPriceCell({
  metric,
  tooltipId,
}: {
  metric: UnitPriceResult | undefined;
  /** Unique per column — the cell renders once per compared product. */
  tooltipId: string;
}) {
  const t = useTranslations('Compare');
  const tRoot = useTranslations();

  const value =
    metric !== undefined && metric.status !== 'unavailable' ? metric : null;
  // Root translator + canonical label key: same source of truth as every
  // other reliability presentation in the app.
  const statusLabel =
    value !== null
      ? tRoot(RELIABILITY_STATUS_META[value.priceReliability].labelKey)
      : null;

  return (
    <div className="group/eurpergram relative mb-3 flex items-center gap-1.5">
      <span className="text-xs text-gray-400">
        {t('eurPerGram.columnHeader')}
      </span>

      {value === null ? (
        <span
          className="text-sm font-semibold text-gray-400"
          aria-label={t('eurPerGram.noValue')}
        >
          —
        </span>
      ) : (
        <span className="text-sm font-semibold tabular-nums text-gray-900">
          {value.centsPerGram.toFixed(2)} {t('eurPerGram.unit')}
        </span>
      )}

      {/* Input reliability — same badge presentation as elsewhere */}
      {value !== null && statusLabel !== null && (
        <ReliabilityBadge status={value.priceReliability} size="sm">
          {statusLabel}
        </ReliabilityBadge>
      )}

      {/* Formula tooltip — visible on hover and keyboard focus */}
      <button
        type="button"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-300 text-[10px] font-medium leading-none text-gray-500 hover:border-gray-400 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        aria-label={t('eurPerGram.tooltip.triggerLabel')}
        aria-describedby={tooltipId}
      >
        i
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="invisible absolute bottom-full left-0 z-10 mb-1 w-64 rounded-md border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-600 shadow-lg group-hover/eurpergram:visible group-focus-within/eurpergram:visible"
      >
        <span className="mb-1 block font-semibold text-gray-700">
          {t('eurPerGram.tooltip.title')}
        </span>
        <span className="mb-1 block">{t('eurPerGram.tooltip.formula')}</span>
        <span className="mb-1 block">{t('eurPerGram.tooltip.density')}</span>
        {value !== null ? (
          <span className="block">
            {t('eurPerGram.tooltip.priceReliability', {
              status: statusLabel ?? value.priceReliability,
            })}
          </span>
        ) : metric !== undefined && metric.status === 'unavailable' ? (
          <span className="block">
            {t('eurPerGram.tooltip.unavailableReason', {
              reason: t(`eurPerGram.reason.${metric.reason}`),
            })}
          </span>
        ) : (
          <span className="block">{t('eurPerGram.noValue')}</span>
        )}
      </span>
    </div>
  );
}
