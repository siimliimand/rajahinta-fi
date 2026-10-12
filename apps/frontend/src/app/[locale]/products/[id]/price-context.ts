/**
 * Product price-context wire types — GET
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
 * Fetch pattern: since product-page-cold-latency 3.1 the fetch and its
 * shape guard live in `lib/server-api.ts`
 * (getServerProductPriceContext) — one server-only module owns all five
 * getServer* reads so they share one transport (API_WORKER service
 * binding first, plain-URL request() fallback) and can never enter a
 * client bundle. The PRODUCT PAGE calls it up front, concurrently with
 * the detail, history, and dupes fetches, and awaits the promise only
 * where the context line renders (the render is bounded by the slowest
 * response, not the sum of four round-trips). Any failure degrades to
 * null so the context line stays absent: 403,
 * 404 (the route answers 404 when the product or its current offers are
 * gone), 5xx, unreachable backend, unexpected shape.
 *
 * @module ProductPriceContext
 */

/** Successful context: value present, window shape attached. */
export interface ProductPriceContextValue {
  readonly status: 'computed';
  readonly medianCents: number;
  readonly minCents: number;
  readonly maxCents: number;
  /** Current best price − window median, in euro cents. */
  readonly deltaVsMedianCents: number;
  readonly deltaVsMedianBasisPoints: number;
  /**
   * Share of the window's daily buckets STRICTLY above the current best
   * price, in basis points (1/10000) — task 2.2. Ties do not count.
   */
  readonly percentileRankBasisPoints: number;
  /** True iff the current best price equals the window minimum — task 2.2. */
  readonly isWindowLow: boolean;
  readonly windowDays: number;
  readonly bucketCount: number;
  readonly asOf: string;
}

/** Context could not be produced: explicitly no value, with a reason. */
export interface ProductPriceContextUnavailable {
  readonly status: 'unavailable';
  readonly reason: 'INSUFFICIENT_HISTORY';
  readonly percentileRankBasisPoints: null;
  readonly isWindowLow: null;
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
