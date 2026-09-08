'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { searchProducts } from '@/lib/api';
import type { ProductSearchItem } from '@/lib/types';

// ---------------------------------------------------------------------------
// Caps — mirror the server-side zod caps (trip.routes.ts, task 8.2)
// ---------------------------------------------------------------------------

/** Maximum candidate lines in one fill request (the basket input cap). */
export const MAX_FILL_ITEMS = 10;
/** Per-line quantity window — the fill search's branching factor bound. */
export const MIN_FILL_QUANTITY = 1;
export const MAX_FILL_QUANTITY = 99;
/** Minimum query length before the search fires (BasketBuilder parity). */
const MIN_QUERY_LENGTH = 2;

/** Per-candidate draft state — the quantity bound, parsed at submit. */
export interface FillCandidateDraft {
  readonly productId: number;
  readonly productName: string;
  readonly maxQuantity: number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TripFillFormProps {
  /**
   * Raised with parsed, in-cap candidate bounds once at least one
   * exists. Product names travel along for display; the caller strips
   * them before the API request.
   */
  readonly onSubmit: (
    items: { productId: number; maxQuantity: number; productName: string }[],
  ) => void;
  /** Disables the submit control while the fill request is in flight. */
  readonly submitting: boolean;
}

/**
 * Candidate quantity bound — parse a whole number within the server's
 * window; anything else (empty, malformed, out of cap) is NaN so the
 * submit stays blocked instead of silently clamping the user's figure.
 */
function parseQuantity(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < MIN_FILL_QUANTITY || parsed > MAX_FILL_QUANTITY) return Number.NaN;
  return parsed;
}

/**
 * Fill-mode form (task 8.3): product search, candidate selection, and a
 * per-candidate maximum-quantity bound. The travel date is intentionally
 * absent (TripForm parity) — the page supplies today because the server
 * resolves the allowance dataset by effective date.
 *
 * The candidates ARE the allowance input: the fill maximizes value under
 * the resolved allowance, drawing at most `maxQuantity` units per line.
 *
 * All fill-specific copy comes from the `TripPage` message namespace;
 * the search chrome reuses `ProductSearch`/`ProductSelector`
 * (BasketBuilder precedent).
 *
 * @module TripFillForm
 */
