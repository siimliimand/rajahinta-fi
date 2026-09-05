/**
 * Event calculator API client — POST /api/v1/event-calc.
 *
 * Provides a typed fetch function plus error classification for the states
 * the UI renders distinctly, following the {@link BasketClient} precedent.
 * The 403 case is classified explicitly: the endpoint sits behind the
 * `enable_event_calculator` gate, so a flag flipped off server-side
 * mid-session reaches the client as 403 and must degrade to a friendly
 * "not available" message, never a crash (design R13).
 *
 * @module EventClient
 */

import { request, ApiFetchError } from '@/lib/api';
import type { EventCalcRequest, EventCalcResponse } from './event.types';

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Classified failure modes of {@link calculateEventPlan}:
 * - `validation`   — 400: out-of-cap guests/duration or malformed input
 * - `forbidden`    — 403: event-calculator flag off server-side
 * - `rate-limited` — 429: CALCULATOR limiter tripped
 * - `network`      — fetch itself failed (no HTTP response)
 * - `unknown`      — any other error
 */
export type EventCalcErrorKind =
  | 'validation'
  | 'forbidden'
  | 'rate-limited'
  | 'network'
  | 'unknown';

/**
 * Classify an error thrown by {@link calculateEventPlan} into a typed kind.
 *
 * Never throws. Returns the kind and the original error (when it was an
 * {@link ApiFetchError}) so callers can reach the server message.
 */
export function classifyEventCalcError(err: unknown): {
  kind: EventCalcErrorKind;
  error: ApiFetchError | null;
} {
  if (err instanceof ApiFetchError) {
    if (err.status === 400) return { kind: 'validation', error: err };
    if (err.status === 403) return { kind: 'forbidden', error: err };
    if (err.status === 429) return { kind: 'rate-limited', error: err };
    return { kind: 'unknown', error: err };
  }
  return { kind: 'network', error: null };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Compute the minimal-surplus shopping list for an event.
 *
 * NO_PUBLISHED_NORMS arrives as a normal 200 result value — the caller
 * inspects `status` rather than catching.
 *
 * @throws {@link ApiFetchError} on non-2xx — use
 *         {@link classifyEventCalcError} to render the right treatment.
 */
export async function calculateEventPlan(
  input: EventCalcRequest,
): Promise<EventCalcResponse> {
  return request<EventCalcResponse>('/api/v1/event-calc', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
