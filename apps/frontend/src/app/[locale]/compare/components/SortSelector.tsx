'use client';

import { useTranslations } from 'next-intl';
import type { SortOrder } from '@/lib/types';

// ---------------------------------------------------------------------------
// Sort order values (labels come from the message catalogs)
// ---------------------------------------------------------------------------

const SORT_ORDER_VALUES: readonly SortOrder[] = [
  'LOWEST_LANDED_COST',
  'LOWEST_PER_LITRE',
  'LOWEST_PER_UNIT',
  'ALPHABETICAL',
  'ALCOHOL_PERCENTAGE',
  'PRODUCT_CATEGORY',
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
  const t = useTranslations('SortSelector');
  const tSorts = useTranslations('SortOrders');

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
        onChange={(e) => onChange(e.target.value as SortOrder)}
        disabled={disabled}
        className="block rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {SORT_ORDER_VALUES.map((order) => (
          <option key={order} value={order}>
            {tSorts(`${order}.label`)}
          </option>
        ))}
      </select>
    </div>
  );
}
