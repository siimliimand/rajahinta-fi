'use client';

import React from 'react';

/**
 * Props for the MerchantLink component.
 *
 * Renders a plain outbound link to a merchant's product page.
 * No affiliate IDs, no tracking parameters, no purchase tracking.
 */
export interface MerchantLinkProps {
  /** Display text for the link (merchant name or "View at merchant") */
  readonly label: string;
  /** Outbound URL to the merchant's product page */
  readonly href: string;
  /** Optional callback when the link is clicked (for basic click-through count) */
  readonly onClick?: () => void;
  /** Optional additional CSS classes */
  readonly className?: string;
}

/**
 * Plain outbound merchant link with security attributes.
 *
 * - Uses rel="noopener noreferrer" to prevent tab-napping
 * - No affiliate IDs, no tracking parameters
 * - No commission tracking, no purchase tracking
 * - Visually: standard link styling, no prominent call-to-action
 *
 * @example
 * ```tsx
 * <MerchantLink
 *   label="View at Merchant"
 *   href="https://example.com/product/123"
 *   onClick={() => trackClick('merchant-123')}
 * />
 * ```
 */
export function MerchantLink({
  label,
  href,
  onClick,
  className,
}: MerchantLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={className}
    >
      {label}
    </a>
  );
}
