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
 */
export default function DisclaimerBanner({ disclaimer }: DisclaimerBannerProps) {
  const t = useTranslations('DisclaimerBanner');

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-xs leading-relaxed text-amber-800">
        {disclaimer.text}
      </p>
      <p className="mt-1 text-[10px] text-amber-600">
        v{disclaimer.version} · {t(`languageName.${disclaimer.language}`)}
      </p>
    </div>
  );
}
