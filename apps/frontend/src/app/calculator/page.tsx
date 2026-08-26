'use client';

import { useState, useCallback, useRef } from 'react';
import type { ProductSearchItem, CalculatorResult } from '@/lib/types';
import { searchProducts, calculateLandedCost, request } from '@/lib/api';
import ProductSearch from './components/ProductSearch';
import ProductSelector from './components/ProductSelector';
import QuantitySelector from './components/QuantitySelector';
import CalculatorResultView from './components/CalculatorResult';
import ProductHistoryPanel from './components/ProductHistoryPanel';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum query length before we fire a search. */
const MIN_QUERY_LENGTH = 2;

/** Default destination country (Finland). */
const DEFAULT_DESTINATION = 'FI';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Landed-cost calculator page.
 *
 * Orchestrates the search → select → quantity → calculate flow.
 * All data-fetching state is managed here; child components are purely
 * presentational.
 */
export default function CalculatorPage() {
  // ── Search state ──
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // ── Selection state ──
  const [selectedProduct, setSelectedProduct] =
    useState<ProductSearchItem | null>(null);
  const [quantity, setQuantity] = useState(1);

  // ── Calculation state ──
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<CalculatorResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  // Guard against duplicate submissions
  const searchInFlight = useRef(false);

  // ── Search handler ──
  const handleSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < MIN_QUERY_LENGTH || searchInFlight.current) return;

    searchInFlight.current = true;
    setSearchLoading(true);
    setSearchError(null);
    setHasSearched(true);
    setSelectedProduct(null);
    setResult(null);

    try {
      const res = await searchProducts(trimmed);
      setSearchResults(res.items);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Search failed. Please try again.';
      setSearchError(message);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
      searchInFlight.current = false;
    }
  }, []);

  // ── Select handler ──
  const handleSelect = useCallback((product: ProductSearchItem) => {
    setSelectedProduct(product);
    setResult(null);
    setCalcError(null);
  }, []);

  // ── Calculate handler ──
  const handleCalculate = useCallback(async () => {
    if (!selectedProduct) return;

    setCalculating(true);
    setCalcError(null);
    setResult(null);

    try {
      const res = await calculateLandedCost({
        productId: selectedProduct.id,
        quantity,
        destination: DEFAULT_DESTINATION,
      });
      setResult(res);

      // Fire-and-forget: record this calculation in the user's history.
      // The `request()` helper auto-injects `x-user-id` for account-scoped
      // paths.  History recording is non-critical — silently ignore failures.
      request<{ success: boolean }>('/api/v1/account/history', {
        method: 'POST',
        body: JSON.stringify({ recordId: res.calculationRecordId }),
      }).catch(() => { /* noop */ });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Calculation failed. Please try again.';
      setCalcError(message);
    } finally {
      setCalculating(false);
    }
  }, [selectedProduct, quantity]);

  // ── Reset handler ──
  const handleReset = useCallback(() => {
    setSelectedProduct(null);
    setResult(null);
    setCalcError(null);
  }, []);

  // ── Render ──
  const canCalculate = selectedProduct !== null && !calculating;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">
        Landed-cost calculator
      </h1>
      <p className="mb-8 text-sm text-gray-500">
        Search for a product, select a quantity, and get an itemized landed-cost
        estimate for Finland.
      </p>

      {/* ── Search section ── */}
      <section className="mb-6">
        <ProductSearch
          value={query}
          onChange={setQuery}
          onSubmit={handleSearch}
          loading={searchLoading}
          error={searchError}
        />
      </section>

      {/* ── Search results ── */}
      {hasSearched && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {selectedProduct ? 'Selected product' : 'Search results'}
          </h2>
          <ProductSelector
            items={searchResults}
            selectedId={selectedProduct?.id ?? null}
            onSelect={handleSelect}
            loading={searchLoading}
            query={query}
          />
        </section>
      )}

      {/* ── Selected product + quantity + calculate ── */}
      {selectedProduct && (
        <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">
                {selectedProduct.name}
              </h2>
              <p className="text-xs text-gray-500">
                {selectedProduct.brand}
                {selectedProduct.category
                  ? ` · ${selectedProduct.category}`
                  : ''}
                {selectedProduct.unitVolume
                  ? ` · ${selectedProduct.unitVolume}`
                  : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-primary-600 hover:text-primary-800"
            >
              Change
            </button>
          </div>

          <div className="mb-4">
            <QuantitySelector value={quantity} onChange={setQuantity} />
          </div>

          <button
            type="button"
            onClick={handleCalculate}
            disabled={!canCalculate}
            className="inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {calculating ? 'Calculating…' : 'Calculate landed cost'}
          </button>

          {calcError && (
            <p className="mt-2 text-sm text-red-600">{calcError}</p>
          )}
        </section>
      )}

      {/* ── Calculation result ── */}
      {result && (
        <section>
          <CalculatorResultView result={result} />
          {/* Historical charts — hidden and unfetched while the
              enable_historical_price_intelligence flag is off. */}
          <div className="mt-6">
            <ProductHistoryPanel
              productId={result.metadata.input.productId}
              showMerchantFilter
            />
          </div>
        </section>
      )}
    </main>
  );
}