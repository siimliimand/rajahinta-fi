/**
 * Trip-calculator flag resolution — `TRIP_CALCULATOR`.
 *
 * The [locale] layout resolves every flag server-side and inlines the
 * states into the initial HTML payload (design R13), so gated UI is
 * hidden or visible from the first render. The key is not declared in
 * the shared `FeatureFlagsResponse` type (event-calculator-flag.ts
 * precedent): the value is read through a narrow, documented lookup.
 *
 * Absent key counts as OFF: a payload from a backend predating the flag
 * degrades to hidden, the same compliance rule as EVENT_CALCULATOR and
 * OPERATOR_CONSOLE.
 *
 * @module TripCalculatorFlag
 */

import type { FeatureFlagsResponse } from '@/lib/types';

/**
 * Whether the trip feasibility calculator UI may render for this
 * deployment.
 *
 * `=== true` (not truthiness) so only an explicit server-side `true`
 * reveals the feature.
 */
export function isTripCalculatorFlagEnabled(
  flags: FeatureFlagsResponse,
): boolean {
  return (flags.flags as Record<string, boolean | undefined>)
    .TRIP_CALCULATOR === true;
}
