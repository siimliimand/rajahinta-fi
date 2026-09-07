'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { CompareSortOrder } from '@/lib/types';
import { COMPARE_SORT_OPTIONS } from '../sort-products';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SortSelectorProps {
  /** Currently selected sort order. */
  value: CompareSortOrder;
  /** Called when the user selects a new sort order. */
  onChange: (sort: CompareSortOrder) => void;
  /** Whether results are being loaded. */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sort order selector for product comparison views.
 *
 * Renders a labelled select with all available objective sort orders.
 * Visually neutral — no "recommended", "popular", or promoted labels.
 * Every option is presented with equal weight.
 */
export default function SortSelector({
  value,
  onChange,
  disabled = false,
}: SortSelectorProps) {
  const t = useTranslations('SortSelector');
  const tSorts = useTranslations('SortOrders');
  const tCompare = useTranslations('Compare');

  function label(order: CompareSortOrder): string {
    return order === 'EUR_PER_GRAM'
      ? tCompare('eurPerGram.sortOptionLabel')
      : tSorts(`${order}.label`);
  }

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="sort-order"
        className="whitespace-nowrap text-xs font-medium text-gray-500"
      >
        {t('label')}
      </label>
      <select
        id="sort-order"
        value={value}
        onChange={(e) => onChange(e.target.value as CompareSortOrder)}
        disabled={disabled}
        className="block rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {COMPARE_SORT_OPTIONS.map((order) => (
          <option key={order} value={order}>
            {label(order)}
          </option>
        ))}
      </select>
    </div>
  );
}