export default function TripFillForm({ onSubmit, submitting }: TripFillFormProps) {
  const t = useTranslations('TripPage');
  const tCommon = useTranslations('Common');
  const tSearch = useTranslations('ProductSearch');
  const tSelector = useTranslations('ProductSelector');

  // ── Search state ──
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const searchInFlight = useRef(false);

  // ── Candidate state ──
  const [candidates, setCandidates] = useState<FillCandidateDraft[]>([]);
  const [quantities, setQuantities] = useState<ReadonlyMap<number, string>>(
    new Map(),
  );

  const handleSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < MIN_QUERY_LENGTH || searchInFlight.current) return;

    searchInFlight.current = true;
    setSearchLoading(true);
    setSearchError(false);
    setHasSearched(true);

    try {
      const res = await searchProducts(trimmed);
      setSearchResults(res.items);
    } catch {
      setSearchError(true);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
      searchInFlight.current = false;
    }
  }, []);

  const handleSelect = useCallback((product: ProductSearchItem) => {
    setCandidates((current) => {
      if (current.length >= MAX_FILL_ITEMS) return current;
      if (current.some((candidate) => candidate.productId === product.id)) {
        return current;
      }
      return [
        ...current,
        { productId: product.id, productName: product.name, maxQuantity: 1 },
      ];
    });
    setQuantities((current) => {
      if (current.has(product.id)) return current;
      const next = new Map(current);
      next.set(product.id, '1');
      return next;
    });
  }, []);

  const handleRemove = useCallback((productId: number) => {
    setCandidates((current) => current.filter((c) => c.productId !== productId));
    setQuantities((current) => {
      const next = new Map(current);
      next.delete(productId);
      return next;
    });
  }, []);

  const handleQuantityChange = useCallback((productId: number, value: string) => {
    setQuantities((current) => {
      const next = new Map(current);
      next.set(productId, value);
      return next;
    });
  }, []);

  // Every candidate must carry a parsed, in-cap bound — a started but
  // malformed field blocks the submit instead of being silently dropped.
  const quantityBounds: {
    productId: number;
    maxQuantity: number;
    productName: string;
  }[] = [];
  let quantitiesMalformed = false;
  for (const candidate of candidates) {
    const parsed = parseQuantity(quantities.get(candidate.productId) ?? '');
    if (Number.isNaN(parsed)) {
      quantitiesMalformed = true;
      continue;
    }
    quantityBounds.push({
      productId: candidate.productId,
      maxQuantity: parsed,
      productName: candidate.productName,
    });
  }
  const valid = candidates.length > 0 && !quantitiesMalformed;
  const atCapacity = candidates.length >= MAX_FILL_ITEMS;

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!valid || submitting) return;
      onSubmit(quantityBounds);
    },
    [valid, submitting, quantityBounds, onSubmit],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="trip-fill-form">
      {/* ── Product search ── */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">{t('fill.searchHeading')}</p>
        <div className="flex gap-2">
          <input
            type="text"
            id="trip-fill-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSearch(query);
              }
            }}
            placeholder={tSearch('placeholder')}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <Button
            type="button"
            onClick={() => void handleSearch(query)}
            disabled={searchLoading}
          >
            {searchLoading ? tSearch('searching') : tSearch('search')}
          </Button>
        </div>

        {searchError && (
          <p role="alert" className="text-xs text-red-600">
            {t('fill.searchError')}
          </p>
        )}

        {hasSearched && (
          <div className="max-h-56 overflow-y-auto">
            {searchLoading ? null : searchResults.length === 0 ? (
              <p className="text-sm text-gray-500">
                {query.trim().length === 0
                  ? tSelector('typeToSearch')
                  : tSelector('noResults', { query })}
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
                {searchResults.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      data-testid={`trip-fill-candidate-${product.id}`}
                      onClick={() => handleSelect(product)}
                      className="w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
                    >
                      <span className="block font-medium text-gray-900">
                        {product.name}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {product.brand}
                        {product.unitVolume ? ` · ${product.unitVolume}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Selected candidates with their quantity bounds ── */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">{t('fill.candidatesHeading')}</p>
        {atCapacity && (
          <p className="text-xs text-amber-600">
            {t('fill.maxCandidates', { max: MAX_FILL_ITEMS })}
          </p>
        )}
        {candidates.length === 0 ? (
          <p className="text-sm text-gray-400">{t('fill.emptyCandidates')}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {candidates.map((candidate) => (
              <li
                key={candidate.productId}
                data-testid={`trip-fill-selected-${candidate.productId}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                  {candidate.productName}
                </p>
                <div className="flex items-center gap-3">
                  <div>
                    <label
                      htmlFor={`trip-fill-qty-${candidate.productId}`}
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      {t('fill.maxQuantity')}
                    </label>
                    <input
                      id={`trip-fill-qty-${candidate.productId}`}
                      type="number"
                      inputMode="numeric"
                      min={MIN_FILL_QUANTITY}
                      max={MAX_FILL_QUANTITY}
                      step={1}
                      value={quantities.get(candidate.productId) ?? ''}
                      onChange={(e) =>
                        handleQuantityChange(candidate.productId, e.target.value)
                      }
                      className="block w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(candidate.productId)}
                    aria-label={t('fill.removeAria', { name: candidate.productName })}
                    className="text-xs font-medium text-red-600 hover:text-red-800"
                  >
                    {tCommon('remove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {quantitiesMalformed && (
          <p role="alert" className="text-xs text-red-600">
            {t('fill.quantityError', { min: MIN_FILL_QUANTITY, max: MAX_FILL_QUANTITY })}
          </p>
        )}
      </div>

      <Button type="submit" disabled={!valid || submitting} className="w-full">
        {submitting ? t('fill.submitting') : t('fill.submit')}
      </Button>
    </form>
  );
}
