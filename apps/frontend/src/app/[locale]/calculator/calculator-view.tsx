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
import ResultCard from './components/ResultCard';
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

/**
 * Quick-path destination options (task 4.2) — the same cross-border list
 * the basket builder offers. Names render through `Common.countries.*`.
 */
const DESTINATION_COUNTRIES: readonly string[] = [
  'FI',
  'EE',
  'LV',
  'LT',
  'SE',
  'DE',
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

/** Format cents to a euro string (shared frontend convention). */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

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
// View component
// ---------------------------------------------------------------------------

/**
 * Landed-cost calculator client view (price-intelligence-roadmap task
 * 2.1, design D2).
 *
 * The interactive body of the server shell in `page.tsx`: it
 * orchestrates the search → select → quantity → calculate flow. All
 * data-fetching state is managed here; child components are purely
 * presentational. The page title, intro copy, and the "how this
 * calculation works" summary stay in the server shell — this component
 * renders only the flow itself.
 */
export default function CalculatorView() {
  const t = useTranslations('Calculator');
  const tCommon = useTranslations('Common');
  const tAgeGate = useTranslations('AgeGate');

  // ── Search state ──
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  // Task 4.7: a search submitted with a too-short term is a specific,
  // inline validation case — named with its minimum length, not a
  // generic failure.
  const [shortQuery, setShortQuery] = useState(false);
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
  // Optional transport-side override (task 4.2, advanced path). Empty
  // means the published transport dataset — the request then omits the
  // field entirely, byte-identical to the pre-4.2 payload.
  const [transportMethod, setTransportMethod] = useState('');
  // Quick/advanced disclosure (task 4.2): the quick path is visible by
  // default; the advanced options exist behind an explicit control.
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
      // Further typing supersedes the too-short notice.
      setShortQuery(false);
      debouncedSearch.run(q);
    },
    [debouncedSearch],
  );

  // ── Immediate submit path (Enter / search button) ──
  const handleSearch = useCallback(
    (q: string) => {
      debouncedSearch.cancel();
      const trimmed = q.trim();
      if (trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH) {
        setShortQuery(true);
        return;
      }
      setShortQuery(false);
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
        // The carrier override rides along only when set — an untouched
        // advanced path keeps the payload identical to the quick path's
        // (task 4.2 parity).
        ...(transportMethod.trim() !== ''
          ? { transportMethod: transportMethod.trim() }
          : {}),
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
  }, [selectedProduct, quantity, destination, transportMethod, t]);

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
          ...(transportMethod.trim() !== ''
            ? { transportMethod: transportMethod.trim() }
            : {}),
        },
      });
    },
    [selectedProduct, quantity, destination, transportMethod, t],
  );

  // ── Load-scenario handler: repopulate inputs and re-run the calculation
  // against current data. A vanished product surfaces the normal not-found
  // error path — scenario data never serves as a cached result. ──
  const handleLoadScenario = useCallback((scenario: SavedScenario) => {
    const { inputs } = scenario;

    setQuantity(inputs.quantity);
    setDestination(inputs.destination);
    setTransportMethod(inputs.transportMethod ?? '');
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

  // ── Reset handler (the selected-product "change" affordance): keeps
  // the search list so another product can be picked directly. ──
  const handleReset = useCallback(() => {
    setSelectedProduct(null);
    setResult(null);
    setCalcError(null);
    setDestination(DEFAULT_DESTINATION);
    setTransportMethod('');
  }, []);

  // ── Clear-form affordance (task 4.7): every input back to its
  // default — search, selection, quantity, destination, carrier,
  // advanced disclosure, and all results/errors. ──
  const handleClearForm = useCallback(() => {
    setQuery('');
    setSearchResults([]);
    setSearchError(null);
    setHasSearched(false);
    setSearchWarnings([]);
    setShortQuery(false);
    setSelectedProduct(null);
    setQuantity(1);
    setDestination(DEFAULT_DESTINATION);
    setTransportMethod('');
    setAdvancedOpen(false);
    setResult(null);
    setCalcError(null);
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
    <>
      {/* ── Step progress indicator ── */}
      <StepIndicator steps={stepLabels} currentStep={activeStep} />

      {/* ── Two-column layout (task 4.5): on desktop (lg) the inputs form
          the left column and the summary card sticks in the right column;
          below lg everything stays the existing single column in the same
          order (steps → scenario → result → history). ── */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8">
        <div className="min-w-0">
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
            <button
              type="button"
              data-testid="calculator-reset"
              onClick={handleClearForm}
              className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              {t('resetForm')}
            </button>
          </div>
          <div className="px-5 py-4">
            <ProductSearch
              value={query}
              onChange={handleQueryChange}
              onSubmit={handleSearch}
              loading={searchLoading}
              error={searchError}
            />

            {/* ── Too-short search term: inline, specific (task 4.7) ── */}
            {shortQuery && (
              <p
                role="alert"
                data-testid="calc-query-error"
                className="mt-2 text-xs font-medium text-red-600"
              >
                {t('queryTooShort', { min: MIN_QUERY_LENGTH })}
              </p>
            )}

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
              {/* Selected product summary — product and its observed price
                  are quick-path elements (task 4.2): visible by default. */}
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
                  {selectedProduct.lowestPriceCents !== null && (
                    <p
                      className="mt-1 text-sm text-gray-700"
                      data-testid="observed-price"
                    >
                      {t('observedPrice', {
                        price: formatEur(selectedProduct.lowestPriceCents),
                      })}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="ml-4 shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50 hover:text-primary-800"
                >
                  {t('change')}
                </button>
              </div>

              {/* Quick path: destination country and quantity (task 4.2) */}
              <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="calc-destination"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    {t('countryLabel')}
                  </label>
                  <select
                    id="calc-destination"
                    data-testid="calc-destination"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    {DESTINATION_COUNTRIES.map((code) => (
                      <option key={code} value={code}>
                        {tCommon(`countries.${code}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  {/* Unit beside the numeric field (task 4.7). */}
                  <QuantitySelector
                    value={quantity}
                    onChange={setQuantity}
                    unit={t('quantityUnit')}
                  />
                </div>
              </div>

              {/* ── Advanced options (task 4.2): collapsed by default —
                  an explicit control discloses the transport-side inputs.
                  Toggling changes visibility only: the calculation always
                  runs from the same single input state, so identical
                  values produce identical results on both paths. ── */}
              <div className="mb-5">
                <button
                  type="button"
                  data-testid="advanced-toggle"
                  aria-expanded={advancedOpen}
                  aria-controls="calculator-advanced"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary-600 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                >
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-3.5 w-3.5 transition-transform ${
                      advancedOpen ? 'rotate-180' : ''
                    }`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                  {t('advancedToggle')}
                </button>
                {advancedOpen && (
                  <div
                    id="calculator-advanced"
                    data-testid="calculator-advanced"
                    className="mt-3 rounded-md border border-gray-200 p-3"
                  >
                    <label
                      htmlFor="calc-transport-method"
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      {t('transportMethodLabel')}
                    </label>
                    <input
                      id="calc-transport-method"
                      data-testid="calc-transport-method"
                      type="text"
                      value={transportMethod}
                      onChange={(e) => setTransportMethod(e.target.value)}
                      className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {t('transportMethodHint')}
                    </p>
                  </div>
                )}
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
        </div>        {/* ── Sticky summary column (task 4.5): the 4.1 answer-first card
            stays visible while the visitor scrolls or edits inputs on
            desktop; below lg it renders in the normal flow. ── */}
        <aside
          data-testid="calculator-summary"
          className="mt-5 lg:sticky lg:[inset-block-start:5rem] lg:mt-0 lg:self-start"
        >
          {result ? (
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
                {/* Answer-first result card (task 4.1): estimated landed
                    cost, Finland comparison with explicit cheaper/dearer
                    text, breakdown beneath, reliability + timestamp, and
                    the structural disclaimer from the result object. */}
                <ResultCard result={result} />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5">
              <p className="text-sm text-gray-500">
                {t('summaryPlaceholder')}
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* ── Historical charts — full width beneath both columns ── */}
      {result && (
        <div className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="p-5">
            <ProductHistoryPanel
              productId={result.metadata.input.productId}
              showMerchantFilter
            />
          </div>
        </div>
      )}
    </>
  );
}
