/**
 * Server-side API readers (RSC / route handlers only) — the single home
 * of every `getServer*` fetch helper (product-page-cold-latency 3.1).
 *
 * ⚠️ SERVER ONLY: this module imports `@opennextjs/cloudflare`, which must
 * never enter a client bundle. The `server-only` package is not installed
 * in this workspace, so module placement IS the guard — import this file
 * only from server components, route handlers, the sitemap, and tests.
 * (`lib/api.ts` deliberately does NOT re-export anything from here: a
 * static re-export would pull this module into every client bundle that
 * imports `api.ts`.)
 *
 * Connection strategy — binding first, URL fallback (amends the 5.2
 * same-zone-routing-only decision):
 *
 * 1. `serverRequest` probes `getCloudflareContext().env.API_WORKER`
 *    (guarded in try/catch — the call throws outside a worker runtime).
 *    With the binding, the request goes worker-to-worker and never
 *    leaves the Cloudflare network: same headers `request()` would send
 *    (JSON content type, caller headers, trace context + UUID
 *    `x-request-id`; the age gate rides the explicit
 *    `x-age-confirmed` header, never a cookie — all binding reads are
 *    public catalog data), and non-2xx answers translate through the
 *    SAME {@link ApiFetchError} contract as `request()`, including the
 *    `requestId` echo. Binding presence is environment detection, not a
 *    feature flag (flag system removed 2026-09-07).
 * 2. Without a worker context or binding (next dev without the adapter's
 *    proxy, `next build`, vitest), `serverRequest` delegates to
 *    `request()` — the exact pre-3.1 behavior: plain URL base from
 *    `NEXT_PUBLIC_API_URL` (`resolveApiBaseUrl`), cookies where the
 *    caller opts in, identical errors. The fetch-option
 *    `next: { revalidate }` keeps flowing on this path.
 *
 * Caching note: a binding fetch is NOT Next's patched global fetch, so
 * the fetch data cache (`next: { revalidate }`) does not apply on the
 * binding path — the option is still passed and still governs the URL
 * fallback. Page-level ISR (product-page-cold-latency 1.1:
 * `revalidate = 300` on the product route, R2 incremental cache) now
 * bounds how often these reads re-render at all, so the per-fetch
 * revalidation window matters only in URL-fallback runtimes. Accepted
 * and recorded in the change proposal.
 *
 * @module ServerApiClient
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';
import type {
  ProductSearchResult,
  ProductSearchItem,
  ProductDetailResponse,
  PriceHistoryResponse,
} from './types';
import {
  request,
  buildHeaders,
  withTraceHeaders,
  translateResponse,
  SERVER_AGE_CONFIRMATION_TOKEN,
} from './api';
import type { ProductPriceContextResponse } from '@/app/[locale]/products/[id]/price-context';
import type { ProductDupesResponse } from '@/app/[locale]/products/[id]/product-dupes';

// ---------------------------------------------------------------------------
// serverRequest — the one outbound path for the server-side readers
// ---------------------------------------------------------------------------

/**
 * Route base for binding-path requests. Purely internal (Workers service
 * bindings route by binding, not by URL); a fixed placeholder keeps
 * `new URL(path, base)` well-formed for the route paths, which are
 * root-relative.
 */
const BINDING_ROUTE_BASE = 'https://api.internal';

/**
 * Perform one server-side API exchange: through the `API_WORKER` service
 * binding when the worker context provides it, otherwise through
 * {@link request}'s plain-URL path. Error contract is identical on both
 * paths: non-2xx throws {@link ApiFetchError} with the echoed
 * `x-request-id`; transport failures throw raw (the getServer* helpers
 * degrade to null).
 */
export async function serverRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const apiWorker = getCloudflareContext().env.API_WORKER;
    if (apiWorker) {
      // Same headers request() would send (buildHeaders + trace context).
      // `next` is a Next fetch-option, not a RequestInit member — strip it
      // before constructing the Request; it only applies to the patched
      // global fetch on the URL-fallback path.
      const requestInit: RequestInit & { next?: unknown } = {
        ...init,
        headers: withTraceHeaders(buildHeaders(path, init)),
      };
      delete requestInit.next;
      const res = await apiWorker.fetch(
        new Request(new URL(path, BINDING_ROUTE_BASE), requestInit),
      );
      // A 503 from the binding in a non-production runtime is the dev
      // platform proxy answering for a service that has no local Worker
      // behind it (the e2e/dev stacks run the legacy/local backend on the
      // URL path instead). It means "binding unusable", so fall through to
      // the plain-URL request rather than failing the read. Production has
      // the real API Worker behind the binding and keeps 503 propagation.
      const unusableDevBinding =
        res.status === 503 && process.env.NODE_ENV !== 'production';
      if (!unusableDevBinding) {
        return translateResponse<T>(res);
      }
    }
  } catch {
    // No Cloudflare context in this runtime (next dev / next build /
    // vitest) — fall through to the plain-URL request below.
  }
  return request<T>(path, init);
}

// ---------------------------------------------------------------------------
// Product detail + listing (catalog reads behind the age gate)
// ---------------------------------------------------------------------------

