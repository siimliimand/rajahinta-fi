/**
 * Product-page dupe panel (task 6.4, change product-roadmap-phases-1-4)
 * — curated sibling products with their WHY (design R9).
 *
 * Rendering: the page owns the dupes fetch (price-history-latency 3.1 —
 * all of the page's server fetches start concurrently, so this payload
 * resolves alongside detail and history rather than after them) and, since
 * product-page-cold-latency 4.1, hands the still-pending PROMISE down as
 * the `dupes` prop; the panel awaits it inside the page's Suspense
 * boundary, so the panel streams after the shell instead of delaying it.
 * The panel renders ONLY when at least one curated link exists — a
 * promise that resolves null (fetch failure) or an empty list renders
 * nothing: no empty shell, nothing in the HTML, no layout shift.
 *
 * Evidence discipline (R9): every row shows the WHY — the normalized
 * producer key the exact match ran on (Badge, estimated tone: curated
 * catalog evidence, not an observed fact), the manufacturer behind the
 * link, and a verifiable source link.
 *
 * Link treatment: a producer-link row carries no retail-offer id, so the
 * offer-keyed outbound redirect controller (`/api/v1/outbound/:offerId`)
 * does not apply — the sourceUrl is a direct evidence URL and renders as
 * a plain external anchor with the app's outbound-link treatment
 * (new tab, `rel="nofollow noopener"`, no affiliate parameters — the
 * MerchantLink precedent minus the redirect hop, which exists to record
 * offer click analytics these curated rows don't have).
 *
 * @module ProductDupesPanel
 */

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Badge, Card } from '@/components/ui';
import type { ProductDupesResponse } from '../product-dupes';

interface ProductDupesPanelProps {
  /**
   * The page's still-pending dupes promise (product-page-cold-latency
   * 4.1: the page starts all its server fetches concurrently and hands
   * the promise down; the panel awaits it inside the page's Suspense
   * boundary). A promise that resolves null — failed fetch, unreachable
   * backend — or resolves to an empty list renders NOTHING: the panel
   * stays absent from the HTML, exactly as when this component fetched
   * for itself.
   */
  readonly dupes: Promise<ProductDupesResponse | null>;
}

/** Server component; absent from the HTML when no curated links exist. */
export default async function ProductDupesPanel({
  dupes: dupesPromise,
}: ProductDupesPanelProps) {
  const dupes = await dupesPromise;
  if (dupes === null || dupes.dupes.length === 0) {
    return null;
  }

  const t = await getTranslations('ProductDupes');

  return (
    <Card as="section" padding="lg" className="mb-8" data-testid="product-dupes-panel">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
        {t('title')}
      </h2>
      <p className="mb-4 text-xs text-gray-400">{t('dataNote')}</p>

      <ul className="space-y-4">
        {dupes.dupes.map((dupe) => (
          <li
            key={dupe.siblingProductId}
            data-testid="product-dupe-item"
            className="border-b border-gray-100 pb-4 last:border-b-0 last:pb-0"
          >
            {/* The WHY, first: the matching key and the manufacturer
                behind the link (R9). */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="estimated" size="sm">
                {dupe.producerKey}
              </Badge>
              <span className="text-xs text-gray-400">
                {t('producerLabel')}
              </span>
              <span className="text-sm text-gray-700">
                {t('manufacturerEvidence', { manufacturer: dupe.manufacturer })}
              </span>
            </div>

            <div className="mt-1.5 text-sm">
              <Link
                href={{
                  pathname: '/products/[id]',
                  params: { id: dupe.siblingProductId },
                }}
                className="font-medium text-primary-700 hover:underline"
              >
                {t('siblingLink', { id: dupe.siblingProductId })}
              </Link>
              {' · '}
              {/* Direct evidence URL — see the link-treatment note in the
                  module doc: no offer id exists to route through the
                  outbound redirect controller, so the source link uses the
                  app's outbound-anchor treatment instead. */}
              <a
                href={dupe.sourceUrl}
                target="_blank"
                rel="nofollow noopener"
                className="text-primary-700 hover:underline"
              >
                {t('sourceLink')}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
