/**
 * API client for the rajahinta.fi backend.
 *
 * All fetch calls go through this module so the base URL and headers
 * are configured in one place.  Every function returns typed responses
 * or throws an {@link ApiFetchError} on non-2xx status.
 *
 * @module ApiClient
 */

import type {
  ProductSearchResult,
  ProductDetailResponse,
  CalculateRequest,
  CalculatorResult,
  SortOrder,
  RankingMethodology,
  ApiError,
} from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Base URL for the rajahinta.fi API.
 *
 * NEXT_PUBLIC_API_URL can be set at build-time; defaults to the dev server
 * running on port 3000 (the NestJS backend default).
 */
const BASE_URL: string =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when an API call returns a non-2xx status.
 * Carries the parsed {@link ApiError} body when available.
 */
export class ApiFetchError extends Error {
  readonly status: number;
  readonly body: ApiError | null;

  constructor(status: number, body: ApiError | null) {
    super(body?.message ?? `API returned ${status}`);
    this.name = 'ApiFetchError';
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read a browser cookie by name. Returns the value or undefined.
 */
function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : undefined;
}

/**
 * Set a browser cookie with the given name, value, and attributes.
 */
function setCookie(
  name: string,
  value: string,
  attributes: string = 'path=/; max-age=31536000; SameSite=Lax',
): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; ${attributes}`;
}

const SESSION_COOKIE = 'session_id';
const ACCOUNT_SCOPE_PREFIXES = ['/api/v1/account/', '/api/v1/analytics/'];

/**
 * Get or create the anonymous session identifier.
 *
 * Reads the `session_id` cookie; if absent, generates a UUID v4, persists it
 * as a cookie (1-year expiry, SameSite=Lax), and returns the value.
 */
function getSessionId(): string {
  const existing = getCookie(SESSION_COOKIE);
  if (existing) return existing;

  const id = crypto.randomUUID();
  setCookie(SESSION_COOKIE, id);
  return id;
}

/**
 * Returns the current anonymous session user ID.
 *
 * Exported so components can read the stable identifier without calling the
 * API.  The value matches the `x-user-id` header sent on account-scoped
 * requests.
 */
export function getSessionUserId(): string {
  return getSessionId();
}

export async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${path}`;

  // Merge default Content-Type with caller-provided headers and
  // inject the age-confirmation header when the cookie is present.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...Object.fromEntries(
      Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    ),
  };
  const ageToken = getCookie('age_confirmed');
  if (ageToken) {
    headers['x-age-confirmed'] = ageToken;
  }

  // Inject anonymous session ID on account-scoped requests.
  if (ACCOUNT_SCOPE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    headers['x-user-id'] = getSessionId();
  }

  const res = await fetch(url, {
    ...init,
    headers,
  });

  if (!res.ok) {
    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      // ignore parse failure
    }
    throw new ApiFetchError(res.status, body);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * Search products by free-text query.
 *
 * @param q     Search term
 * @param sort  Sort order (default: ALPHABETICAL)
 * @param page  Page number (1-indexed, default: 1)
 * @param limit Results per page (default: 20, max: 100)
 */
export async function searchProducts(
  q: string,
  sort: string = 'ALPHABETICAL',
  page: number = 1,
  limit: number = 20,
): Promise<ProductSearchResult> {
  const params = new URLSearchParams({ q, sort, page: String(page), limit: String(limit) });
  return request<ProductSearchResult>(`/api/v1/products?${params}`);
}

/**
 * Fetch products by comma-separated IDs.
 *
 * @param ids   Array of product IDs
 * @param sort  Sort order (default: ALPHABETICAL)
 */
export async function fetchProductsByIds(
  ids: number[],
  sort: SortOrder = 'ALPHABETICAL',
): Promise<ProductSearchResult> {
  const params = new URLSearchParams({
    ids: ids.join(','),
    sort,
    page: '1',
    limit: String(ids.length),
  });
  return request<ProductSearchResult>(`/api/v1/products?${params}`);
}

/**
 * Fetch a single product with its retail offers.
 */
export async function getProductDetail(
  id: number,
): Promise<ProductDetailResponse> {
  return request<ProductDetailResponse>(`/api/v1/products/${id}`);
}

// ---------------------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------------------

/**
 * Run a landed-cost calculation.
 */
export async function calculateLandedCost(
  input: CalculateRequest,
): Promise<CalculatorResult> {
  return request<CalculatorResult>('/api/v1/calculator', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Retrieve a previous calculation result.
 */
export async function getCalculationResult(
  recordId: number,
): Promise<CalculatorResult> {
  return request<CalculatorResult>(`/api/v1/calculator/result/${recordId}`);
}

// ---------------------------------------------------------------------------
// Ranking methodology
// ---------------------------------------------------------------------------

/**
 * Fetch the ranking methodology description from the API.
 *
 * Falls back to null when the endpoint is not available (Phase 1).
 * The ranking page uses embedded methodology text as a fallback.
 */
export async function getRankingMethodology(): Promise<RankingMethodology | null> {
  try {
    return await request<RankingMethodology>('/api/v1/ranking/methodology');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * Record a merchant-link click for basic click-through analytics.
 *
 * Sends the merchant identifier and the destination URL to the backend.
 * The backend rejects any payload containing affiliate, commission, or
 * purchase-tracking fields (Phase 1 policy).
 *
 * @param merchantId  Merchant identifier (e.g. merchant name or slug)
 * @param url         The destination URL of the clicked link
 */
export async function logClick(merchantId: string, url: string): Promise<void> {
  await request<{ success: boolean; count: number }>('/api/v1/analytics/click', {
    method: 'POST',
    body: JSON.stringify({ merchantId, url }),
  });
}