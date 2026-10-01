/**
 * Trip feasibility API client — POST /api/v1/trip-feasibility.
 *
 * Typed fetch plus error classification for the states the UI renders
 * distinctly, following the {@link classifyEventCalcError} precedent.
 * A server-side 403 reaches the client as `forbidden` and must degrade
 * to a friendly "not available" message, never a crash (design R13).
 * 409 (`NoPublishedAllowances`) is classified explicitly too: it is an
 * expected data state — no published allowance dataset covers the travel
 * date — and renders as a calm empty state, not a red error.
 *
 * @module TripClient
 */

import { request, ApiFetchError } from '@/lib/api';
import type {
  TripFeasibilityRequest,
  TripFeasibilityResponse,
  TripFillRequest,
  TripFillResponse,
} from './trip.types';

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Classified failure modes of {@link calculateTripFeasibility} and
 * {@link fillTripAllowance}:
 * - `validation`      — 400: out-of-cap passengers/costs or malformed input
 * - `unauthenticated` — 401: the fill surface requires a signed-in user
 * - `forbidden`       — 403: the backend rejected the calculation
 * - `no-allowances`   — 409: no published allowance dataset for the date
 * - `rate-limited`    — 429: CALCULATOR limiter tripped
 * - `network`         — fetch itself failed (no HTTP response)
 * - `unknown`         — any other error
 */
export type TripCalcErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'no-allowances'
  | 'rate-limited'
  | 'network'
  | 'unknown';

/**
 * Classify an error thrown by a trip calculation client into a typed
 * kind. Never throws.
 */
export function classifyTripCalcError(err: unknown): {
  kind: TripCalcErrorKind;
  error: ApiFetchError | null;
} {
  if (err instanceof ApiFetchError) {
    if (err.status === 400) return { kind: 'validation', error: err };
    if (err.status === 401) return { kind: 'unauthenticated', error: err };
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

// ---------------------------------------------------------------------------
// Allowance fill (task 8.3)
// ---------------------------------------------------------------------------

/**
 * Run the allowance fill (POST /api/v1/trip/fill): a value-maximal
 * basket under the traveller allowance effective on the travel date.
 * The 200 body always carries the separate `ferryOffers` block
 * (possibly empty).
 *
 * Requires a signed-in session (sessionAuth on the route) — an
 * anonymous caller gets a 401; classify it with
 * {@link classifyTripCalcError}.
 *
 * @throws {@link ApiFetchError} on non-2xx.
 */
export async function fillTripAllowance(
  input: TripFillRequest,
): Promise<TripFillResponse> {
  return request<TripFillResponse>('/api/v1/trip/fill', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Trip-fill prefill handshake (task 2.2, change
// finnish-first-client-experience)
// ---------------------------------------------------------------------------

/** A parsed, validated `?product=&quantity=` seed for the fill form. */
export interface TripPrefill {
  readonly productId: number;
  readonly quantity: number;
}

/**
 * Quantity window of the handshake — the fill form's own per-line bound
 * (MIN/MAX_FILL_QUANTITY in TripFillForm). A seed outside it is not
 * clamped to a fabricated figure; it falls back to the form's default
 * bound of 1 and the customer edits from there.
 */
export const TRIP_PREFILL_MIN_QUANTITY = 1;
export const TRIP_PREFILL_MAX_QUANTITY = 99;

/**
 * Parse the calculator callout's `?product=&quantity=` handshake values.
 *
 * Contract (task 2.2): a valid positive-integer `product` is required for
 * ANY prefill — an absent, blank, or malformed product yields null and
 * the page behaves exactly as before the handshake existed. The
 * `quantity` is applied only when it parses as a whole number within the
 * fill form's window; absent and out-of-window values fall back to 1
 * (the bound a manual selection starts from — no cap is invented here).
 *
 * Pure so the validation is unit-testable; the view consumes the result
 * on mount.
 */
export function parseTripPrefillParams(
  product: string | null,
  quantity: string | null,
): TripPrefill | null {
  const rawProduct = (product ?? '').trim();
  if (!/^\d+$/.test(rawProduct)) return null;
  const productId = Number.parseInt(rawProduct, 10);
  if (!Number.isFinite(productId) || productId <= 0) return null;

  const rawQuantity = (quantity ?? '').trim();
  const parsedQuantity = /^\d+$/.test(rawQuantity)
    ? Number.parseInt(rawQuantity, 10)
    : Number.NaN;
  const withinWindow =
    Number.isFinite(parsedQuantity) &&
    parsedQuantity >= TRIP_PREFILL_MIN_QUANTITY &&
    parsedQuantity <= TRIP_PREFILL_MAX_QUANTITY;

  return {
    productId,
    quantity: withinWindow ? parsedQuantity : TRIP_PREFILL_MIN_QUANTITY,
  };
}

// ---------------------------------------------------------------------------
// Category price benchmarks (task 3.2, change client-experience-improvement)
// ---------------------------------------------------------------------------

/** One segment figure of the category-averages benchmark. */
export interface CategoryBenchmarkFigures {
  readonly averageCentsPerLitre: number;
  readonly offerCount: number;
  readonly productCount: number;
  readonly asOf: string;
  readonly reliabilityStatus: string;
}

/** One category's benchmark row — a segment without coverage is null. */
export interface CategoryBenchmarkRow {
  readonly category: string;
  readonly alko: CategoryBenchmarkFigures | null;
  readonly crossBorder: CategoryBenchmarkFigures | null;
}

/**
 * Fetch the per-category average €/l benchmarks
 * (GET /api/v1/benchmarks/category-averages). PRE-FILL DISPLAY ONLY:
 * the figures ever serve as ordinary editable form defaults — they never
 * enter a calculation on their own (spec price-benchmarks: benchmarks
 * are display-only).
 *
 * @throws {@link ApiFetchError} on non-2xx.
 */
export async function fetchCategoryAverages(): Promise<CategoryBenchmarkRow[]> {
  const body = await request<{ categories: CategoryBenchmarkRow[] }>(
    '/api/v1/benchmarks/category-averages',
  );
  return body.categories;
}
