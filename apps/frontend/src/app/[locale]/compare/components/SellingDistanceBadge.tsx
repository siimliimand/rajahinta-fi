// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { Badge, type BadgeTone } from '@/components/ui';

/**
 * Distance-selling status badge (task 4.2, change
 * client-experience-improvement; spec product-catalog "Distance-selling
 * status guidance").
 *
 * Derives ONLY from the seller-country signal of one offer:
 * - FI seller → Etämyynti (distance selling): the merchant handles the
 *   Finnish alcohol taxes — no buyer steps.
 * - foreign seller → Etäosto (distance buying): the buyer arranges
 *   transport and files the declarations; the badge links to the guides
 *   hub.
 *
 * ADDITIVE DISPLAY FIELD: the badge is a pure function of the offer's
 * already-published country value. It never enters a calculation, a
 * ranking, or an ordering — the compliance suite
 * (tests/compliance/distance-selling-badges-display-only.test.ts) pins
 * byte-identical calculation/ranking output across zero, one, and many
 * badges present. The framing is general information, not legal advice;
 * the estimated (blue) tone keeps Etäosto informational — never a
 * warning (red is reserved for errors).
 */

/** The two statuses the seller-country signal yields. */
export type SellingDistanceStatus = 'distance-selling' | 'distance-buying';

/**
 * Pure derivation — the seller-country signal only. Exported for the
 * display components and the compliance assertions; no caller may feed
 * the result anywhere but the UI.
 */
export function sellingDistanceStatusOf(
  country: string,
): SellingDistanceStatus {
  return country === 'FI' ? 'distance-selling' : 'distance-buying';
}

/** Badge tone per status — verified green vs informational blue. */
const STATUS_TONES: Record<SellingDistanceStatus, BadgeTone> = {
  'distance-selling': 'verified',
  'distance-buying': 'estimated',
};

export interface SellingDistanceBadgeProps {
  /** The offer's seller country (ISO alpha-2, as the API publishes it). */
  readonly country: string;
  /** Localized Etämyynti label. */
  readonly sellingLabel: string;
  /** Localized Etäosto label. */
  readonly buyingLabel: string;
  /**
   * Link target for the Etäosto badge (the locale-prefixed guides path) —
   * absent renders the badge without a link. A plain anchor on purpose:
   * the component stays free of the next-intl navigation graph so it is
   * importable from server components and their tests unchanged.
   */
  readonly guideHref?: string;
  readonly className?: string;
}

/**
 * One offer's distance-selling status badge. Presentational only — the
 * caller supplies all copy; this component owns the derivation and the
 * tone.
 */
export function SellingDistanceBadge({
  country,
  sellingLabel,
  buyingLabel,
  guideHref,
  className = '',
}: SellingDistanceBadgeProps) {
  const status = sellingDistanceStatusOf(country);
  const label = status === 'distance-selling' ? sellingLabel : buyingLabel;
  const badge = (
    <Badge tone={STATUS_TONES[status]} size="sm" className={className}>
      {label}
    </Badge>
  );
  if (status === 'distance-buying' && guideHref !== undefined) {
    return (
      <a href={guideHref} className="inline-flex hover:underline">
        {badge}
      </a>
    );
  }
  return badge;
}
