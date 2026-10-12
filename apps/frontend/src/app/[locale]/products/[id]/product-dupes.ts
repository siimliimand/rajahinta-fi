/**
 * Product dupes wire types — GET /api/v1/products/:id/dupes (task 6.4,
 * change product-roadmap-phases-1-4; API contract committed in task 6.3,
 * api-worker product-dupes.routes.ts).
 *
 * The response mirrors the route's serialization EXACTLY — the complete
 * R9 evidence set per sibling (producer key, manufacturer, source URL,
 * reviewer, reviewed-at) and nothing else. The frontend type is declared
 * here rather than in the shared lib/types because the touch set is the
 * product scope; the route remains the single source of truth.
 *
 * Fetch pattern: since product-page-cold-latency 3.1 the fetch lives in
 * `lib/server-api.ts` (getServerProductDupes) — one server-only module
 * owns all five getServer* reads so they share one transport
 * (API_WORKER service binding first, plain-URL request() fallback) and
 * can never enter a client bundle. The PRODUCT PAGE calls it up front,
 * concurrently with the detail, history, and price-context fetches, and
 * awaits the promise only where the dupe panel renders (the render is
 * bounded by the slowest response, not the sum of four round-trips).
 * Any failure degrades to null so the panel stays absent: 403, 404
 * (cannot happen behind the page's own product check, but harmless),
 * 5xx, unreachable backend. "No curated links" is a 200 with an empty
 * list — an answer, not an error.
 *
 * The dupes endpoint sits outside the age gate's path scope
 * (guards.ts scopes ageGate to GET /api/v1/products and
 * GET /api/v1/products/:id), so no age-confirmation header is sent.
 *
 * @module ProductDupes
 */

/** One evidence-backed sibling — the complete R9 evidence set. */
export interface ProductDupe {
  /** The foreign-shop sibling product the link evidences. */
  readonly siblingProductId: number;
  /** The normalized producer key the exact match ran on. */
  readonly producerKey: string;
  /** The manufacturer behind the link — the WHY. */
  readonly manufacturer: string;
  /** Verifiable source URL for the sibling claim. */
  readonly sourceUrl: string;
  /** Operator who reviewed the link. */
  readonly reviewer: string;
  /** ISO-8601 instant of the recorded review. */
  readonly reviewedAt: string;
}

/** GET /api/v1/products/:id/dupes response. */
export interface ProductDupesResponse {
  readonly dupes: readonly ProductDupe[];
}
