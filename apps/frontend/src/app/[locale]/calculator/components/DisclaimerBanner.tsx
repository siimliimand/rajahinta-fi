'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { Disclaimer } from '@/lib/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DisclaimerBannerProps {
  /** The structural disclaimer from the API response. */
  disclaimer: Disclaimer;
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
 * Surface and text use the amber token ramp (`status-stale-*` values) so the
 * palette stays token-based; the rendered text and structure are unchanged.
 */
export default function DisclaimerBanner({ disclaimer }: DisclaimerBannerProps) {
  const t = useTranslations('DisclaimerBanner');

  return (
    <div className="rounded-md border border-status-stale-border bg-status-stale-bg px-4 py-3">
      <p className="text-xs leading-relaxed text-status-stale-fg">
        {disclaimer.text}
      </p>
      <p className="mt-1 text-[10px] text-status-stale">
        v{disclaimer.version} · {t(`languageName.${disclaimer.language}`)}
      </p>
    </div>
  );
}
