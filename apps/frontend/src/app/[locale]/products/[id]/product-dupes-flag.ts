/**
 * Producer-dupe-finder flag resolution — `PRODUCER_DUPE_FINDER`.
 *
 * The [locale] layout resolves every flag server-side and inlines the
 * states into the initial HTML payload (design R13). The flag key is not
 * declared in the shared `FeatureFlagsResponse` type — this task's touch
 * set is the product scope and the message catalogs — so the value is
 * read through a narrow, documented lookup instead
 * (event-calculator-flag.ts precedent).
 *
 * Absent key counts as OFF: a payload from a backend predating the flag
 * degrades to hidden, the same compliance rule as OPERATOR_CONSOLE,
 * PRICE_ALERTS, and EVENT_CALCULATOR.
 *
 * @module ProductDupesFlag
 */

import type { FeatureFlagsResponse } from '@/lib/types';

/**
 * Whether the product-page dupe panel may render for this deployment.
 *
 * `=== true` (not truthiness) so only an explicit server-side `true`
 * reveals the feature.
 */
export function isProducerDupeFinderFlagEnabled(
  flags: FeatureFlagsResponse,
): boolean {
  return (flags.flags as Record<string, boolean | undefined>)
    .PRODUCER_DUPE_FINDER === true;
}
