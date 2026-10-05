// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { getTranslations } from 'next-intl/server';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { getServerProductPriceContext } from '../price-context';

interface ProductPriceContextLineProps {
  /** The product page's resolved product id. */
  readonly productId: number;
  /** The active request locale — dates and amounts render through the
   * shared formatters (fi-locale-surface-hardening 2.4). */
  readonly locale: string;
}

/**
 * The factual price-context line (insight-surfaces task 3.3, window-low
 * and percentile rendering in task 2.3 of funnel-evidence-and-value-
 * surfaces, spec price-context).
 *
 * ONE line composed of factual sentences: where the current lowest offer
 * price sits versus the 90-day window median (with the window and the
 * as-of date), then two window facts from task 2.1/2.2 — the window-low
 * fact (current best equals the window minimum) and the percentile rank
 * (share of the window's daily buckets strictly above the current best
 * price). The figures come from the same shared current-best-price
 * selection the offers panel above renders (both fetches ride the API's
 * lowestCurrentOfferPriceCents helper), so the line can never
 * contradict the panel.
 *
 * Content stance (proposal D3): statistics about the observed window
 * only. The delta is stated in cents — never a percentage. The ONE
 * percentage on this surface is the percentile rank, and it is a share
 * of window days, not a price move and not advice. The percentile is
 * displayed as an integer percent rounded half up from basis points
 * (`Math.round(bps / 100)` — e.g. 2857 bps → 29 %), and a 0 % result is
 * rendered as-is: this component states degenerate figures plainly (the
 * flat-median precedent) rather than omitting or softening them. The
 * server already refuses to compute a context below the minimum-bucket
 * gate, and INSUFFICIENT_HISTORY renders the honest "not enough history
 * yet" state with the two window facts absent — they are null there and
 * are never fabricated. Below-minimum and failed fetches keep the line
 * absent from the HTML rather than inventing copy. The line is
 * display-only: it feeds no calculation (design D2).
 */
export default async function ProductPriceContextLine({
  productId,
  locale,
}: ProductPriceContextLineProps) {
  const payload = await getServerProductPriceContext(productId);
  if (payload === null) {
    return null;
  }

  const t = await getTranslations('ProductPriceContext');
  const { context } = payload;
  // Localized calendar date for the window's as-of (2.4) — the raw
  // response value stays the date-only ISO string.
  const asOf = formatDate(context.asOf, locale);

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

  const current = formatMoney(payload.currentBestPriceCents, locale);
  const median = formatMoney(context.medianCents, locale);
  const delta = formatMoney(Math.abs(context.deltaVsMedianCents), locale);
  const key =
    context.deltaVsMedianCents > 0
      ? 'above'
      : context.deltaVsMedianCents < 0
        ? 'below'
        : 'flat';

  // Percentile rank for display: integer percent, basis points divided by
  // 100 and rounded half up (Math.round) — 2857 bps → 29 %. The bps value
  // is the share of the window's daily buckets STRICTLY above the current
  // best price (task 2.1), so the sentence stays a statistic about the
  // observed window, never advice (proposal D3). A 0 % result renders
  // as-is — see the module docblock for the degenerate-figure stance.
  const percentilePercent = Math.round(
    context.percentileRankBasisPoints / 100,
  );

  // One factual line, composed sentence by sentence: the median comparison
  // first (it carries the window and as-of context), then the window-low
  // fact when present, then the percentile rank. The computed branch
  // always carries both figures — the gated unavailable branch above
  // never renders these sentences.
  const sentences = [
    t(key, {
      current,
      median,
      delta,
      count: context.bucketCount,
      asOf,
      windowDays: context.windowDays,
    }),
  ];
  if (context.isWindowLow) {
    sentences.push(t('windowLow'));
  }
  sentences.push(t('percentileRank', { percent: percentilePercent }));

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
        {sentences.join(' ')}
      </p>
    </section>
  );
}
