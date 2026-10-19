// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { Link } from '@/i18n/navigation';

interface ScanEntryButtonProps {
  /** Hover title, resolved server-side from Scan.entryLabel. */
  readonly label: string;
  /** Accessible name, resolved server-side from Scan.entryAriaLabel. */
  readonly ariaLabel: string;
}

/**
 * Scan entry affordance in the catalog's search row (task 3.3, change
 * label-scan-product-lookup).
 *
 * The spec pins the scan entry point to exactly two surfaces — this row
 * and the /scan route itself — so the affordance is ONE icon button
 * beside the keyword-search input and nothing app-wide changes. A plain
 * sync server component: the labels resolve in the page via
 * getTranslations (the server owns the vocabulary — the
 * CategoryAlertAction categoryLabel precedent), the link needs no client
 * JS, so the camera surface stays out of the catalog bundle entirely
 * (the /scan page loads it behind its own dynamic import) and the
 * /products route's client-namespace subset is untouched.
 *
 * Mobile-first (design D): the scanner is a phone feature — the button
 * sits immediately after the input in DOM order (thumb-reachable when
 * the row wraps) and carries the ≥44 px touch-target floor like every
 * control in the search area. The icon is decorative inline SVG (the
 * task-card icon approach; no icon dependency); the accessible name is
 * `ariaLabel` with `label` as the hover title — color never carries the
 * meaning alone (design D1).
 *
 * @module ScanEntryButton
 */
export default function ScanEntryButton({ label, ariaLabel }: ScanEntryButtonProps) {
  return (
    <Link
      href={{ pathname: '/scan' }}
      aria-label={ariaLabel}
      title={label}
      data-testid="scan-entry"
      className="touch-target inline-flex items-center justify-center rounded-md border border-gray-300 bg-white p-2.5 text-gray-700 transition-colors hover:bg-gray-50"
    >
      <svg
        aria-hidden="true"
        focusable="false"
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    </Link>
  );
}
