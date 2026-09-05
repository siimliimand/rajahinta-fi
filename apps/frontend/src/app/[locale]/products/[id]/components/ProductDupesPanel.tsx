/**
 * Product-page dupe panel (task 6.4, change product-roadmap-phases-1-4)
 * — curated sibling products with their WHY (design R9).
 *
 * Gating (R13, server-resolved): the panel resolves the
 * PRODUCER_DUPE_FINDER flag server-side via the bootstrapped flag
 * payload and fetches the dupes server-side alongside the page's own
 * data. It renders ONLY when the flag is on AND at least one curated
 * link exists — flag off, fetch failure (including a 403 from the flag
 * flipping mid-revalidate), or an empty list all render nothing: no
 * empty shell, nothing in the HTML, no layout shift.
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
import { getServerFeatureFlags } from '@/lib/api';
import { Badge, Card } from '@/components/ui';
import { getServerProductDupes } from '../product-dupes';
import { isProducerDupeFinderFlagEnabled } from '../product-dupes-flag';

interface ProductDupesPanelProps {
  /** The product page's resolved product id. */
  readonly productId: number;
}

/** Server component; absent from the HTML unless gated in. */
export default async function ProductDupesPanel({
  productId,
}: ProductDupesPanelProps) {
  const flags = await getServerFeatureFlags();
  if (!isProducerDupeFinderFlagEnabled(flags)) {
    return null;
  }

  const dupes = await getServerProductDupes(productId);
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
                href={`/products/${dupe.siblingProductId}`}
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
