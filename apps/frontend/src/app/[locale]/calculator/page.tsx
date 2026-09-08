'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type {
  ProductSearchItem,
  CalculatorResult,
  MerchantWarning,
  SavedScenario,
} from '@/lib/types';
import {
  searchProducts,
  calculateLandedCost,
  getProductDetail,
  saveScenario,
  request,
  ApiFetchError,
} from '@/lib/api';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import { EmptyState, ErrorState } from '@/components/ui';
import ProductSearch from './components/ProductSearch';
import ProductSelector from './components/ProductSelector';
import MerchantWarningNotice from '../components/MerchantWarningNotice';
import QuantitySelector from './components/QuantitySelector';
import CalculatorResultView from './components/CalculatorResult';
import ProductHistoryPanel from './components/ProductHistoryPanel';
import ScenarioControls from './components/ScenarioControls';
import StepIndicator from './components/StepIndicator';

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
// Calculation error classification (task 5.3)
// ---------------------------------------------------------------------------

/**
 * A calculation failure surfaced through the designed ErrorState. The
 * rate-limit case carries the server's `Retry-After` (seconds) from the
 * 429 body so the state can say when a retry will succeed.
 */
interface CalculationError {
  /**
   * Server-provided or fallback message; unused for rate-limited and
   * age-gate renders.
   */
  readonly message: string;
  /** True when the calculation was rejected by the rate limiter (429). */
  readonly rateLimited: boolean;
  /** Seconds until a retry is allowed, when the 429 response carried it. */
  readonly retryAfterSeconds: number | null;
  /**
   * True when the API demanded age (re)confirmation (403
   * `AGE_GATE_REQUIRED`). The AgeGate modal re-opens on top via the
   * `age-gate:required` window event; the error state only carries the
   * localized in-context explanation — never the raw backend message.
   */
  readonly ageGateRequired: boolean;
}

/**
 * Classify a calculation failure for the error state. Rate-limited
 * rejections keep the structured `retryAfterSeconds`; age-gate
 * rejections (403 with body code `AGE_GATE_REQUIRED`) map to the
 * localized recovery copy; everything else keeps the server message
 * (or the localized fallback).
 */
