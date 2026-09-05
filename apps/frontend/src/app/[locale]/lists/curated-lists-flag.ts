/**
 * Curated-lists flag resolution — `CURATED_LISTS` (task 7.3, change
 * product-roadmap-phases-1-4; the flag gate itself committed in 7.2's
 * `curated-lists.routes.ts`).
 *
 * The [locale] layout resolves every flag server-side and inlines the
 * states into the initial HTML payload (design R13). The flag key is not
 * declared in the shared `FeatureFlagsResponse` type — this task's touch
 * set is the lists scope and the message catalogs — so the value is read
 * through a narrow, documented lookup instead
 * (product-dupes-flag.ts / event-calculator-flag.ts precedent).
 *
 * Absent key counts as OFF: a payload from a backend predating the flag
 * degrades to the unavailable state, the same compliance rule as
 * OPERATOR_CONSOLE, PRICE_ALERTS, and PRODUCER_DUPE_FINDER.
 *
 * @module CuratedListsFlag
 */

import type { FeatureFlagsResponse } from '@/lib/types';

/**
 * Whether the curated-list pages may render for this deployment.
 *
 * `=== true` (not truthiness) so only an explicit server-side `true`
 * reveals the feature.
 */
export function isCuratedListsFlagEnabled(
  flags: FeatureFlagsResponse,
): boolean {
  return (flags.flags as Record<string, boolean | undefined>)
    .CURATED_LISTS === true;
}
