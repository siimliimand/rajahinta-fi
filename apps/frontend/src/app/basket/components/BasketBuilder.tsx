'use client';

/**
 * BasketBuilder — multi-item product search and basket composition UI.
 *
 * Provides:
 *  - Product search (reusing the searchProducts API, same pattern as the
 *    calculator page's ProductSearch + ProductSelector)
 *  - Add-to-basket with quantity
 *  - Current basket items list with inline quantity adjustment and removal
 *  - Destination country selector
 *  - Transport arrangement selector
 *  - Item count display against configurable cap with inline messaging
 *
 * No result display lives here — that is the responsibility of
 * {@link BasketResults}.
 *
 * @module BasketBuilder
 */

import { useState, useCallback, useRef } from 'react';
import type { ProductSearchItem, ProductSearchResult } from '@/lib/types';
import { searchProducts } from '@/lib/api';
import type { TransportArrangement } from '@/lib/basket.types';
import QuantitySelector from '../../calculator/components/QuantitySelector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BasketItem {
  readonly productId: number;
  readonly productName: string;
  readonly quantity: number;
}

interface BasketBuilderProps {
  /** Current basket items. */
  readonly items: readonly BasketItem[];
  /** Maximum number of items allowed. */
  readonly maxItems: number;
  /** Minimum query length before firing a search. */
  readonly minQueryLength: number;
  /** Selected destination country code. */
  readonly destination: string;
  /** Selected transport arrangement. */
  readonly transportArrangement: TransportArrangement;
  /** Called when a product is added to the basket. */
  readonly onAddItem: (productId: number, productName: string) => void;
  /** Called when an item's quantity changes. */
  readonly onUpdateQuantity: (productId: number, quantity: number) => void;
  /** Called when an item is removed from the basket. */
  readonly onRemoveItem: (productId: number) => void;
  /** Called when the destination changes. */
  readonly onDestinationChange: (country: string) => void;
  /** Called when the transport arrangement changes. */
  readonly onTransportArrangementChange: (arrangement: TransportArrangement) => void;
}

// ---------------------------------------------------------------------------
// Destination countries (common cross-border purchase destinations)
// ---------------------------------------------------------------------------

const COMMON_DESTINATIONS = [
  { code: 'FI', label: 'Finland' },
  { code: 'EE', label: 'Estonia' },
  { code: 'LV', label: 'Latvia' },
  { code: 'LT', label: 'Lithuania' },
  { code: 'DE', label: 'Germany' },
  { code: 'SE', label: 'Sweden' },
  { code: 'DK', label: 'Denmark' },
  { code: 'PL', label: 'Poland' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'BE', label: 'Belgium' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'Spain' },
  { code: 'IT', label: 'Italy' },
  { code: 'AT', label: 'Austria' },
  { code: 'CZ', label: 'Czech Republic' },
];

// ---------------------------------------------------------------------------
// Transport arrangement labels
// ---------------------------------------------------------------------------

