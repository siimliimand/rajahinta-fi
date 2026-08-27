/**
 * Basket optimization API client.
 *
 * Provides a typed fetch function for POST /api/v1/basket/optimize with
 * error classification for 400/404/422/429 responses that the UI can
 * render distinctly (validation error, product not found, classification
 * gate rejection, rate limiting).
 *
 * @module BasketClient
 */

import { request, ApiFetchError } from './api';
import type {
  BasketOptimizeRequest,
  BasketOptimizationResult,
} from './basket.types';
import type { ApiError } from './types';

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Classified failure modes of {@link optimizeBasket} that UI consumers
 * render distinctly:
 * - `validation`    — 400: invalid basket input (too many items, bad quantity)
 * - `not-found`     — 404: product not found or no retail offers
 * - `gate-rejected` — 422: product rejected by classification gate
 * - `rate-limited`  — 429: rate limit exceeded
 * - `network`       — fetch itself failed (no HTTP response)
 * - `unknown`       — any other error
 */
export type BasketErrorKind =
  | 'validation'
  | 'not-found'
  | 'gate-rejected'
  | 'rate-limited'
  | 'network'
  | 'unknown';

/**
 * Classify an error thrown by {@link optimizeBasket} into a typed kind.
 *
 * Never throws.  Returns the kind and the original error (if it was an
 * {@link ApiFetchError}) so callers can access the server message.
 */
export function classifyBasketError(
  err: unknown,
): { kind: BasketErrorKind; error: ApiFetchError | null } {
  if (err instanceof ApiFetchError) {
    if (err.status === 400) return { kind: 'validation', error: err };
    if (err.status === 404) return { kind: 'not-found', error: err };
    if (err.status === 422) return { kind: 'gate-rejected', error: err };
    if (err.status === 429) return { kind: 'rate-limited', error: err };
    return { kind: 'unknown', error: err };
  }
  return { kind: 'network', error: null };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Optimize a multi-item basket: find the cheapest merchant assignment
 * per item and return per-shipment breakdowns, consolidated transport,
 * alternatives, confidence, and disclaimer.
 *
 * @param input  Basket items, destination, and optional transport/session parameters.
 * @returns The recommended combination with alternatives and metadata.
 * @throws {@link ApiFetchError} on non-2xx status — use
 *         {@link classifyBasketError} to render the right UI treatment.
 */
export async function optimizeBasket(
  input: BasketOptimizeRequest,
): Promise<BasketOptimizationResult> {
  return request<BasketOptimizationResult>('/api/v1/basket/optimize', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Re-export the error class so consumers only import from this module.
export { ApiFetchError };