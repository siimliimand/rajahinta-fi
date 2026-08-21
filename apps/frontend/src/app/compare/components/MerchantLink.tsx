'use client';

import React from 'react';
import { BASE_URL } from '@/lib/api';

/**
 * Props for the MerchantLink component.
 *
 * Renders an outbound link through the backend's redirect endpoint
 * so click-through analytics are captured server-side.  No affiliate
 * IDs, no tracking parameters, no purchase tracking.
 */
export interface MerchantLinkProps {
  /** Display text for the link (merchant name or "View at merchant") */
  readonly label: string;
  /** Retail-offer ID used to build the `/api/v1/outbound/:offerId` redirect URL */
  readonly offerId: number;
  /** Optional callback when the link is clicked (for basic click-through count) */
  readonly onClick?: () => void;
  /** Optional additional CSS classes */
  readonly className?: string;
}

/**
 * Outbound merchant link routing through the backend redirect endpoint.
 *
 * - Constructs a URL to `GET /api/v1/outbound/:offerId` which redirects
 *   the browser to the actual merchant page while recording the click.
 * - Uses `rel="nofollow noopener" target="_blank"` for security and SEO.
 * - No affiliate IDs, no tracking parameters, no purchase tracking.
 * - Visually: standard link styling, no prominent call-to-action.
 *
 * @example
 * ```tsx
 * <MerchantLink
 *   label="View at Merchant"
 *   offerId={42}
 *   onClick={() => trackClick('merchant-123')}
 * />
 * ```
 */
export function MerchantLink({
  label,
  offerId,
  onClick,
  className,
}: MerchantLinkProps) {
  const href = `${BASE_URL}/api/v1/outbound/${offerId}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="nofollow noopener"
      onClick={onClick}
      className={className}
    >
      {label}
    </a>
  );
}
