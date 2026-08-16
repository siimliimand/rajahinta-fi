'use client';

import type { SortOrder } from '@/lib/types';

// ---------------------------------------------------------------------------
// Labels and descriptions for each sort order
// ---------------------------------------------------------------------------

const SORT_OPTIONS: Array<{ value: SortOrder; label: string }> = [
  {
    value: 'LOWEST_LANDED_COST',
    label: 'Lowest landed cost',
  },
  {
    value: 'LOWEST_PER_LITRE',
    label: 'Lowest per litre',
  },
  {
    value: 'LOWEST_PER_UNIT',
    label: 'Lowest per unit',
  },
  { value: 'ALPHABETICAL', label: 'Alphabetical (A–Z)' },
  {
    value: 'ALCOHOL_PERCENTAGE',
    label: 'Alcohol % (highest first)',
  },
  {
    value: 'PRODUCT_CATEGORY',
    label: 'Category',
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SortSelectorProps {
  /** Currently selected sort order. */
  value: SortOrder;
  /** Called when the user selects a new sort order. */
  onChange: (sort: SortOrder) => void;
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
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="sort-order"
        className="whitespace-nowrap text-xs font-medium text-gray-500"
      >
        Sort by
      </label>
      <select
        id="sort-order"
        value={value}
        onChange={(e) => onChange(e.target.value as SortOrder)}
        disabled={disabled}
        className="block rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}