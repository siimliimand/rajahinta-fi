// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { Link } from '@/i18n/navigation';

/** The label set the topical cross-links block renders. */
export interface RelatedToolsLabels {
  readonly title: string;
  readonly allowances: string;
  readonly allowancesBody: string;
  readonly trip: string;
  readonly tripBody: string;
}

/**
 * The topical cross-links shared by the guides index and slug page
 * (insight-surfaces task 5.2, spec guides-hub) — the two product
 * surfaces guides most often describe: the duty-free allowances
 * reference and the trip calculator. Factual labels only.
 */
export default function RelatedTools({ labels }: { labels: RelatedToolsLabels }) {
  return (
    <nav
      aria-label={labels.title}
      className="mt-10 border-t border-gray-200 pt-6"
      data-testid="guides-related"
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
        {labels.title}
      </h2>
      <ul className="space-y-3">
        <li>
          <Link
            href="/allowances"
            className="text-sm font-medium text-primary-600 hover:text-primary-800"
          >
            {labels.allowances} →
          </Link>
          <p className="text-xs text-gray-500">{labels.allowancesBody}</p>
        </li>
        <li>
          <Link
            href="/trip"
            className="text-sm font-medium text-primary-600 hover:text-primary-800"
          >
            {labels.trip} →
          </Link>
          <p className="text-xs text-gray-500">{labels.tripBody}</p>
        </li>
      </ul>
    </nav>
  );
}
