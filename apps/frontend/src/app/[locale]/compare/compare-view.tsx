'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type {
  CompareSortOrder,
  ComparisonProduct,
  ConfidenceLevel,
  MerchantWarning,
  ProductDetailResponse,
  ProductSearchItem,
  ReliabilityStatus,
} from '@/lib/types';
import {
  searchProducts,
  calculateLandedCost,
  getProductDetail,
  getSavingsBestPerMerchant,
} from '@/lib/api';
import type { SavingsBestPerMerchantRow } from '@/lib/api';
import {
  CONFIDENCE_LEVEL_META,
  RELIABILITY_STATUS_META,
} from '@/lib/design/status';
import SortSelector from './components/SortSelector';
import ComparisonView from './components/ComparisonView';
import BasketComparisonSection from './components/BasketComparisonSection';
import MerchantWarningNotice from '../components/MerchantWarningNotice';
import ProductSearch from '../calculator/components/ProductSearch';
import ProductSelector from '../calculator/components/ProductSelector';
import { sortComparisonProducts } from './sort-products';
import { bestOfferUnitPrice } from './unit-price';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_QUERY_LENGTH = 2;
const DEFAULT_SORT: CompareSortOrder = 'LOWEST_LANDED_COST';
const DEFAULT_DESTINATION = 'FI';

/**
 * Map a snapshot status string onto the display ladder, degrading an
 * unknown value to the lowest rung — the same defensive resolution the
 * /savings rows use, since the snapshot ships provenance as plain
 * strings. A wrong value renders the least-trustworthy shape, never a
 * crash.
 */
function toReliabilityStatus(value: string): ReliabilityStatus {
  return (value in RELIABILITY_STATUS_META
    ? value
    : 'UNAVAILABLE') as ReliabilityStatus;
}

/** Confidence counterpart of {@link toReliabilityStatus}. */
function toConfidenceLevel(value: string): ConfidenceLevel {
  return (value in CONFIDENCE_LEVEL_META ? value : 'LOW') as ConfidenceLevel;
}

/**
 * Build one prefilled example column from a per-merchant snapshot row
 * (task 3.2, change savings-first-catalog-and-prefill). The column
 * carries the snapshot's own figures — `landedTotalCents` as the total,
 * the row's observed retail price as its one itemized component — plus
 * whatever the read-only product detail resolves for the display fields
 * (master data, offering merchants, €/g, warnings). A failed detail read
 * degrades that column to the row alone. No calculation runs: the total
 * is the snapshot's, not a fresh one.
 */
function comparisonProductFromDeal(
  row: SavingsBestPerMerchantRow,
  detail: ProductDetailResponse | null,
): ComparisonProduct & { example: true; offerCountries?: readonly string[] } {
  const merchants =
    detail !== null
      ? [...new Set(detail.offers.map((o) => o.merchant))].sort()
      : [];
  // Distinct seller countries of the current offers — display input for
  // the distance-selling badges only.
  const offerCountries =
    detail !== null
      ? [...new Set(detail.offers.map((o) => o.country))].sort()
      : [];
  const unitPrice =
    detail !== null ? bestOfferUnitPrice(detail.offers) : undefined;

  return {
    id: row.productId,
    name: row.productName,
    brand: detail?.product.brand ?? '',
    category: row.category,
    unitVolume: detail?.product.unitVolume ?? '',
    alcoholByVolume: detail?.product.alcoholByVolume ?? null,
    totalCents: row.landedTotalCents,
    itemizedCosts: [
      {
        label: row.productName,
        category: 'foreignRetailPrice',
        cents: row.priceCents,
        reliability: toReliabilityStatus(row.reliability),
      },
    ],
    confidence: toConfidenceLevel(row.confidence),
    reliability: toReliabilityStatus(row.reliability),
    merchants,
    offerCountries,
    merchantWarnings: detail?.merchantWarnings ?? [],
    example: true,
    // Present only when the detail payload resolved — mirrors the API's
    // key-absent-when-unresolved contract; undefined renders as no value.
    ...(unitPrice !== undefined ? { eurPerGram: unitPrice } : {}),
  };
}

// ---------------------------------------------------------------------------
// View component
// ---------------------------------------------------------------------------

/**
 * Product comparison view (price-intelligence-roadmap task 2.2, the D2
 * server-shell conversion): the interactive comparison flow moved intact
 * from the former single-file page. The server shell in `page.tsx` owns
 * the metadata, intro copy, and the method summary; this view renders
 * everything that needs the visitor's interaction state.
 */
