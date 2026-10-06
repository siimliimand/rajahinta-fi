'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { ConfidenceLevel, Disclaimer } from '@/lib/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DisclaimerBannerProps {
  /** The structural disclaimer from the API response. */
  disclaimer: Disclaimer;
  /**
   * The result's confidence keys the intensity (change
   * hedge-dedup-confidence-meter 3.1, design D1): LOW renders the amber
   * `status-stale-*` banner; HIGH/MEDIUM render a quiet neutral one-liner.
   * The text and version line are byte-identical in both intensities.
   * Defaults to LOW so callers without a result confidence (the standing
   * declaration-guidance disclaimer) keep the prominent render.
   */
  readonly confidence?: ConfidenceLevel;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Structural disclaimer banner.
 *
 * Renders the disclaimer text returned by the API as a first-class UI element.
 * The disclaimer is part of the response payload — not a decorative footer —
 * as required by the architecture rule "disclaimer is structural".
 *
 * Intensity keys to the result confidence: LOW keeps the amber token ramp
 * (`status-stale-*` values); HIGH/MEDIUM render the quiet neutral gray
 * tokens. The payload text, version, and language line are identical in
 * both — only the presentation differs.
 */
export default function DisclaimerBanner({
  disclaimer,
  confidence = 'LOW',
}: DisclaimerBannerProps) {
  const t = useTranslations('DisclaimerBanner');
  const quiet = confidence !== 'LOW';

  return (
    <div
      data-testid="disclaimer-banner"
      data-confidence={confidence}
      className={
        quiet
          ? 'rounded-md border border-gray-200 bg-gray-50 px-4 py-3'
          : 'rounded-md border border-status-stale-border bg-status-stale-bg px-4 py-3'
      }
    >
      <p
        className={`text-xs leading-relaxed ${
          quiet ? 'text-gray-500' : 'text-status-stale-fg'
        }`}
      >
        {disclaimer.text}
      </p>
      <p
        className={`mt-1 text-[10px] ${
          quiet ? 'text-gray-400' : 'text-status-stale'
        }`}
      >
        v{disclaimer.version} · {t(`languageName.${disclaimer.language}`)}
      </p>
    </div>
  );
}