const TRANSPORT_LABELS: Record<TransportArrangement, string> = {
  SELLER_ARRANGED: 'Seller-arranged',
  INDEPENDENT_CARRIER: 'Independent carrier',
  PERSONAL: 'Personal (carry across border)',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Basket builder with product search, inline quantity adjustment,
 * destination, and transport arrangement selection.
 */
export default function BasketBuilder({
  items,
  maxItems,
  minQueryLength,
  destination,
  transportArrangement,
  onAddItem,
  onUpdateQuantity,
  onRemoveItem,
  onDestinationChange,
  onTransportArrangementChange,
}: BasketBuilderProps) {
  // ── Search state ──
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const searchInFlight = useRef(false);

  // ── Search handler ──
  const handleSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < minQueryLength || searchInFlight.current) return;

    searchInFlight.current = true;
    setSearchLoading(true);
    setSearchError(null);
    setHasSearched(true);

    try {
      const res = await searchProducts(trimmed);
      setSearchResults(res.items);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Search failed. Please try again.';
      setSearchError(message);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
      searchInFlight.current = false;
    }
  }, [minQueryLength]);

  // ── Add handler ──
  const handleSelect = useCallback(
    (product: ProductSearchItem) => {
      if (items.length >= maxItems) return;
      onAddItem(product.id, product.name);
      // Clear search after adding
      setQuery('');
      setSearchResults([]);
      setHasSearched(false);
    },
    [items.length, maxItems, onAddItem],
  );

  const atCapacity = items.length >= maxItems;

  return (
    <div className="space-y-6">
      {/* ── Product search (reuse the calculator's search pattern) ── */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          Add products
        </h2>

        {atCapacity ? (
          <p className="text-sm text-amber-700">
            Basket is full ({maxItems} items maximum). Remove an item to add
            another.
          </p>
        ) : (
          <>
            {/* Search input */}
            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearch(query);
                  }
                }}
                placeholder="Search products…"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <button
                type="button"
                onClick={() => handleSearch(query)}
                disabled={searchLoading}
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {searchLoading ? 'Searching…' : 'Search'}
              </button>
            </div>

            {searchError && (
              <p className="mb-2 text-sm text-red-600">{searchError}</p>
            )}

            {/* Search results */}
            {hasSearched && (
              <div className="max-h-56 overflow-y-auto">
                {searchLoading ? (
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
                ) : searchResults.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {query.trim().length === 0
                      ? 'Type a product name to start searching.'
                      : `No products found for "${query}".`}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
                    {searchResults.map((product) => (
                      <li key={product.id}>
                        <button
                          type="button"
                          onClick={() => handleSelect(product)}
                          className="w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
                        >
                          <span className="block font-medium text-gray-900">
                            {product.name}
                          </span>
                          <span className="block text-xs text-gray-500">
                            {product.brand}
                            {product.category
                              ? ` · ${product.category}`
                              : ''}
                            {product.unitVolume
                              ? ` · ${product.unitVolume}`
                              : ''}
                            {product.alcoholByVolume !== null
                              ? ` · ${product.alcoholByVolume}% ABV`
                              : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Current basket items ── */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Basket ({items.length}/{maxItems})
          </h2>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-400">
            No products added yet. Use the search above to add products.
          </p>
        ) : (
          <>
            {/* Item cap warning */}
            {atCapacity && (
              <p className="mb-3 text-xs text-amber-600">
                Maximum {maxItems} items reached. Remove an item to add another.
              </p>
            )}

            <ul className="divide-y divide-gray-100">
              {items.map((item) => (
                <li
                  key={item.productId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {item.productName}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <QuantitySelector
                      value={item.quantity}
                      onChange={(q) => onUpdateQuantity(item.productId, q)}
                      min={1}
                      max={99}
                    />

                    <button
                      type="button"
                      onClick={() => onRemoveItem(item.productId)}
                      className="text-xs font-medium text-red-600 hover:text-red-800"
                      aria-label={`Remove ${item.productName}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ── Destination ── */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <label
          htmlFor="basket-destination"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Destination country
        </label>
        <select
          id="basket-destination"
          value={destination}
          onChange={(e) => onDestinationChange(e.target.value)}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {COMMON_DESTINATIONS.map((d) => (
            <option key={d.code} value={d.code}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Transport arrangement ── */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700">
            Transport arrangement
          </legend>
          <div className="space-y-2">
            {(
              Object.entries(TRANSPORT_LABELS) as [
                TransportArrangement,
                string,
              ][]
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="radio"
                  name="transportArrangement"
                  value={value}
                  checked={transportArrangement === value}
                  onChange={() => onTransportArrangementChange(value)}
                  className="text-primary-600 focus:ring-primary-500"
                />
                {label}
                {value === 'PERSONAL' && (
                  <span className="text-xs text-gray-400">
                    (single-store combinations only)
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}