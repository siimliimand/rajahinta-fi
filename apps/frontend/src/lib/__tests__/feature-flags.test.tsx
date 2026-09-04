/**
 * FeatureFlagsProvider/useFeatureFlags contract tests (task 9.4).
 *
 *   1. The hook returns the inlined flag states synchronously — the value
 *      present in the first render, with no fetch round-trip.
 *   2. Using the hook outside the provider is a wiring error, not a
 *      silent fallback — the layout is the only flag source.
 *
 * @module FeatureFlagsTest
 */
// @vitest-environment jsdom

import React from 'react';
import { render as rtlRender } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { useFeatureFlags } from '@/lib/feature-flags';
import { renderWithIntl } from '@/lib/testing/test-intl';
import fiMessages from '@/messages/fi.json';

function Probe() {
  const flags = useFeatureFlags();
  return <div data-testid="flags">{JSON.stringify(flags.flags)}</div>;
}

// Render without the flag provider (message provider only), mirroring a
// consumer mounted outside the layout's provider tree.
function renderWithoutFlagProvider(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="fi" messages={fiMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('FeatureFlagsProvider', () => {
  it('exposes the inlined flag states on the first render', () => {
    // renderWithIntl wraps in the provider; a fetch spy proves the value
    // arrives without any network round-trip.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { getByTestId } = renderWithIntl(<Probe />);

    expect(getByTestId('flags')).toHaveTextContent(
      JSON.stringify({
        HISTORICAL_PRICE_INTELLIGENCE: true,
        BASKET_OPTIMIZATION: true,
        ADVANCED_FEATURES: true,
        UNIT_PRICE_EUR_PER_GRAM: true,
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws outside the provider — a missing provider is a wiring bug', () => {
    // Silence the expected render error to keep the test output clean.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      expect(() => renderWithoutFlagProvider(<Probe />)).toThrow(
        /FeatureFlagsProvider/,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('passes through arbitrary inlined states unchanged', () => {
    const { getByTestId } = renderWithIntl(<Probe />, {
      featureFlags: {
        flags: {
          HISTORICAL_PRICE_INTELLIGENCE: true,
          BASKET_OPTIMIZATION: false,
          ADVANCED_FEATURES: false,
          UNIT_PRICE_EUR_PER_GRAM: false,
        },
      },
    });

    expect(getByTestId('flags')).toHaveTextContent(
      JSON.stringify({
        HISTORICAL_PRICE_INTELLIGENCE: true,
        BASKET_OPTIMIZATION: false,
        ADVANCED_FEATURES: false,
        UNIT_PRICE_EUR_PER_GRAM: false,
      }),
    );
  });
});