function toCalculationError(
  err: unknown,
  fallbackMessage: string,
): CalculationError {
  if (
    err instanceof ApiFetchError &&
    err.status === 403 &&
    err.body?.code === 'AGE_GATE_REQUIRED'
  ) {
    return {
      message: fallbackMessage,
      rateLimited: false,
      retryAfterSeconds: null,
      ageGateRequired: true,
    };
  }
  if (err instanceof ApiFetchError && err.status === 429) {
    return {
      message: fallbackMessage,
      rateLimited: true,
      retryAfterSeconds:
        typeof err.body?.retryAfterSeconds === 'number'
          ? err.body.retryAfterSeconds
          : null,
      ageGateRequired: false,
    };
  }
  return {
    message: err instanceof Error ? err.message : fallbackMessage,
    rateLimited: false,
    retryAfterSeconds: null,
    ageGateRequired: false,
  };
}

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
  const tCommon = useTranslations('Common');
  const tAgeGate = useTranslations('AgeGate');

  // ── Search state ──
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  // Display-only merchant warnings joined into the search response
  // (task 2.4) — advisory for the results panel, never a filter.
  const [searchWarnings, setSearchWarnings] = useState<readonly MerchantWarning[]>([]);

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
  const [calcError, setCalcError] = useState<CalculationError | null>(null);

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
      setSearchWarnings([]);

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
        setSearchWarnings(res.merchantWarnings ?? []);
      } catch (err: unknown) {
        // Superseded searches leave the newer one's state untouched.
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : t('searchFailed');
        setSearchError(message);
        setSearchResults([]);
        setSearchWarnings([]);
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
      setCalcError(toCalculationError(err, t('calculationFailed')));
    } finally {
      setCalculating(false);
    }
  }, [selectedProduct, quantity, destination, t]);

  // ── Save-scenario handler (delegated to the scenario controls) ──
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
        setCalcError(toCalculationError(err, t('calculationFailed')));
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

  // A settled search that returned nothing renders the designed empty
  // state instead of the selector's inline note. A failed search
  // (searchError) keeps the existing inline error line, and a cleared
  // query keeps the selector's type-to-search guidance.
  const searchSettledEmpty =
    !searchLoading &&
    searchError === null &&
    searchResults.length === 0 &&
    query.trim().length >= MIN_QUERY_LENGTH;

  // Derive the active step for the progress indicator:
  //   Step 0 — search / product selection
  //   Step 1 — quantity & calculate
  //   Step 2 — result
  const activeStep = result ? 2 : selectedProduct ? 1 : 0;

  const stepLabels = [
    t('stepSearch'),
    t('stepConfigure'),
    t('stepResult'),
  ];

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      {/* ── Page header ── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
      </div>

      {/* ── Step progress indicator ── */}
      <StepIndicator steps={stepLabels} currentStep={activeStep} />

      <>
        {/* ── Step 1: Search ── */}
        <div className="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5">
            <span
              className={[
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                activeStep >= 1
                  ? 'bg-primary-600 text-white'
                  : 'border-2 border-primary-600 text-primary-600',
              ].join(' ')}
            >
              {activeStep >= 1 ? (
                <svg aria-hidden="true" focusable="false" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : '1'}
            </span>
            <h2 className="text-sm font-semibold text-gray-800">{t('stepSearch')}</h2>
          </div>
          <div className="px-5 py-4">
            <ProductSearch
              value={query}
              onChange={handleQueryChange}
              onSubmit={handleSearch}
              loading={searchLoading}
              error={searchError}
            />

            {/* ── Search results ── */}
            {hasSearched && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {selectedProduct ? t('selectedProduct') : t('searchResults')}
                </p>
                {searchSettledEmpty ? (
                  <EmptyState
                    title={t('searchNoResultsTitle')}
                    description={t('searchNoResultsDescription', {
                      query: query.trim(),
                    })}
                  />
                ) : (
                  <>
                    <ProductSelector
                      items={searchResults}
                      selectedId={selectedProduct?.id ?? null}
                      onSelect={handleSelect}
                      loading={searchLoading}
                      query={query}
                    />
                    {searchResults.length > 0 && (
                      <div className="mt-3">
                        <MerchantWarningNotice warnings={searchWarnings} compact />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Step 2: Configure + Calculate ── */}
        {selectedProduct && (
          <div className="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5">
              <span
                className={[
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                  activeStep >= 2
                    ? 'bg-primary-600 text-white'
                    : 'border-2 border-primary-600 text-primary-600',
                ].join(' ')}
              >
                {activeStep >= 2 ? (
                  <svg aria-hidden="true" focusable="false" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : '2'}
              </span>
              <h2 className="text-sm font-semibold text-gray-800">{t('stepConfigure')}</h2>
            </div>
            <div className="px-5 py-4">
              {/* Selected product summary */}
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">
                    {selectedProduct.name}
                  </p>
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
                  className="ml-4 shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50 hover:text-primary-800"
                >
                  {t('change')}
                </button>
              </div>

              <div className="mb-5">
                <QuantitySelector value={quantity} onChange={setQuantity} />
              </div>

              {/* Calculate button */}
              <button
                type="button"
                onClick={handleCalculate}
                disabled={!canCalculate}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {calculating ? (
                  <>
                    <svg
                      aria-hidden="true"
                      focusable="false"
                      className="h-4 w-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t('calculating')}
                  </>
                ) : (
                  t('calculate')
                )}
              </button>

              {calcError && (
                <div className="mt-3">
                  <ErrorState
                    title={
                      calcError.ageGateRequired
                        ? tAgeGate('recoveryTitle')
                        : t('calculationErrorTitle')
                    }
                    description={
                      calcError.ageGateRequired
                        ? tAgeGate('recoveryDescription')
                        : calcError.rateLimited
                          ? t('rateLimitedDescription')
                          : calcError.message
                    }
                    onRetry={handleCalculate}
                    retryLabel={tCommon('retry')}
                  >
                    {calcError.retryAfterSeconds !== null ? (
                      <p
                        data-testid="calc-retry-after"
                        className="text-sm text-gray-600"
                      >
                        {t('rateLimitRetryAfter', {
                          seconds: calcError.retryAfterSeconds,
                        })}
                      </p>
                    ) : null}
                  </ErrorState>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Scenario controls ── */}
        <div className="mb-5">
          <ScenarioControls
            canSave={selectedProduct !== null}
            onSaveScenario={handleSaveScenario}
            onLoadScenario={handleLoadScenario}
          />
        </div>

        {/* ── Step 3: Result ── */}
        {result && (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
                <svg aria-hidden="true" focusable="false" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </span>
              <h2 className="text-sm font-semibold text-gray-800">{t('stepResult')}</h2>
            </div>
            <div className="p-5">
              <CalculatorResultView result={result} />
              {/* Historical charts */}
              <div className="mt-6">
                <ProductHistoryPanel
                  productId={result.metadata.input.productId}
                  showMerchantFilter
                />
              </div>
            </div>
          </div>
        )}
      </>
    </main>
  );
}

