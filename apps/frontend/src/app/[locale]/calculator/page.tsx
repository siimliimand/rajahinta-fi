'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type {
  ProductSearchItem,
  CalculatorResult,
  SavedScenario,
} from '@/lib/types';
import {
  searchProducts,
  calculateLandedCost,
  getProductDetail,
  saveScenario,
  request,
} from '@/lib/api';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import ProductSearch from './components/ProductSearch';
import ProductSelector from './components/ProductSelector';
import QuantitySelector from './components/QuantitySelector';
import CalculatorResultView from './components/CalculatorResult';
import ProductHistoryPanel from './components/ProductHistoryPanel';
import ScenarioControls from './components/ScenarioControls';
import GateClosedNotice, {
  isLaunchGateClosedError,
} from './components/GateClosedNotice';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum query length before we fire a search. */
const MIN_QUERY_LENGTH = 2;

/**
 * Keystroke-to-search debounce: rapid typing reschedules one shared
 * timer, so one request fires per settled query (task 5.2).
 */
const SEARCH_DEBOUNCE_MS = 300;

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
  const t = useTranslations('Calculator');

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
  // Destination is Finland-scoped by default; a loaded scenario can
  // repopulate it from its stored inputs.
  const [destination, setDestination] = useState(DEFAULT_DESTINATION);

  // ── Calculation state ──
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<CalculatorResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  // ── Launch-gate state (read from the guarded endpoints' own 403s) ──
  // True once a search or calculation is rejected because the production
  // launch gates are closed; the explanatory notice replaces the flow.
  const [gateClosed, setGateClosed] = useState(false);

  // Cancels the in-flight search when a newer one supersedes it, so a
  // slow stale response can never overwrite a newer one's results.
  const searchAbortRef = useRef<AbortController | null>(null);

  // Abort an in-flight search on unmount — a late response has no page
  // to update.
  useEffect(
    () => () => {
      searchAbortRef.current?.abort();
    },
    [],
  );

  // ── Search execution (shared by the debounced keystroke path and the
  //     immediate submit path) ──
  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < MIN_QUERY_LENGTH) return;

      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setSearchLoading(true);
      setSearchError(null);
      setHasSearched(true);
      setSelectedProduct(null);
      setResult(null);

      try {
        const res = await searchProducts(
          trimmed,
          'ALPHABETICAL',
          1,
          20,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setSearchResults(res.items);
      } catch (err: unknown) {
        // Superseded searches leave the newer one's state untouched.
        if (controller.signal.aborted) return;
        // Launch gates closed: switch the page to the explanatory notice
        // instead of surfacing the guard's rejection as a search error.
        if (isLaunchGateClosedError(err)) {
          setGateClosed(true);
          setSearchResults([]);
          return;
        }
        const message =
          err instanceof Error ? err.message : t('searchFailed');
        setSearchError(message);
        setSearchResults([]);
      } finally {
        if (searchAbortRef.current === controller) {
          setSearchLoading(false);
        }
      }
    },
    [t],
  );

  // ── Debounced keystroke path (task 5.2) ──
  const debouncedSearch = useDebouncedCallback(runSearch, SEARCH_DEBOUNCE_MS);

  const handleQueryChange = useCallback(
    (q: string) => {
      setQuery(q);
      debouncedSearch.run(q);
    },
    [debouncedSearch],
  );

  // ── Immediate submit path (Enter / search button) ──
  const handleSearch = useCallback(
    (q: string) => {
      debouncedSearch.cancel();
      runSearch(q);
    },
    [debouncedSearch, runSearch],
  );

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
        destination,
      });
      setResult(res);

      // Fire-and-forget: record this calculation in the user's history.
      // Authentication rides the httpOnly session cookie; request() mints
      // one on the first account-touch when none exists yet.  History
      // recording is non-critical — silently ignore failures.
      request<{ success: boolean }>('/api/v1/account/history', {
        method: 'POST',
        body: JSON.stringify({ recordId: res.calculationRecordId }),
      }).catch(() => { /* noop */ });
    } catch (err: unknown) {
      // Launch gates closed mid-session: same explanatory notice as search.
      if (isLaunchGateClosedError(err)) {
        setGateClosed(true);
        return;
      }
      const message =
        err instanceof Error ? err.message : t('calculationFailed');
      setCalcError(message);
    } finally {
      setCalculating(false);
    }
  }, [selectedProduct, quantity, destination, t]);

  // ── Save-scenario handler (scenario controls, flag-gated by the child) ──
  const handleSaveScenario = useCallback(
    async (name: string) => {
      if (!selectedProduct) {
        throw new Error(t('selectProductFirst'));
      }
      await saveScenario({
        name,
        inputs: {
          productId: selectedProduct.id,
          quantity,
          destination,
        },
      });
    },
    [selectedProduct, quantity, destination, t],
  );

  // ── Load-scenario handler: repopulate inputs and re-run the calculation
  // against current data. A vanished product surfaces the normal not-found
  // error path — scenario data never serves as a cached result. ──
  const handleLoadScenario = useCallback((scenario: SavedScenario) => {
    const { inputs } = scenario;

    setQuantity(inputs.quantity);
    setDestination(inputs.destination);
    setResult(null);
    setCalcError(null);
    setCalculating(true);

    (async () => {
      try {
        // Re-resolve the product so the UI shows current master data; a
        // 404 here (product removed) lands in the shared error path below.
        const detail = await getProductDetail(inputs.productId);
        setSelectedProduct({
          id: detail.product.id,
          name: detail.product.name,
          brand: detail.product.brand,
          category: detail.product.category,
          alcoholByVolume: detail.product.alcoholByVolume,
          unitVolume: detail.product.unitVolume,
          containerType: detail.product.containerType,
          lowestPriceCents: null,
          merchantCount: detail.offers.length,
        });

        const res = await calculateLandedCost({
          productId: inputs.productId,
          quantity: inputs.quantity,
          destination: inputs.destination,
          ...(inputs.transportMethod !== undefined
            ? { transportMethod: inputs.transportMethod }
            : {}),
        });
        setResult(res);

        request<{ success: boolean }>('/api/v1/account/history', {
          method: 'POST',
          body: JSON.stringify({ recordId: res.calculationRecordId }),
        }).catch(() => { /* noop */ });
      } catch (err: unknown) {
        setSelectedProduct(null);
        const message =
          err instanceof Error ? err.message : t('calculationFailed');
        setCalcError(message);
      } finally {
        setCalculating(false);
      }
    })();
  }, [t]);

  // ── Reset handler ──
  const handleReset = useCallback(() => {
    setSelectedProduct(null);
    setResult(null);
    setCalcError(null);
    setDestination(DEFAULT_DESTINATION);
  }, []);

  // ── Render ──
  const canCalculate = selectedProduct !== null && !calculating;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Launch-gate-closed notice — replaces the calculator flow while
          the production launch gates are closed (task 5.2). With the gates
          open (dev/staging) this branch never renders. ── */}
      {gateClosed ? (
        <GateClosedNotice />
      ) : (
        <>
          {/* ── Search section ── */}
          <section className="mb-6">
            <ProductSearch
              value={query}
              onChange={handleQueryChange}
              onSubmit={handleSearch}
              loading={searchLoading}
              error={searchError}
            />
          </section>

          {/* ── Search results ── */}
          {hasSearched && (
            <section className="mb-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {selectedProduct ? t('selectedProduct') : t('searchResults')}
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
                  {t('change')}
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
                {calculating ? t('calculating') : t('calculate')}
              </button>

              {calcError && (
                <p className="mt-2 text-sm text-red-600">{calcError}</p>
              )}
            </section>
          )}

          {/* ── Scenario controls — hidden and unfetched while the
              enable_advanced_features flag is off ── */}
          <div className="mb-6">
            <ScenarioControls
              canSave={selectedProduct !== null}
              onSaveScenario={handleSaveScenario}
              onLoadScenario={handleLoadScenario}
            />
          </div>

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
        </>
      )}
    </main>
  );
}
