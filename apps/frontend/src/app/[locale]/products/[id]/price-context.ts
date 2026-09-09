/**
 * Product price-context server fetch — GET
 * /api/v1/products/:id/price-context (insight-surfaces task 3.3; API
 * contract committed in task 3.2, api-worker price-context.routes.ts; the
 * figures themselves are core-domain price-context, design D4/D5).
 *
 * The response mirrors the route's serialization EXACTLY: the current
 * best price (the same lowest-current-offer selection the product page's
 * offers panel derives from, so the context line can never contradict
 * the panel) plus the context object on one of two branches —
 * `computed` with the window figures, or `unavailable` with reason
 * INSUFFICIENT_HISTORY. Both branches carry windowDays, bucketCount, and
 * asOf. The frontend type is declared here rather than in the shared
 * lib/types because the touch set is the product scope; the route
 * remains the single source of truth.
 *
 * Fetch pattern: the product page loads its data server-side
 * (getServerProductDetail), so the context call does the same — a
 * server-side fetch alongside the existing data, resolved before HTML.
 * Any failure degrades to null so the context line stays absent: 403,
 * 404 (the route answers 404 when the product or its current offers are
 * gone), 5xx, unreachable backend, unexpected shape.
 *
 * The endpoint sits behind the age gate, so the request carries the
 * same fixed first-party SSR token lib/api.ts uses for the catalog
 * reads; the constant is declared locally because lib/api.ts keeps it
 * module-private and this task's touch set excludes lib/.
 *
 * @module ProductPriceContext
 */

import { request } from '@/lib/api';

/** Same fixed first-party SSR token as lib/api.ts (see module docblock). */
const SERVER_AGE_CONFIRMATION_TOKEN = 'server-prerender';

/** Successful context: value present, window shape attached. */
export interface ProductPriceContextValue {
  readonly status: 'computed';
  readonly medianCents: number;
  readonly minCents: number;
  readonly maxCents: number;
  /** Current best price − window median, in euro cents. */
  readonly deltaVsMedianCents: number;
  readonly deltaVsMedianBasisPoints: number;
  readonly windowDays: number;
  readonly bucketCount: number;
  readonly asOf: string;
}

/** Context could not be produced: explicitly no value, with a reason. */
export interface ProductPriceContextUnavailable {
  readonly status: 'unavailable';
  readonly reason: 'INSUFFICIENT_HISTORY';
  readonly windowDays: number;
  readonly bucketCount: number;
  readonly asOf: string;
}

export type ProductPriceContext =
  | ProductPriceContextValue
  | ProductPriceContextUnavailable;

/** GET /api/v1/products/:id/price-context response. */
export interface ProductPriceContextResponse {
  readonly productId: number;
  readonly currentBestPriceCents: number;
  readonly context: ProductPriceContext;
}

/** Structural guard on the context payload — an unexpected shape degrades. */
function isPriceContextResponse(value: unknown): value is ProductPriceContextResponse {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (
    typeof body.productId !== 'number' ||
    typeof body.currentBestPriceCents !== 'number' ||
    typeof body.context !== 'object' ||
    body.context === null
  ) {
    return false;
  }
  const context = body.context as Record<string, unknown>;
  const commonShape =
    typeof context.windowDays === 'number' &&
    typeof context.bucketCount === 'number' &&
    typeof context.asOf === 'string';
  if (!commonShape) return false;
  if (context.status === 'computed') {
    return (
      typeof context.medianCents === 'number' &&
      typeof context.minCents === 'number' &&
      typeof context.maxCents === 'number' &&
      typeof context.deltaVsMedianCents === 'number' &&
      typeof context.deltaVsMedianBasisPoints === 'number'
    );
  }
  if (context.status === 'unavailable') {
    return (
      context.reason === 'INSUFFICIENT_HISTORY' &&
      context.medianCents === null &&
      context.deltaVsMedianCents === null
    );
  }
  return false;
}

/**
 * Fetch a product's price context on the server, or null when
 * unavailable (backend unreachable, no current offers, unexpected
 * shape) so the page degrades to an absent line instead of erroring.
 */
export async function getServerProductPriceContext(
  id: number,
): Promise<ProductPriceContextResponse | null> {
  try {
    const payload = await request<ProductPriceContextResponse>(
      `/api/v1/products/${id}/price-context`,
      {
        headers: { 'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN },
        next: { revalidate: 900 },
      },
    );
    return isPriceContextResponse(payload) ? payload : null;
  } catch {
    return null;
  }
}
