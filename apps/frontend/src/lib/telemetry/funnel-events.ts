/**
 * Funnel-event dictionary — the exactly four spec-named events, typed as a
 * closed union so a misspelled or extra event cannot compile. Emission is a
 * no-op unless Faro initialized (see faro-init.ts).
 *
 * @module FunnelEvents
 */

import { getFaro } from './faro-init';

export const FUNNEL_EVENTS = [
  'calc_started',
  'calc_result_seen',
  'basket_optimized',
  'alert_set',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export type FunnelEventAttributes = Record<string, string | number | boolean>;

/**
 * Emit one event for one completed flow step. Best-effort; skipDedupe
 * because attribute-free repeats (a second calculation, a second alert)
 * are distinct completions, not duplicates to suppress.
 */
export function emitFunnelEvent(
  event: FunnelEvent,
  attributes?: FunnelEventAttributes,
): void {
  const faro = getFaro();
  if (!faro) return;
  try {
    const meta = Object.fromEntries(
      Object.entries(attributes ?? {}).map(([key, value]) => [key, String(value)]),
    );
    faro.api.pushEvent(event, meta, undefined, { skipDedupe: true });
  } catch {
    // telemetry failures never propagate to the flow
  }
}
