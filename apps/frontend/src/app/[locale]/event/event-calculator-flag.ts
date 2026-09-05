/**
 * Event-calculator flag resolution — `enable_event_calculator`.
 *
 * The [locale] layout resolves every flag server-side and inlines the
 * states into the initial HTML payload (design R13), so gated UI is
 * hidden or visible from the first render. The flag key is not declared
 * in the shared `FeatureFlagsResponse` type — task 4.4's touch set is the
 * event scope, the header, and the message catalogs — so the value is
 * read through a narrow, documented lookup instead.
 *
 * Absent key counts as OFF: a payload from a backend predating the flag
 * degrades to hidden, the same compliance rule as OPERATOR_CONSOLE and
 * PRICE_ALERTS.
 *
 * @module EventCalculatorFlag
 */

import type { FeatureFlagsResponse } from '@/lib/types';

/**
 * Whether the event calculator UI may render for this deployment.
 *
 * `=== true` (not truthiness) so only an explicit server-side `true`
 * reveals the feature.
 */
export function isEventCalculatorFlagEnabled(
  flags: FeatureFlagsResponse,
): boolean {
  return (flags.flags as Record<string, boolean | undefined>)
    .EVENT_CALCULATOR === true;
}

/**
 * Whether the packing-recommendations opt-in may be offered (task 4.5
 * reuses the R4 packing module; the section is per-feature gated like
 * the basket's, design R13). Same absent-key-counts-OFF rule as above.
 */
export function isPackingOptimizerFlagEnabled(
  flags: FeatureFlagsResponse,
): boolean {
  return (flags.flags as Record<string, boolean | undefined>)
    .PACKING_OPTIMIZER === true;
}
