'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import type { SortOrder, ComparisonProduct, ProductSearchItem } from '@/lib/types';
import { searchProducts, calculateLandedCost } from '@/lib/api';
import SortSelector from './components/SortSelector';
import ComparisonView from './components/ComparisonView';
import BasketComparisonSection from './components/BasketComparisonSection';
import ProductSearch from '../calculator/components/ProductSearch';
import ProductSelector from '../calculator/components/ProductSelector';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_QUERY_LENGTH = 2;
const DEFAULT_SORT: SortOrder = 'LOWEST_LANDED_COST';
const DEFAULT_DESTINATION = 'FI';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Product comparison page.
 *
 * Lets users add products from search results, then displays them side by
 * side with their landed-cost breakdowns. All sort orders are objective
 * and neutral — no paid placement or promoted positions exist in the UI.
 */
export default function ComparePage() {
  // ── Search state ──
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  // ── Comparison state ──
  const [sortBy, setSortBy] = useState<SortOrder>(DEFAULT_SORT);
  const [products, setProducts] = useState<ComparisonProduct[]>([]);
  const [calcLoading, setCalcLoading] = useState(false);
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

  // ── Open search panel ──
  const handleAddProduct = useCallback(() => {
    setShowSearch(true);
    setQuery('');
    setSearchResults([]);
    setSearchError(null);
  }, []);

  // ── Select product and calculate ──
  const handleSelectProduct = useCallback(
    async (item: ProductSearchItem) => {
      setShowSearch(false);
      setCalcLoading(true);
      setCalcError(null);

      try {
        const result = await calculateLandedCost({
          productId: item.id,
          quantity: 1,
          destination: DEFAULT_DESTINATION,
        });

        const comparisonProduct: ComparisonProduct = {
          id: item.id,
          name: item.name,
          brand: item.brand,
          category: item.category,
          unitVolume: item.unitVolume,
          alcoholByVolume: item.alcoholByVolume,
          totalCents: result.totalCents,
          itemizedCosts: result.itemizedCosts,
          confidence: result.confidence,
          reliability: result.itemizedCosts.length > 0
            ? result.itemizedCosts[0].reliability
            : 'UNAVAILABLE',
        };

        setProducts((prev) => [...prev, comparisonProduct]);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'Calculation failed. Please try again.';
        setCalcError(message);
      } finally {
        setCalcLoading(false);
      }
    },
    [],
  );

  // ── Sort change handler ──
  const handleSortChange = useCallback(async (sort: SortOrder) => {
    setSortBy(sort);
  }, []);

  // ── Render ──
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <nav className="mb-6">
        <Link
          href="/"
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          &larr; Home
        </Link>
      </nav>

      <h1 className="mb-1 text-2xl font-bold text-primary-700">
        Product comparison
      </h1>
      <p className="mb-8 text-sm text-gray-500">
        Compare landed costs of beverage products side by side. All rankings
        are objective and neutral.
      </p>

      {/* ── Toolbar ── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <SortSelector
          value={sortBy}
          onChange={handleSortChange}
          disabled={calcLoading}
        />
        <button
          type="button"
          onClick={handleAddProduct}
          disabled={calcLoading || showSearch}
          className="inline-flex items-center rounded-md bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Add product
        </button>
      </div>

      {/* ── Search panel (shown when adding) ── */}
      {showSearch && (
        <section className="mb-8 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Add a product
            </h2>
            <button
              type="button"
              onClick={() => setShowSearch(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>

          <div className="mb-4">
            <ProductSearch
              value={query}
              onChange={setQuery}
              onSubmit={handleSearch}
              loading={searchLoading}
              error={searchError}
            />
          </div>

          <ProductSelector
            items={searchResults}
            selectedId={null}
            onSelect={handleSelectProduct}
            loading={searchLoading}
            query={query}
          />

          {calcError && (
            <p className="mt-3 text-sm text-red-600">{calcError}</p>
          )}
        </section>
      )}

      {/* ── Comparison view ── */}
      <ComparisonView
        products={products}
        sortBy={sortBy}
        loading={calcLoading}
        onAddProduct={handleAddProduct}
      />

      {/* ── Empty / minimal state guidance ── */}
      {products.length > 0 && (
        <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            About this comparison
          </h2>
          <p className="text-xs leading-relaxed text-gray-500">
            All landed-cost estimates are calculated for Finland (FI) with
            default transport. Products are sorted by{' '}
            {sortBy.replace(/_/g, ' ').toLowerCase()}. No product position
            is influenced by commercial factors — every product has equal
            visual weight. See{' '}
            <Link
              href="/ranking"
              className="text-primary-600 underline hover:text-primary-800"
            >
              how ranking works
            </Link>
            .
          </p>
        </section>
      )}

      {/* ── Multi-store basket comparison — gated behind BASKET_OPTIMIZATION flag ── */}
      <BasketComparisonSection />
    </main>
  );
}