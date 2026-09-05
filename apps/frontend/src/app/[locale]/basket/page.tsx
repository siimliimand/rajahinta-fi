'use client';

/**
 * Basket optimization page.
 *
 * Orchestrates the product-search → builder → optimize → results flow for
 * multi-item cross-border beverage cost optimization. Gated behind the
 * `enable_basket_optimization` feature flag.
 *
 * All user-visible copy comes from the message catalogs; error messages
 * per classified {@link classifyBasketError} kind live under
 * `BasketPage.errors.*`.
 *
 * @module BasketPage
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { BasketOptimizationResult, BasketItemInput } from '@/lib/basket.types';
import { optimizeBasket, classifyBasketError } from '@/lib/basket.client';
import { useFeatureFlags } from '@/lib/feature-flags';
import type { TransportArrangement } from '@/lib/basket.types';
import BasketBuilder from './components/BasketBuilder';
import BasketResults from './components/BasketResults';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum items the builder allows (server-side cap is also 10). */
const MAX_ITEMS = 10;

/** Default destination country (Finland). */
const DEFAULT_DESTINATION = 'FI';

/** Minimum query length before firing a product search. */
const MIN_QUERY_LENGTH = 2;

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Basket optimization page — feature-flag-gated multi-item landed-cost
 * optimizer.
 *
 * Behaviour:
 *  - `enable_basket_optimization` off ⇒ renders nothing (same as
 *    ProductHistoryPanel's hidden treatment). The flag state is inlined
 *    with the initial HTML, so the page is hidden or visible from the
 *    first render — no late appearance.
 *  - Builder allows adding up to 10 products with quantities.
 *  - Submit calls {@link optimizeBasket} and renders the result with
 *    per-store breakdowns, confidence, disclaimer, and alternatives.
 */
export default function BasketPage() {
  const t = useTranslations('BasketPage');

  // ── Feature flag (inlined with the initial HTML payload) ──
  const flags = useFeatureFlags();
  const flagEnabled = flags.flags.BASKET_OPTIMIZATION;

  // ── Basket builder state ──
  const [items, setItems] = useState<
    { productId: number; productName: string; quantity: number }[]
  >([]);
  const [destination, setDestination] = useState(DEFAULT_DESTINATION);
  const [transportArrangement, setTransportArrangement] =
    useState<TransportArrangement>('SELLER_ARRANGED');

  // ── Optimization state ──
  const [optimizing, setOptimizing] = useState(false);
  const [result, setResult] = useState<BasketOptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Guard against duplicate submits
  const optimizeInFlight = useRef(false);

  /**
   * Product names by ID for the packing section — it names excluded
   * products and box contents instead of bare product IDs.
   */
  const productNames = useMemo(
    () => new Map(items.map((i) => [i.productId, i.productName])),
    [items],
  );

  // ── Handlers ──

  /** Add a product to the basket (from search selection). */
  const handleAddItem = useCallback(
    (productId: number, productName: string) => {
      setItems((prev) => {
        if (prev.length >= MAX_ITEMS) return prev;
        // If already in the basket, increment quantity instead of duplicating.
        const existing = prev.find((i) => i.productId === productId);
        if (existing) {
          return prev.map((i) =>
            i.productId === productId
              ? { ...i, quantity: Math.min(i.quantity + 1, 99) }
              : i,
          );
        }
        return [...prev, { productId, productName, quantity: 1 }];
      });
      setResult(null);
      setError(null);
    },
    [],
  );

  /** Update quantity for an existing item. */
  const handleUpdateQuantity = useCallback(
    (productId: number, quantity: number) => {
      setItems((prev) =>
        prev.map((i) =>
          i.productId === productId
            ? { ...i, quantity: Math.max(1, Math.min(99, quantity)) }
            : i,
        ),
      );
    },
    [],
  );

  /** Remove an item from the basket. */
  const handleRemoveItem = useCallback((productId: number) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
    setResult(null);
    setError(null);
  }, []);

  /** Submit the basket for optimization. */
  const handleOptimize = useCallback(async () => {
    if (items.length === 0 || optimizeInFlight.current) return;

    optimizeInFlight.current = true;
    setOptimizing(true);
    setError(null);
    setResult(null);

    try {
      const input: BasketItemInput[] = items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      }));
      const res = await optimizeBasket({
        items: input,
        destination,
        transportArrangement,
      });
      setResult(res);
    } catch (err: unknown) {
      const { kind } = classifyBasketError(err);
      setError(t(`errors.${kind}`));
    } finally {
      setOptimizing(false);
      optimizeInFlight.current = false;
    }
  }, [items, destination, transportArrangement, t]);

  // ── Hidden state: flag off in the inlined payload ──
  if (!flagEnabled) {
    return null;
  }

  const canOptimize = items.length > 0 && !optimizing;

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── Builder section ── */}
      <section className="mb-8">
        <BasketBuilder
          items={items}
          maxItems={MAX_ITEMS}
          minQueryLength={MIN_QUERY_LENGTH}
          destination={destination}
          transportArrangement={transportArrangement}
          onAddItem={handleAddItem}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveItem}
          onDestinationChange={setDestination}
          onTransportArrangementChange={setTransportArrangement}
        />
      </section>

      {/* ── Submit ── */}
      <section className="mb-8">
        <button
          type="button"
          onClick={handleOptimize}
          disabled={!canOptimize}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {optimizing ? t('optimizing') : t('optimize')}
        </button>

        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
      </section>

      {/* ── Results ── */}
      {result && (
        <section>
          <BasketResults result={result} productNames={productNames} />
        </section>
      )}
    </main>
  );
}
