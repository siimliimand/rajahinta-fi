'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { formatAbv, formatVolume } from '@/lib/format/product-attributes';
import type { ProductSearchItem } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents to a euro string (shared frontend convention). */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProductSelectorProps {
  /** Products returned by the search. */
  items: ProductSearchItem[];
  /** ID of the currently selected product, or null. */
  selectedId: number | null;
  /** Called when the user selects a product. */
  onSelect: (product: ProductSearchItem) => void;
  /** Whether a search is in flight. */
  loading: boolean;
  /** The search query that produced these items. */
  query: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Displays a list of products from a search result and allows selection.
 *
 * Shows a loading skeleton while results are being fetched, and a "no results"
 * message when the search returned empty.
 */
export default function ProductSelector({
  items,
  selectedId,
  onSelect,
  loading,
  query,
}: ProductSelectorProps) {
  const t = useTranslations('ProductSelector');

  // Loading state
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-md border border-gray-200 p-3"
          >
            <div className="mb-1 h-4 w-3/4 rounded bg-gray-200" />
            <div className="h-3 w-1/2 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    if (query.trim().length === 0) {
      return <p className="text-sm text-gray-500">{t('typeToSearch')}</p>;
    }
    return (
      <p className="text-sm text-gray-500">{t('noResults', { query })}</p>
    );
  }

  // Results list
  return (
    <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
      {items.map((product) => {
        const isSelected = product.id === selectedId;
        // Shared attribute formatters (task 4.1): the volume carries an
        // explicit unit label and the ABV renders as a percentage — the
        // raw `abvValue` interpolation leaked stored fractions as
        // "0.047% ABV".
        const volume = formatVolume(product.unitVolume);
        const abv = formatAbv(product.alcoholByVolume);
        return (
          <li key={product.id}>
            <button
              type="button"
              onClick={() => onSelect(product)}
              className={`w-full px-3 py-3 text-left text-sm transition-colors hover:bg-primary-50 focus:bg-primary-50 focus:outline-none ${
                isSelected
                  ? 'bg-primary-100 ring-1 ring-inset ring-primary-500'
                  : ''
              }`}
            >
              <span className="block font-medium text-gray-900">
                {product.name}
              </span>
              <span className="block text-xs text-gray-500">
                {product.brand}
                {product.category ? ` · ${product.category}` : ''}
                {volume ? ` · ${volume}` : ''}
                {abv ? ` · ${abv}` : ''}
              </span>
              {/* ── Lowest observed price (change
                  unit-integrity-and-result-trust, task 3.2): rendered only
                  when the product has offers — an offer-less row stays
                  honestly empty, never a displayed €0.00. ── */}
              {product.lowestPriceCents !== null && (
                <span
                  className="mt-0.5 block text-xs font-medium text-gray-700"
                  data-testid="row-lowest-price"
                >
                  {t('lowestPrice', {
                    price: formatEur(product.lowestPriceCents),
                  })}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
