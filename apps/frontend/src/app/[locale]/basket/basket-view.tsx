'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { BasketOptimizationResult, BasketItemInput } from '@/lib/basket.types';
import { optimizeBasket, classifyBasketError } from '@/lib/basket.client';
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

/** Format cents to a euro string (shared frontend convention). */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// View component
// ---------------------------------------------------------------------------

/**
 * Basket optimization view (price-intelligence-roadmap task 2.2, the D2
 * server-shell conversion): the builder → optimize → results flow moved
 * intact from the former single-file page. The server shell in `page.tsx`
 * owns the metadata, intro copy, and the method summary; this view
 * renders everything that needs the visitor's interaction state.
 *
 * All user-visible copy comes from the message catalogs; error messages
 * per classified {@link classifyBasketError} kind live under
 * `BasketPage.errors.*`.
 */
export default function BasketView() {
  const t = useTranslations('BasketPage');

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

  const canOptimize = items.length > 0 && !optimizing;

  // ── Summary figures (task 4.5) — presentation over the result object:
  // the grand total includes the consolidated transport, so the transport
  // total and the net (goods + taxes) figure derive exactly from the two
  // totals the API returns. The transport lines render only when trip
  // costs are present (transport > 0).
  const transportTotalCents = result ? result.totalCents - result.itemizedTotals : 0;

  return (
    // ── Two-column layout (task 4.5): on desktop (lg) the sticky summary
    // card sits beside the builder and results; below lg everything stays
    // the existing single column (builder → optimize → results), with the
    // summary flowing between the submit and the detailed results once a
    // result exists. Before the first optimization the layout is
    // unchanged on every viewport.
    <div
      className={
        result
          ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8'
          : 'block'
      }
    >
      <div className="min-w-0">
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
      </div>

      {/* ── Sticky summary column (task 4.5): Finland-context totals from
          the result object — the cross-border grand total, the transport
          estimate total, and, when trip costs are present, the net after
          transport. Desktop pins it beside the flow. ── */}
      {result && (
        <aside
          data-testid="basket-summary"
          className="mt-8 lg:sticky lg:[inset-block-start:5rem] lg:mt-0 lg:self-start"
        >
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('summary.heading')}
            </h2>
            <p
              data-testid="basket-summary-cross-border-total"
              className="tabular-money mt-2 text-3xl font-extrabold text-gray-900"
            >
              {formatEur(result.totalCents)}
            </p>
            <p className="mt-0.5 text-sm font-medium text-gray-600">
              {t('summary.crossBorderTotal')}
            </p>

            {transportTotalCents > 0 && (
              <dl className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-sm text-gray-600">
                    {t('summary.transportTotal')}
                  </dt>
                  <dd
                    data-testid="basket-summary-transport-total"
                    className="text-sm tabular-nums text-gray-700"
                  >
                    {formatEur(transportTotalCents)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-sm text-gray-600">
                    {t('summary.netAfterTripCosts')}
                  </dt>
                  <dd
                    data-testid="basket-summary-net-after-trip-costs"
                    className="text-sm font-semibold tabular-nums text-gray-900"
                  >
                    {formatEur(result.itemizedTotals)}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
