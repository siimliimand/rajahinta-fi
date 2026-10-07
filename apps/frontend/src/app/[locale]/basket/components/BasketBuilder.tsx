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

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ProductSearchItem } from '@/lib/types';
import {
  searchProducts,
  getSavingsBestPerMerchant,
} from '@/lib/api';
import type { SavingsBestPerMerchantRow } from '@/lib/api';
import { formatAttributeRow } from '@/lib/format/product-attributes';
import { formatMoney } from '@/lib/format/money';
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

const COUNTRY_CODES: readonly string[] = [
  'FI',
  'EE',
  'LV',
  'LT',
  'DE',
  'SE',
  'DK',
  'PL',
  'NL',
  'BE',
  'FR',
  'ES',
  'IT',
  'AT',
  'CZ',
];

const TRANSPORT_VALUES: readonly TransportArrangement[] = [
  'SELLER_ARRANGED',
  'INDEPENDENT_CARRIER',
  'PERSONAL',
];

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
  const t = useTranslations('BasketCommon');
  const tCommon = useTranslations('Common');
  const tSearch = useTranslations('ProductSearch');
  const tSel = useTranslations('ProductSelector');
  const tCalc = useTranslations('Calculator');
  const locale = useLocale();

  // ── Search state ──
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // ── Example deals (task 3.3, change savings-first-catalog-and-prefill):
  // the empty state's per-merchant examples, fetched once per mount.
  // Display face only — the rows are never added to the basket
  // automatically.
  const [exampleDeals, setExampleDeals] = useState<
    readonly SavingsBestPerMerchantRow[]
  >([]);
  const examplesFetchedRef = useRef(false);

  useEffect(() => {
    if (examplesFetchedRef.current) return;
    examplesFetchedRef.current = true;
    let cancelled = false;
    getSavingsBestPerMerchant()
      .then((res) => {
        if (!cancelled) setExampleDeals(res.merchants);
      })
      .catch(() => {
        // Honest degrade: an empty listing (no materialized day) or a
        // failed read leaves the plain empty text standing — never an
        // invented example.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        err instanceof Error ? err.message : tCalc('searchFailed');
      setSearchError(message);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
      searchInFlight.current = false;
    }
  }, [minQueryLength, tCalc]);

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

  /**
   * One-click example-basket fill (task 3.3): adds every listed row
   * through the same `onAddItem` path a search selection uses, up to the
   * remaining capacity. The basket never fills itself — this runs only
   * on the visitor's click, and the added rows are regular items the
   * visitor can re-quantity or remove.
   */
  const fillExampleBasket = useCallback(() => {
    let count = items.length;
    for (const row of exampleDeals) {
      if (count >= maxItems) break;
      onAddItem(row.productId, row.productName);
      count += 1;
    }
  }, [exampleDeals, items.length, maxItems, onAddItem]);

  return (
    <div className="space-y-6">
      {/* ── Product search (reuse the calculator's search pattern) ── */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          {t('addProducts')}
        </h2>

        {atCapacity ? (
          <p className="text-sm text-amber-700">
            {t('basketFull', { max: maxItems })}
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
                placeholder={tSearch('placeholder')}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <button
                type="button"
                onClick={() => handleSearch(query)}
                disabled={searchLoading}
                className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {searchLoading ? tSearch('searching') : tSearch('search')}
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
                      ? tSel('typeToSearch')
                      : tSel('noResults', { query })}
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
                            {formatAttributeRow(
                              product.brand,
                              product.category,
                              product.unitVolume,
                              product.alcoholByVolume !== null
                                ? tCommon('abvValue', {
                                    value: product.alcoholByVolume,
                                  })
                                : null,
                            )}
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
            {t('basketTitle', { count: items.length, max: maxItems })}
          </h2>
          {/* Literal used/capacity counter — the numbers render as-is so
              the cap is visible before it is hit; the localized heading
              above carries the same counts for assistive tech, so the
              duplicate digit pair stays hidden from it. */}
          <span
            data-testid="basket-item-progress"
            aria-hidden="true"
            className="text-xs font-medium tabular-nums text-gray-500"
          >
            {items.length}/{maxItems}
          </span>
        </div>

        {items.length === 0 ? (
          <div>
            <p className="text-sm text-gray-400">{t('emptyBasket')}</p>

            {/* ── Example deals (task 3.3, change
                savings-first-catalog-and-prefill): the empty state lists
                the per-merchant snapshot deals with per-item add buttons
                and a one-click example-basket fill. Nothing is ever
                auto-added — the basket starts empty, and both actions run
                through the same onAddItem path a search selection uses.
                An empty listing (no materialized day) or a failed read
                renders nothing new. ── */}
            {exampleDeals.length > 0 && (
              <div
                data-testid="basket-examples"
                className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3"
              >
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t('exampleDealsHeading')}{' '}
                    <span
                      data-testid="basket-example-badge"
                      className="inline-flex rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700"
                    >
                      {t('exampleBadge')}
                    </span>
                  </p>
                </div>
                <p className="mb-1 text-xs leading-relaxed text-gray-500">
                  {t.rich('exampleDealsNote', {
                    link: (chunks) => (
                      <Link
                        href="/savings"
                        className="text-primary-600 underline hover:text-primary-800"
                      >
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
                <ul className="divide-y divide-gray-200">
                  {exampleDeals.map((row) => (
                    <li
                      key={row.productId}
                      data-testid="basket-example-row"
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {row.productName}
                        </p>
                        <p className="text-xs text-gray-500">
                          {row.merchant} · {row.merchantCountry}
                        </p>
                        <p className="text-xs tabular-nums text-gray-600">
                          {t('exampleLandedTotal', {
                            price: formatMoney(row.landedTotalCents, locale),
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid="basket-example-add"
                        onClick={() =>
                          onAddItem(row.productId, row.productName)
                        }
                        aria-label={t('addExampleAria', {
                          name: row.productName,
                        })}
                        className="touch-target inline-flex shrink-0 items-center rounded-md border border-primary-600 bg-white px-3 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                      >
                        {t('addExample')}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  data-testid="fill-example-basket"
                  onClick={fillExampleBasket}
                  disabled={atCapacity}
                  className="touch-target mt-3 inline-flex items-center rounded-md border border-primary-600 bg-white px-3 py-1.5 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('fillExampleBasket')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Item cap warning */}
            {atCapacity && (
              <p className="mb-3 text-xs text-amber-600">
                {t('maxReached', { max: maxItems })}
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
                      aria-label={t('removeAria', { name: item.productName })}
                    >
                      {tCommon('remove')}
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
          {t('destination')}
        </label>
        <select
          id="basket-destination"
          value={destination}
          onChange={(e) => onDestinationChange(e.target.value)}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {COUNTRY_CODES.map((code) => (
            <option key={code} value={code}>
              {tCommon(`countries.${code}`)}
            </option>
          ))}
        </select>
      </div>

      {/* ── Transport arrangement ── */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700">
            {t('transportTitle')}
          </legend>
          <div className="space-y-2">
            {TRANSPORT_VALUES.map((value) => (
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
                {t(`transport.${value}`)}
                {value === 'PERSONAL' && (
                  <span className="text-xs text-gray-400">
                    {t('personalNote')}
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
