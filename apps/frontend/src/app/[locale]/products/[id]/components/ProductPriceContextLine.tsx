// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { getTranslations } from 'next-intl/server';
import { getServerProductPriceContext } from '../price-context';

interface ProductPriceContextLineProps {
  /** The product page's resolved product id. */
  readonly productId: number;
}

/**
 * The factual price-context line (insight-surfaces task 3.3, spec
 * price-context).
 *
 * ONE sentence: where the current lowest offer price sits versus the
 * 90-day window median, with the window and the as-of date included.
 * The figures come from the same shared current-best-price selection
 * the offers panel above renders (both fetches ride the API's
 * lowestCurrentOfferPriceCents helper), so the line can never
 * contradict the panel.
 *
 * Content stance: comparison and evidence only. The delta is stated in
 * cents — never a percentage, which the spec forbids over thin data,
 * and the server already refuses to compute a context below the
 * minimum-bucket gate (INSUFFICIENT_HISTORY renders the honest
 * "not enough history yet" state). Below-minimum and failed fetches
 * keep the line absent from the HTML rather than inventing copy.
 */
export default async function ProductPriceContextLine({
  productId,
}: ProductPriceContextLineProps) {
  const payload = await getServerProductPriceContext(productId);
  if (payload === null) {
    return null;
  }

  const t = await getTranslations('ProductPriceContext');
  const { context } = payload;
  const asOf = context.asOf;

  if (context.status === 'unavailable') {
    return (
      <section
        data-testid="product-price-context"
        data-state="unavailable"
        className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-4"
      >
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('title')}
        </h2>
        <p className="text-sm leading-relaxed text-gray-600">
          {t('insufficientHistory', {
            count: context.bucketCount,
            asOf,
            windowDays: context.windowDays,
          })}
        </p>
      </section>
    );
  }

  const current = formatEuros(payload.currentBestPriceCents);
  const median = formatEuros(context.medianCents);
  const delta = formatEuros(Math.abs(context.deltaVsMedianCents));
  const key =
    context.deltaVsMedianCents > 0
      ? 'above'
      : context.deltaVsMedianCents < 0
        ? 'below'
        : 'flat';

  return (
    <section
      data-testid="product-price-context"
      data-state="computed"
      className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-4"
    >
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
        {t('title')}
      </h2>
      <p className="text-sm leading-relaxed text-gray-600">
        {t(key, {
          current,
          median,
          delta,
          count: context.bucketCount,
          asOf,
          windowDays: context.windowDays,
        })}
      </p>
    </section>
  );
}

/** Euros with two decimals — the same presentation as the offers table. */
function formatEuros(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}
