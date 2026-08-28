'use client';

import { useTranslations } from 'next-intl';
import type {
  ComparisonProduct,
  ConfidenceLevel,
  ReliabilityStatus,
  SortOrder,
} from '@/lib/types';
import { logClick } from '@/lib/api';
import { MerchantLink } from './MerchantLink';
import MerchantFreshnessSection from './MerchantFreshnessSection';
import ProductHistoryPanel from '../../calculator/components/ProductHistoryPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents to a euro string. */
function formatEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/** Dot colour for confidence levels. */
const CONFIDENCE_DOT: Record<ConfidenceLevel, string> = {
  HIGH: 'bg-green-400',
  MEDIUM: 'bg-amber-400',
  LOW: 'bg-red-400',
};

/** Dot colour for reliability. */
const RELIABILITY_DOT: Record<ReliabilityStatus, string> = {
  VERIFIED: 'bg-green-400',
  ESTIMATED: 'bg-amber-400',
  STALE: 'bg-orange-400',
  UNAVAILABLE: 'bg-red-400',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ComparisonViewProps {
  /** Products being compared. */
  products: readonly ComparisonProduct[];
  /** Currently selected sort order (displayed but not actionable here). */
  sortBy: SortOrder;
  /** Whether a calculation is in progress for new products. */
  loading: boolean;
  /** Called when the user wants to add a product to the comparison. */
  onAddProduct: () => void;
}

// ---------------------------------------------------------------------------
// Sub-component: single product column
// ---------------------------------------------------------------------------

/**
 * A single product column in the comparison grid.
 *
 * **Neutrality constraint**: every product card is visually identical.
 * No "featured", "top", "starred", "recommended", or promoted badges
 * appear. All products get equal visual weight regardless of price or rank.
 */
function ProductColumn({
  product,
}: {
  product: ComparisonProduct;
}) {
  const t = useTranslations('Compare');
  const tCommon = useTranslations('Common');

  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {/* Product info — every column looks the same */}
      <h3 className="text-sm font-semibold text-gray-900">{product.name}</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        {product.brand}
        {product.category ? ` · ${product.category}` : ''}
        {product.unitVolume ? ` · ${product.unitVolume}` : ''}
      </p>
      {product.alcoholByVolume !== null && (
        <p className="mt-0.5 text-xs text-gray-400">
          {tCommon('abvValue', { value: product.alcoholByVolume })}
        </p>
      )}

      {/* Separator */}
      <hr className="my-3 border-gray-100" />

      {/* Total cost — primary metric */}
      <div className="mb-3">
        <span className="text-xs text-gray-400">{t('totalLandedCost')}</span>
        <p className="text-lg font-bold tabular-nums text-gray-900">
          {formatEur(product.totalCents)}
        </p>
      </div>

      {/* Cost breakdown */}
      <div className="space-y-1">
        {product.itemizedCosts.map((cost, i) => (
          <div
            key={`${cost.category}-${i}`}
            className="flex items-center justify-between text-xs"
          >
            <span className="text-gray-500">{cost.label}</span>
            <div className="flex items-center gap-1">
              <span className="tabular-nums text-gray-700">
                {formatEur(cost.cents)}
              </span>
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${RELIABILITY_DOT[cost.reliability]}`}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Merchant data-freshness display — factual per-merchant summary
          from the reliability endpoint, flag-gated (hidden and unfetched
          when the enable_advanced_features flag is off). Informational
          only: identical styling per merchant, no ranking alteration. */}
      <div className="mt-3">
        <MerchantFreshnessSection merchants={product.merchants ?? []} />
      </div>

      {/* Historical price chart — product-wide series, flag-gated the same
          way as the calculator result view (hidden and unfetched when the
          enable_historical_price_intelligence flag is off). Every product
          column carries an identical panel — equal visual weight. */}
      <div className="mt-3">
        <ProductHistoryPanel productId={product.id} />
      </div>

      {/* Merchant link — shown when a retail offer ID is available */}
      {product.offerId && product.merchantName && (
        <div className="mt-3">
          <MerchantLink
            label={t('viewAt', { merchant: product.merchantName })}
            offerId={product.offerId}
            onClick={() => {
              logClick(product.merchantName!, String(product.offerId!));
            }}
            className="text-xs text-primary-600 hover:text-primary-800"
          />
        </div>
      )}

      {/* Separator */}
      <hr className="my-3 border-gray-100" />

      {/* Confidence indicator — no label/rank, just a visual cue */}
      <div className="mt-auto flex items-center gap-1.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${CONFIDENCE_DOT[product.confidence]}`}
        />
        <span className="text-xs text-gray-400">{t('dataConfidence')}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Side-by-side product comparison view with neutral ranking.
 *
 * **Neutrality guarantee**: no product is visually promoted over another.
 * All product cards share the same layout, type scale, and colour.
 * There are no "featured", "top", "starred", or "paid" badges.
 *
 * The sort order is displayed but applied externally — this component
 * renders items in the order it receives them.
 */
export default function ComparisonView({
  products,
  sortBy,
  loading,
  onAddProduct,
}: ComparisonViewProps) {
  const t = useTranslations('Compare');
  const tSorts = useTranslations('SortOrders');

  // ── Empty state ──
  if (products.length === 0 && !loading) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <p className="text-sm text-gray-500">{t('empty')}</p>
        <button
          type="button"
          onClick={onAddProduct}
          className="mt-3 inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          {t('addProductTitle')}
        </button>
      </div>
    );
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-2 h-4 w-3/4 rounded bg-gray-200" />
            <div className="mb-4 h-3 w-1/2 rounded bg-gray-100" />
            <div className="mb-3 h-8 w-1/3 rounded bg-gray-200" />
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-gray-100" />
              <div className="h-3 w-5/6 rounded bg-gray-100" />
              <div className="h-3 w-3/4 rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Results grid ──
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {t('productsCompared', { count: products.length })}{' '}
          &middot;{' '}
          {t('sortedBy', { sort: tSorts(`${sortBy}.label`) })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <ProductColumn key={product.id} product={product} />
        ))}

        {/* Empty column with "add" action — same visual weight */}
        <button
          type="button"
          onClick={onAddProduct}
          className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-400 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600"
        >
          <span className="mb-1 text-lg leading-none">+</span>
          {t('addProduct')}
        </button>
      </div>
    </div>
  );
}
