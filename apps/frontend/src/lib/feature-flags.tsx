'use client';

/**
 * Feature-flag context (task 9.4).
 *
 * Flag states are resolved on the server and inlined into the page payload
 * by the [locale] layout, so gated UI renders with the first paint at the
 * correct visibility — no late appearance after a client-side flag fetch.
 *
 * Consumers read {@link useFeatureFlags} synchronously during render. A
 * server-side fetch failure inlines the all-off default, the same
 * "degrade to hidden" contract the old client-side lookup used.
 *
 * @module feature-flags
 */

import React, { createContext, useContext } from 'react';
import type { FeatureFlagsResponse } from './types';

const FeatureFlagsContext = createContext<FeatureFlagsResponse | null>(null);

export function FeatureFlagsProvider({
  flags,
  children,
}: {
  readonly flags: FeatureFlagsResponse;
  readonly children: React.ReactNode;
}) {
  return (
    <FeatureFlagsContext.Provider value={flags}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

/**
 * The flag states inlined with this page's initial HTML. Throws when used
 * outside the provider — the layout is the only flag source, so a missing
 * provider is a wiring bug, not a runtime condition to silently absorb.
 */
export function useFeatureFlags(): FeatureFlagsResponse {
  const flags = useContext(FeatureFlagsContext);
  if (flags === null) {
    throw new Error(
      'useFeatureFlags requires <FeatureFlagsProvider>; the [locale] layout provides it with server-resolved flag states.',
    );
  }
  return flags;
}
