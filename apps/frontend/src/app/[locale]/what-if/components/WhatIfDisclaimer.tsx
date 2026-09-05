'use client';

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { Disclaimer } from '@/lib/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WhatIfDisclaimerProps {
  /** The structural HYPOTHETICAL disclaimer from the API response. */
  disclaimer: Disclaimer;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Prominent, non-dismissible rendering of the structural HYPOTHETICAL
 * disclaimer (spec: excise-what-if-simulator).
 *
 * Unlike the calculator's quiet footer banner, the what-if disclaimer is
 * rendered first in the results, at body-text size, with a warning icon —
 * the spec demands a presentation stronger than the standard calculator
 * disclaimer, and one with no dismiss affordance. The text is the
 * structural field from the response, verbatim — never a UI-only string.
 *
 * Amber uses the same token ramp as the calculator banner
 * (`status-stale-*`), keeping the palette token-based.
 */
export default function WhatIfDisclaimer({ disclaimer }: WhatIfDisclaimerProps) {
  const tBanner = useTranslations('DisclaimerBanner');

  return (
    <div
      data-testid="what-if-disclaimer"
      data-disclaimer-version={disclaimer.version}
      className="rounded-md border border-status-stale-border bg-status-stale-bg px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 h-5 w-5 shrink-0 text-status-stale-fg"
        >
          <path d="M10 3 1.8 17h16.4L10 3z" />
          <path d="M10 8.5v4" />
          <path d="M10 15.4h.01" />
        </svg>
        <p
          className="text-sm font-medium leading-relaxed text-status-stale-fg"
          lang={disclaimer.language}
        >
          {disclaimer.text}
        </p>
      </div>
      <p className="mt-1 pl-7 text-[10px] text-status-stale">
        v{disclaimer.version} · {tBanner(`languageName.${disclaimer.language}`)}
      </p>
    </div>
  );
}