export default function CompareView() {
  const t = useTranslations('Compare');
  const tCalc = useTranslations('Calculator');
  const tCommon = useTranslations('Common');
  const tSorts = useTranslations('SortOrders');

  // ── Search state ──
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  // Merchant warnings joined additively into the search response
  // (task 2.4) — display-only advisory for the results panel.
  const [searchWarnings, setSearchWarnings] = useState<readonly MerchantWarning[]>([]);

  // ── Comparison state ──
  const [sortBy, setSortBy] = useState<CompareSortOrder>(DEFAULT_SORT);
  const [products, setProducts] = useState<ComparisonProduct[]>([]);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  // ── Example prefill (task 3.2, change savings-first-catalog-and-prefill):
  // while the columns load, the grid shows its loading shape — never a
  // finished-looking empty state.
  const [prefilling, setPrefilling] = useState(true);
  const prefillStartedRef = useRef(false);

  useEffect(() => {
    if (prefillStartedRef.current) return;
    prefillStartedRef.current = true;
    let cancelled = false;
    getSavingsBestPerMerchant()
      .then(async (res) => {
        // One example column per cross-border merchant. The read-only
        // product detail feeds the display fields; a failed read degrades
        // that column to the row alone. Read-only end to end: no
        // calculation, no ranking write, no persistence — the totals are
        // the snapshot's own.
        const columns = await Promise.all(
          res.merchants.map((row) =>
            getProductDetail(row.productId)
              .catch(() => null)
              .then((detail) => comparisonProductFromDeal(row, detail)),
          ),
        );
        if (!cancelled) setProducts(columns);
      })
      .catch(() => {
        // Honest degrade: an empty listing (no materialized day) or a
        // failed read leaves the existing empty state standing.
      })
      .finally(() => {
        if (!cancelled) setPrefilling(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setSearchWarnings(res.merchantWarnings ?? []);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : tCalc('searchFailed');
      setSearchError(message);
      setSearchResults([]);
      setSearchWarnings([]);
    } finally {
      setSearchLoading(false);
      searchInFlight.current = false;
    }
  }, [tCalc]);

  // ── Open search panel ──
  const handleAddProduct = useCallback(() => {
    setShowSearch(true);
    setQuery('');
    setSearchResults([]);
    setSearchWarnings([]);
    setSearchError(null);
  }, []);

  // ── Select product and calculate ──
  const handleSelectProduct = useCallback(
    async (item: ProductSearchItem) => {
      setShowSearch(false);
      setCalcLoading(true);
      setCalcError(null);

      try {
        // The product detail resolves the offering merchants in parallel
        // with the calculation; it feeds the factual data-freshness
        // display only and never affects ordering. A failed detail fetch
        // degrades to no freshness rows for this column. The same detail
        // payload also supplies each offer's €/g metric (the best offer
        // becomes the column value).
        const [result, detail] = await Promise.all([
          calculateLandedCost({
            productId: item.id,
            quantity: 1,
            destination: DEFAULT_DESTINATION,
          }),
          getProductDetail(item.id).catch(() => null),
        ]);

        const merchants =
          detail !== null
            ? [...new Set(detail.offers.map((o) => o.merchant))].sort()
            : [];

        const unitPrice =
          detail !== null ? bestOfferUnitPrice(detail.offers) : undefined;

        // Distinct seller countries of the current offers (task 4.2) —
        // display input for the distance-selling badges only.
        const offerCountries =
          detail !== null
            ? [...new Set(detail.offers.map((o) => o.country))].sort()
            : [];

        const comparisonProduct: ComparisonProduct & {
          offerCountries?: readonly string[];
        } = {
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
          merchants,
          offerCountries,
          // Display-only blacklist warnings joined from the detail
          // payload (task 2.4) — rendered per column, ordering untouched.
          merchantWarnings: detail?.merchantWarnings ?? [],
          // Present only when the detail payload resolved — mirrors the
          // API's key-absent-when-unresolved contract; undefined renders
          // as no value.
          ...(unitPrice !== undefined ? { eurPerGram: unitPrice } : {}),
        };

        setProducts((prev) => [...prev, comparisonProduct]);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : tCalc('calculationFailed');
        setCalcError(message);
      } finally {
        setCalcLoading(false);
      }
    },
    [tCalc],
  );

  // ── Sort change handler ──
  const handleSortChange = useCallback(async (sort: CompareSortOrder) => {
    setSortBy(sort);
  }, []);

  // ── Column order follows the selected sort (deterministic, neutral —
  //    the same comparator semantics as the backend RankingService;
  //    EUR_PER_GRAM orders by metric value with product id as
  //    tiebreaker) ──
  const sortedProducts = useMemo(
    () => sortComparisonProducts(products, sortBy),
    [products, sortBy],
  );

  // ── Render ──
  return (
    <>
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
          + {t('addProduct')}
        </button>
      </div>

      {/* ── Search panel (shown when adding) ── */}
      {showSearch && (
        <section className="mb-8 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              {t('addProductTitle')}
            </h2>
            <button
              type="button"
              onClick={() => setShowSearch(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              {tCommon('cancel')}
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

          {/* Display-only merchant warnings for this result set
              (task 2.4) — the results themselves are untouched. */}
          {searchResults.length > 0 && (
            <div className="mt-3">
              <MerchantWarningNotice warnings={searchWarnings} compact />
            </div>
          )}

          {calcError && (
            <p className="mt-3 text-sm text-red-600">{calcError}</p>
          )}
        </section>
      )}

      {/* ── Comparison view ── */}
      <ComparisonView
        products={sortedProducts}
        sortBy={sortBy}
        loading={calcLoading || prefilling}
        onAddProduct={handleAddProduct}
      />

      {/* ── Empty / minimal state guidance ── */}
      {products.length > 0 && (
        <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t('aboutTitle')}
          </h2>
          <p className="text-xs leading-relaxed text-gray-500">
            {t.rich('aboutBody', {
              sort:
                sortBy === 'EUR_PER_GRAM'
                  ? t('eurPerGram.sortOptionLabel')
                  : tSorts(`${sortBy}.label`),
              link: (chunks) => (
                <Link
                  href="/ranking"
                  className="text-primary-600 underline hover:text-primary-800"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </section>
      )}

      {/* ── Multi-store basket comparison ── */}
      <BasketComparisonSection />
    </>
  );
}
