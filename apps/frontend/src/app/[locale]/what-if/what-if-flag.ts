/**
 * What-if simulator flag resolution — `EXCISE_WHAT_IF`.
 *
 * The [locale] layout resolves every flag server-side and inlines the
 * states into the initial HTML payload (design R13), so gated UI is
 * hidden or visible from the first render. The key is not declared in
 * the shared `FeatureFlagsResponse` type (event-calculator-flag.ts
 * precedent): the value is read through a narrow, documented lookup.
 *
 * Absent key counts as OFF: a payload from a backend predating the flag
 * degrades to hidden, the same compliance rule as EVENT_CALCULATOR and
 * TRIP_CALCULATOR.
 *
 * @module WhatIfFlag
 */

import type { FeatureFlagsResponse } from '@/lib/types';

/**
 * Whether the what-if simulator UI may render for this deployment.
 *
 * `=== true` (not truthiness) so only an explicit server-side `true`
 * reveals the feature.
 */
export function isWhatIfFlagEnabled(flags: FeatureFlagsResponse): boolean {
  return (flags.flags as Record<string, boolean | undefined>)
    .EXCISE_WHAT_IF === true;
}
