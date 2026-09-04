import React from 'react';
import { render as rtlRender } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import fiMessages from '@/messages/fi.json';
import { FeatureFlagsProvider } from '@/lib/feature-flags';
import type { FeatureFlagsResponse } from '@/lib/types';

/**
 * Flag states inlined into every test render, mirroring what the [locale]
 * layout provides in the app. Defaults to all-on because most component
 * tests exercise the flag-on surface; flag-off tests pass their own value.
 */
export const ALL_FLAGS_ON: FeatureFlagsResponse = {
  flags: {
    HISTORICAL_PRICE_INTELLIGENCE: true,
    BASKET_OPTIMIZATION: true,
    ADVANCED_FEATURES: true,
    UNIT_PRICE_EUR_PER_GRAM: true,
  },
};

/** All flags off — mirrors the layout's server-side failure fallback. */
export const ALL_FLAGS_OFF: FeatureFlagsResponse = {
  flags: {
    HISTORICAL_PRICE_INTELLIGENCE: false,
    BASKET_OPTIMIZATION: false,
    ADVANCED_FEATURES: false,
    UNIT_PRICE_EUR_PER_GRAM: false,
  },
};

/**
 * Render a component wrapped in the Finnish (default-locale) message
 * provider and the feature-flag provider, mirroring what the [locale]
 * layout inlines in the app.
 *
 * Component tests assert Finnish copy because Finnish is the source of
 * truth and the default locale.
 */
export function renderWithIntl(
  ui: React.ReactElement,
  { featureFlags = ALL_FLAGS_ON }: { featureFlags?: FeatureFlagsResponse } = {},
) {
  return rtlRender(
    <NextIntlClientProvider locale="fi" messages={fiMessages}>
      <FeatureFlagsProvider flags={featureFlags}>{ui}</FeatureFlagsProvider>
    </NextIntlClientProvider>,
  );
}
