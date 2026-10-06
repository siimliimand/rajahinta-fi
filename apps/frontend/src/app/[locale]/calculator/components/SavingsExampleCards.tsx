'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ProductSearchItem } from '@/lib/types';
import type { SavingsBestPerMerchantRow } from '@/lib/api';
import { formatMoney, formatSignedMoney } from '@/lib/format/money';

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/**
 * Map one snapshot row into the shape the calculator's selection flow
 * consumes — the same `ProductSearchItem` a search-result choice carries.
 * Master data the snapshot does not store (brand, volume, ABV) stays
 * absent; the Configure step renders honestly without it. The observed
 * merchant price rides along as the row's observed price, so the
 * Configure step's price line continues the card's figure.
 */
export function savingsRowToSearchItem(
  row: SavingsBestPerMerchantRow,
): ProductSearchItem {
  return {
    id: row.productId,
    name: row.productName,
    brand: '',
    category: row.category,
    alcoholByVolume: null,
    unitVolume: '',
    containerType: '',
    lowestPriceCents: row.priceCents,
    merchantCount: 1,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SavingsExampleCardsProps {
  /** One row per cross-border merchant from the snapshot listing. */
  readonly deals: readonly SavingsBestPerMerchantRow[];
  /** The view's existing selection handler (a search-result pick's path). */
  readonly onPick: (product: ProductSearchItem) => void;
}

/**
 * The calculator's first-paint examples (task 3.1, change
 * savings-first-catalog-and-prefill): one card per cross-border merchant
 * rendering that row's SNAPSHOT figures — observed price, landed total,
 * gap — under an explicit example label with a link to the /savings
 * listing.
 *
 * Display face only: rendering the cards performs no calculation call
 * and creates no calculation record. Activating a card hands the row to
 * the view's existing selection handler; the calculation happens later,
 * only on the visitor's explicit action. Every card is one button —
 * keyboard operable, touch-sized through the shared `touch-target` class.
 */
export default function SavingsExampleCards({
  deals,
  onPick,
}: SavingsExampleCardsProps) {
  const t = useTranslations('Calculator');
  const locale = useLocale();

  if (deals.length === 0) return null;

  return (
    <section
      data-testid="savings-examples"
      aria-label={t('examplesHeading')}
      className="mt-4"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('examplesHeading')}
        </p>
        <Link
          href="/savings"
          className="touch-target inline-flex items-center rounded-md text-xs font-medium text-primary-600 transition-colors hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          {t('examplesLink')}
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {deals.map((row) => (
          <li key={row.productId}>
            <button
              type="button"
              data-testid="savings-example-card"
              onClick={() => onPick(savingsRowToSearchItem(row))}
              className="touch-target h-full w-full rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              <span
                data-testid="savings-example-badge"
                className="inline-flex rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700"
              >
                {t('exampleBadge')}
              </span>
              <span className="mt-1 block truncate text-sm font-medium text-gray-900">
                {row.productName}
              </span>
              <span className="block text-xs text-gray-500">
                {row.merchant} · {row.merchantCountry}
              </span>
              <span className="mt-1 block text-xs text-gray-600">
                {t('observedPrice', {
                  price: formatMoney(row.priceCents, locale),
                })}
              </span>
              <span className="block text-sm font-semibold tabular-nums text-gray-900">
                {t('exampleLandedTotal', {
                  price: formatMoney(row.landedTotalCents, locale),
                })}
              </span>
              <span className="block text-xs tabular-nums text-gray-500">
                {t('exampleGap', {
                  gap: formatSignedMoney(row.gapCents, locale),
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
