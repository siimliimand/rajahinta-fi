'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button, Card } from '@/components/ui';
import {
  DRAFT_BOUNDS,
  DRAFT_CATEGORY_KEYS,
  RATE_SLIDER,
  type ProductDraft,
} from '../scenario-draft';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WhatIfFormProps {
  /** Hypothetical rate (€ per formula unit) — the slider value. */
  readonly rate: number;
  readonly rows: readonly ProductDraft[];
  /** True when an EXISTING result's draft has drifted invalid — the hint
   *  explains why the figures stopped updating. The no-result blank state
   *  is owned by the page's empty state instead. */
  readonly invalidNotice: boolean;
  /** True while a rate-limit countdown suppresses recomputation. */
  readonly throttled: boolean;
  readonly onRateChange: (rate: number) => void;
  readonly onRowChange: (key: string, patch: Partial<Omit<ProductDraft, 'key'>>) => void;
  readonly onAddRow: () => void;
  readonly onRemoveRow: (key: string) => void;
  /** Run the recalculation immediately, bypassing the debounce. */
  readonly onRecalculate: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The what-if scenario form: the hypothetical-rate slider plus the
 * product rows. Fully controlled — the page owns the draft state and the
 * debounced recalculation; this component only reports edits.
 *
 * The slider is a native range input (the design system has no slider
 * primitive; the native control is the slider-friendly input) with the
 * value read out as text, so the figure is never carried by the control's
 * visual position alone.
 */
export default function WhatIfForm({
  rate,
  rows,
  invalidNotice,
  throttled,
  onRateChange,
  onRowChange,
  onAddRow,
  onRemoveRow,
  onRecalculate,
}: WhatIfFormProps) {
  const t = useTranslations('WhatIfPage');

  const rowNumber = new Map(rows.map((row, index) => [row.key, index + 1]));

  return (
    <div>
      {/* ── Hypothetical rate slider ── */}
      <div className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label
            htmlFor="what-if-rate"
            className="text-sm font-medium text-gray-700"
          >
            {t('form.rateLabel')}
          </label>
          <output
            htmlFor="what-if-rate"
            data-testid="what-if-rate-value"
            className="text-sm font-semibold text-gray-900"
          >
            {t('form.rateValue', { rate })}
          </output>
        </div>
        <input
          id="what-if-rate"
          data-testid="what-if-rate-slider"
          type="range"
          min={RATE_SLIDER.min}
          max={RATE_SLIDER.max}
          step={RATE_SLIDER.step}
          value={rate}
          aria-describedby="what-if-rate-hint"
          onChange={(event) => onRateChange(Number(event.target.value))}
          className="mt-2 w-full accent-primary-600"
        />
        <p id="what-if-rate-hint" className="mt-1 text-xs text-gray-500">
          {t('form.rateHint')}
        </p>
      </div>

      {/* ── Product rows ── */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">{t('form.rowsHeading')}</h2>
        <p className="text-xs text-gray-500">
          {t('form.rowCount', { count: rows.length, max: DRAFT_BOUNDS.maxProducts })}
        </p>
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const number = rowNumber.get(row.key) ?? rows.length;
          const id = (field: string) => `what-if-${field}-${row.key}`;
          const change = (patch: Partial<Omit<ProductDraft, 'key'>>) =>
            onRowChange(row.key, patch);
          return (
            <Card key={row.key} muted padding="sm" data-testid={`what-if-row-${row.key}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-700">
                  {t('form.rowLabel', { index: number })}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={rows.length <= 1}
                  aria-label={t('form.removeRowAria', { index: number })}
                  onClick={() => onRemoveRow(row.key)}
                >
                  ✕
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label htmlFor={id('category')} className="mb-1 block text-xs font-medium text-gray-600">
                    {t('form.category')}
                  </label>
                  <select
                    id={id('category')}
                    value={row.category}
                    onChange={(event) => change({ category: event.target.value as ProductDraft['category'] })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                  >
                    {DRAFT_CATEGORY_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {t(`category.${key}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={id('abv')} className="mb-1 block text-xs font-medium text-gray-600">
                    {t('form.abv')}
                  </label>
                  <input
                    id={id('abv')}
                    type="text"
                    inputMode="decimal"
                    value={row.abvPercent}
                    onChange={(event) => change({ abvPercent: event.target.value })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label htmlFor={id('volume')} className="mb-1 block text-xs font-medium text-gray-600">
                    {t('form.volume')}
                  </label>
                  <input
                    id={id('volume')}
                    type="text"
                    inputMode="decimal"
                    value={row.volumeLitres}
                    onChange={(event) => change({ volumeLitres: event.target.value })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label htmlFor={id('alko')} className="mb-1 block text-xs font-medium text-gray-600">
                    {t('form.alkoPrice')}
                  </label>
                  <input
                    id={id('alko')}
                    type="text"
                    inputMode="decimal"
                    value={row.alkoPriceEur}
                    onChange={(event) => change({ alkoPriceEur: event.target.value })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label htmlFor={id('import')} className="mb-1 block text-xs font-medium text-gray-600">
                    {t('form.importPrice')}
                  </label>
                  <input
                    id={id('import')}
                    type="text"
                    inputMode="decimal"
                    value={row.importPriceEur}
                    onChange={(event) => change({ importPriceEur: event.target.value })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* ── Row management + manual recalculation ── */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={rows.length >= DRAFT_BOUNDS.maxProducts}
          onClick={onAddRow}
        >
          {t('form.addRow')}
        </Button>
        <Button size="sm" disabled={throttled} onClick={onRecalculate}>
          {t('form.recalculate')}
        </Button>
      </div>

      {invalidNotice && (
        <p role="status" data-testid="what-if-invalid-hint" className="mt-3 text-xs text-gray-500">
          {t('form.invalidHint')}
        </p>
      )}
    </div>
  );
}