/**
 * Fetch a product with its offers on the server, or null when unavailable
 * (unknown id, launch gates closed, backend unreachable) so callers can
 * degrade to generic metadata instead of erroring the page.
 */
export async function getServerProductDetail(
  id: number,
): Promise<ProductDetailResponse | null> {
  try {
    return await serverRequest<ProductDetailResponse>(`/api/v1/products/${id}`, {
      headers: { 'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN },
      next: { revalidate: 900 },
    });
  } catch {
    return null;
  }
}

/**
 * List products on the server for the sitemap. The listing endpoint caps
 * at 100 rows; a failure degrades to an empty list (static routes only).
 */
export async function getServerProductListing(): Promise<ProductSearchItem[]> {
  try {
    const res = await serverRequest<ProductSearchResult>(
      '/api/v1/products?sort=ALPHABETICAL&page=1&limit=100',
      {
        headers: { 'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN },
        next: { revalidate: 900 },
      },
    );
    return res.items;
  } catch {
    return [];
  }
}

/**
 * One enumerated catalog row — the product id and its truthful `lastmod`
 * (`MAX(product_master.updated_at, latest retail_offers.observed_at)`,
 * ISO string — task 1.1, change sitemap-tree-coverage).
 */
export interface ProductIdEntry {
  readonly id: number;
  readonly lastmod: string;
}

/** One `/api/v1/products/ids` page — an id-ordered slice plus the total it slices. */
export interface ProductIdPage {
  readonly items: ProductIdEntry[];
  readonly total: number;
}

/**
 * Enumerate product ids for the sitemap tree (GET /api/v1/products/ids,
 * sitemap-tree-coverage tasks 1.1/2.1): id-ordered `offset`/`limit`
 * slices, `limit` clamped at the endpoint's 5,000 chunk cap, each row
 * carrying the product's truthful `lastmod`. Degradation contract: a
 * failed or unreadable read returns null — deliberately distinct from a
 * legitimately empty slice (an `offset` past `total`), which returns an
 * empty items array; the sitemap-tree caller decides how a null page
 * bounds the enumeration.
 */
export async function getServerProductIds(
  offset: number,
  limit: number,
): Promise<ProductIdPage | null> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  try {
    return await serverRequest<ProductIdPage>(`/api/v1/products/ids?${params}`, {
      headers: { 'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN },
      next: { revalidate: 900 },
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Price history (task 5.1)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** The widest window the price-history endpoint accepts (365 days). */
const HISTORY_RANGE_DAYS = 365;

/** Format a Date as an ISO date 'YYYY-MM-DD' (UTC). */
function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Server-side price-history read (task 5.1): the endpoint is age-gated,
 * so the server presents the fixed first-party prerender token — the
 * getServerProductDetail precedent, rather than the shared getPriceHistory
 * client, which is the browser-side helper (cookie-based confirmation, no
 * revalidate). Any failure or unexpected shape degrades to null and the
 * page renders without the section.
 *
 * attribution=none (price-history-latency 3.1): the page never renders
 * attribution markers, so the request opts out of the endpoint's
 * attribution pass — the endpoint answers attribution: [] and performs
 * zero raw-log reads, instead of the auto default's R2 partition scan.
 */
export async function getServerPriceHistory(
  productId: number,
): Promise<PriceHistoryResponse | null> {
  const todayMs = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const params = new URLSearchParams({
    metric: 'price',
    granularity: 'day',
    from: toIsoDate(todayMs - (HISTORY_RANGE_DAYS - 1) * DAY_MS),
    to: toIsoDate(todayMs),
    // Opt out of the attribution pass — see the docblock above.
    attribution: 'none',
  });
  try {
    const body = await serverRequest<PriceHistoryResponse | null>(
      `/api/v1/products/${productId}/price-history?${params}`,
      {
        headers: { 'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN },
        next: { revalidate: 900 },
      },
    );
    if (
      body === null ||
      typeof body !== 'object' ||
      !Array.isArray(body.series) ||
      typeof body.to !== 'string'
    ) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Price context (insight-surfaces 3.3)
// ---------------------------------------------------------------------------

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
      typeof context.deltaVsMedianBasisPoints === 'number' &&
      typeof context.percentileRankBasisPoints === 'number' &&
      typeof context.isWindowLow === 'boolean'
    );
  }
  if (context.status === 'unavailable') {
    return (
      context.reason === 'INSUFFICIENT_HISTORY' &&
      context.medianCents === null &&
      context.deltaVsMedianCents === null &&
      context.percentileRankBasisPoints === null &&
      context.isWindowLow === null
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
    const payload = await serverRequest<ProductPriceContextResponse>(
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

// ---------------------------------------------------------------------------
// Producer dupes (task 6.4) — outside the age gate's path scope, no
// age-confirmation header (see product-dupes.ts).
// ---------------------------------------------------------------------------

/**
 * Fetch a product's curated sibling links on the server, or null when
 * unavailable (backend unreachable) so the page degrades to an absent
 * panel instead of erroring.
 */
export async function getServerProductDupes(
  id: number,
): Promise<ProductDupesResponse | null> {
  try {
    return await serverRequest<ProductDupesResponse>(
      `/api/v1/products/${id}/dupes`,
      { next: { revalidate: 900 } },
    );
  } catch {
    return null;
  }
}
