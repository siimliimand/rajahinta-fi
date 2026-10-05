'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format/money';
import type { TravellerAlternative } from '@/lib/types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TravellerAlternativeCalloutProps {
  /** The live POST response's additive estimate — display-only data. */
  readonly alternative: TravellerAlternative;
  /** Seed values of the `/trip` prefill handshake (task 2.2). */
  readonly productId: number;
  readonly quantity: number;
}

/**
 * Traveller-alternative callout on DELIVERY results (task 2.2, change
 * finnish-first-client-experience): a clearly labelled ESTIMATE of what
 * one traveller carrying the same quantity could bring along within the
 * traveller allowance, provenance-pinned to the allowance dataset
 * version, with the "Kokeile matkalaskuria" link that hands the product
 * and quantity to `/trip?product=&quantity=`.
 *
 * Presentation contract: the estimate never restyles or replaces the
 * delivery amounts — it renders as its own labeled block beside the
 * breakdown, framed as an allowance-bounded estimate, never a promise.
 * When `withinAllowance` is false the copy says the figure covers only
 * the allowance-bounded portion. Rendered only from the live POST
 * payload — GET/persisted results never carry the field, and absence
 * renders nothing (render-nothing convention).
 *
 * @module TravellerAlternativeCallout
 */
export default function TravellerAlternativeCallout({
  alternative,
  productId,
  quantity,
}: TravellerAlternativeCalloutProps) {
  const t = useTranslations('CalculatorResult');
  const locale = useLocale();

  return (
    <div
      data-testid="traveller-alternative"
      className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t('travellerAlternative.label')}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-gray-700">
        {alternative.withinAllowance
          ? t('travellerAlternative.estimateWithin', {
              amount: formatMoney(alternative.estimatedTotalCents, locale),
            })
          : t('travellerAlternative.estimatePartial', {
              amount: formatMoney(alternative.estimatedTotalCents, locale),
            })}
      </p>
      <p
        data-testid="traveller-alternative-version"
        className="mt-1 text-xs text-gray-400"
      >
        {t('allowance.datasetVersion', {
          version: alternative.allowanceDatasetVersion,
        })}
      </p>
      <Link
        href={`/trip?product=${productId}&quantity=${quantity}`}
        data-testid="traveller-alternative-link"
        className="touch-target mt-2 inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
      >
        {t('travellerAlternative.tryLink')}
      </Link>
    </div>
  );
}
