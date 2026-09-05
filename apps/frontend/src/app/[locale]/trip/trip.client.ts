/**
 * Trip feasibility API client — POST /api/v1/trip-feasibility.
 *
 * Typed fetch plus error classification for the states the UI renders
 * distinctly, following the {@link classifyEventCalcError} precedent.
 * The endpoint sits behind the `TRIP_CALCULATOR` gate, so a flag flipped
 * off server-side mid-session reaches the client as 403 and must degrade
 * to a friendly "not available" message, never a crash (design R13).
 * 409 (`NoPublishedAllowances`) is classified explicitly too: it is an
 * expected data state — no published allowance dataset covers the travel
 * date — and renders as a calm empty state, not a red error.
 *
 * @module TripClient
 */

import { request, ApiFetchError } from '@/lib/api';
import type { TripFeasibilityRequest, TripFeasibilityResponse } from './trip.types';

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Classified failure modes of {@link calculateTripFeasibility}:
 * - `validation`     — 400: out-of-cap passengers/costs or malformed input
 * - `forbidden`      — 403: TRIP_CALCULATOR flag off server-side
 * - `no-allowances`  — 409: no published allowance dataset for the date
 * - `rate-limited`   — 429: CALCULATOR limiter tripped
 * - `network`        — fetch itself failed (no HTTP response)
 * - `unknown`        — any other error
 */
export type TripCalcErrorKind =
  | 'validation'
  | 'forbidden'
  | 'no-allowances'
  | 'rate-limited'
  | 'network'
  | 'unknown';

/**
 * Classify an error thrown by {@link calculateTripFeasibility} into a
 * typed kind. Never throws.
 */
export function classifyTripCalcError(err: unknown): {
  kind: TripCalcErrorKind;
  error: ApiFetchError | null;
} {
  if (err instanceof ApiFetchError) {
    if (err.status === 400) return { kind: 'validation', error: err };
    if (err.status === 403) return { kind: 'forbidden', error: err };
    if (err.status === 409) return { kind: 'no-allowances', error: err };
    if (err.status === 429) return { kind: 'rate-limited', error: err };
    return { kind: 'unknown', error: err };
  }
  return { kind: 'network', error: null };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Compute the trip break-even volumes with allowance capping. The 200
 * body always carries the separate `ferryOffers` block (possibly empty).
 *
 * @throws {@link ApiFetchError} on non-2xx — use
 *         {@link classifyTripCalcError} to render the right treatment.
 */
export async function calculateTripFeasibility(
  input: TripFeasibilityRequest,
): Promise<TripFeasibilityResponse> {
  return request<TripFeasibilityResponse>('/api/v1/trip-feasibility', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
