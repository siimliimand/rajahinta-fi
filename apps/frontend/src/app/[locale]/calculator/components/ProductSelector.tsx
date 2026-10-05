'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  formatAbv,
  formatAttributeRow,
  formatVolume,
} from '@/lib/format/product-attributes';
import { formatMoney } from '@/lib/format/money';
import { LoadingSkeleton, ReliabilityBadge } from '@/components/ui';
import { RELIABILITY_STATUS_META } from '@/lib/design/status';
import type { ProductSearchItem } from '@/lib/types';

// ---------------------------------------------------------------------------
// Per-unit price context (catalog-first-run-polish 4.2, design D2)
// ---------------------------------------------------------------------------

/**
 * Ethanol density in grams per litre — the fixed convention of the €/g
 * metric (core-domain's `ETHANOL_DENSITY_G_PER_L`, mirrored as a literal
 * per the frontend's no-core-domain-import convention).
 */
const ETHANOL_DENSITY_G_PER_L = 789;

/**
 * The pack size the API's read-time name parse assigned to this row, or
 * null for a single-unit row.
 *
 * D2 constraint honoured without a duplicated parser: the row's €/g embed
 * was computed server-side as
 * `unitVolumeL × unitsPerPackage × alcoholFraction × 789`, and the row
 * carries the same per-unit volume and ABV the server used — so the ratio
 * `ethanolGrams ÷ (per-unit grams)` recovers exactly the unit count the
 * read-time parse produced. Null whenever an input to that ratio is
 * absent (no embed value, unparseable volume, no ABV): the helper then
 * renders nothing instead of guessing a count. Display-only — no
 * calculation input, ranking, or sort order ever reads this.
 */
export function packUnitsPerPackage(product: ProductSearchItem): number | null {
  const embed = product.eurPerGram;
  if (embed === undefined || embed.status === 'unavailable') return null;
  const volumeL = Number.parseFloat(product.unitVolume);
  const abv = product.alcoholByVolume;
  if (!Number.isFinite(volumeL) || volumeL <= 0) return null;
  if (abv === null || !(abv > 0)) return null;
  const units = Math.round(
    embed.ethanolGrams / (volumeL * abv * ETHANOL_DENSITY_G_PER_L),
  );
  return units > 1 ? units : null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProductSelectorProps {
  /** Products returned by the search. */
  items: ProductSearchItem[];
  /** ID of the currently selected product, or null. */
  selectedId: number | null;
  /** Called when the user selects a product. */
  onSelect: (product: ProductSearchItem) => void;
  /** Whether a search is in flight. */
  loading: boolean;
  /** The search query that produced these items. */
  query: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Displays a list of products from a search result and allows selection.
 *
 * Shows a loading skeleton while results are being fetched, and a "no results"
 * message when the search returned empty.
 */
export default function ProductSelector({
  items,
  selectedId,
  onSelect,
  loading,
  query,
}: ProductSelectorProps) {
  const t = useTranslations('ProductSelector');
  // Root namespace for the reliability-badge labels the €/g chip reuses
  // (RELIABILITY_STATUS_META's full-path labelKey contract).
  const tRoot = useTranslations();
  const locale = useLocale();

  // Loading state — the shared skeleton primitive plus a visible
  // status line (task 3.3: never a blank screen; the skeleton itself is
  // aria-hidden, so this text owns the loading announcement).
  if (loading) {
    return (
      <div role="status" data-testid="selector-loading">
        <p className="mb-2 text-sm text-gray-500">{t('loading')}</p>
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    if (query.trim().length === 0) {
      return <p className="text-sm text-gray-500">{t('typeToSearch')}</p>;
    }
    return (
      <p className="text-sm text-gray-500">{t('noResults', { query })}</p>
    );
  }

  // Results list
  return (
    <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
      {items.map((product) => {
        const isSelected = product.id === selectedId;
        // Shared attribute formatters (task 4.1): the volume carries an
        // explicit unit label and the ABV renders as a percentage — the
        // raw `abvValue` interpolation leaked stored fractions as
        // "0.047% ABV".
        const volume = formatVolume(product.unitVolume);
        const abv = formatAbv(product.alcoholByVolume);
        // Per-unit price context (catalog-first-run-polish 4.2, design
        // D2): display-only, derived from the row's own embed — the
        // helper shows on multi-unit pack rows only, beside the absolute
        // price. The €/g embed renders with the catalog chip's canonical
        // presentation (value + localized unit + the input price's
        // reliability badge); an absent or unavailable embed renders
        // nothing — no placeholder, no zero.
        const packUnits = packUnitsPerPackage(product);
        const perUnitPrice =
          packUnits !== null && product.lowestPriceCents !== null
            ? formatMoney(
                Math.round(product.lowestPriceCents / packUnits),
                locale,
              )
            : null;
        const embed =
          product.eurPerGram !== undefined &&
          product.eurPerGram.status !== 'unavailable'
            ? product.eurPerGram
            : null;
        return (
          <li key={product.id}>
            <button
              type="button"
              onClick={() => onSelect(product)}
              className={`w-full px-3 py-3 text-left text-sm transition-colors hover:bg-primary-50 focus:bg-primary-50 focus:outline-none ${
                isSelected
                  ? 'bg-primary-100 ring-1 ring-inset ring-primary-500'
                  : ''
              }`}
            >
              <span className="block font-medium text-gray-900">
                {product.name}
              </span>
              <span className="block text-xs text-gray-500">
                {formatAttributeRow(product.brand, product.category, volume, abv)}
              </span>
              {/* ── Lowest observed price (change
                  unit-integrity-and-result-trust, task 3.2): rendered only
                  when the product has offers — an offer-less row stays
                  honestly empty, never a displayed €0.00. ── */}
              {product.lowestPriceCents !== null && (
                <span
                  className="mt-0.5 block text-xs font-medium text-gray-700"
                  data-testid="row-lowest-price"
                >
                  {t('lowestPrice', {
                    price: formatMoney(product.lowestPriceCents, locale),
                  })}
                </span>
              )}
              {/* ── Pack-row per-unit helper (catalog-first-run-polish
                  4.2): "≈ x,xx €/kpl" so a 24-pack row can never be read
                  as a single-unit price. Display-only. ── */}
              {perUnitPrice !== null && (
                <span
                  className="mt-0.5 block text-xs text-gray-500"
                  data-testid="row-per-unit-price"
                >
                  {t('perUnitPrice', { price: perUnitPrice })}
                </span>
              )}
              {/* ── €/g embed (catalog-first-run-polish 4.2): the same
                  read-time metric the catalog cards surface, in the
                  catalog chip's presentation. ── */}
              {embed !== null && (
                <span
                  className="mt-1 flex flex-wrap items-center gap-1.5"
                  data-testid="row-eur-per-gram"
                >
                  <span className="font-semibold tabular-nums text-gray-900">
                    {t('eurPerGramChip', {
                      value: embed.centsPerGram.toFixed(2),
                    })}
                  </span>
                  <ReliabilityBadge status={embed.priceReliability}>
                    {tRoot(
                      RELIABILITY_STATUS_META[embed.priceReliability]
                        .labelKey,
                    )}
                  </ReliabilityBadge>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
