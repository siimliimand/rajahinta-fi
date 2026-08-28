/**
 * API client for the rajahinta.fi backend.
 *
 * All fetch calls go through this module so the base URL, credentials, and
 * headers are configured in one place.  Every function returns typed
 * responses or throws an {@link ApiFetchError} on non-2xx status.
 *
 * Authentication is exclusively the server-issued httpOnly
 * `rajahinta_session` cookie; the client keeps no identity of its own.
 *
 * @module ApiClient
 */

import type {
  ProductSearchResult,
  ProductSearchItem,
  ProductDetailResponse,
  CalculateRequest,
  CalculatorResult,
  SortOrder,
  RankingMethodology,
  ApiError,
  CorrectionItem,
  PriceHistoryQuery,
  PriceHistoryResponse,
  FeatureFlagsResponse,
  SavedScenario,
  SaveScenarioRequest,
  MerchantReliabilityListResponse,
  DeclarationSummaryResponse,
  SessionStatus,
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

/** Exported so other modules can construct full outbound URLs. */
export { BASE_URL };

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
 * Account-scoped paths authenticate with the server-issued
 * `rajahinta_session` cookie. The session lifecycle endpoints are excluded:
 * issuing a session needs no session, and re-issuing on a 401 from
 * rotate/revoke would corrupt their semantics.
 */
const ACCOUNT_SCOPE_PREFIX = '/api/v1/account/';
const SESSION_ENDPOINT_PREFIX = '/api/v1/account/session';

function isAccountScoped(path: string): boolean {
  return (
    path.startsWith(ACCOUNT_SCOPE_PREFIX) &&
    !path.startsWith(SESSION_ENDPOINT_PREFIX)
  );
}

/**
 * Assemble the default headers for an API request: JSON content type,
 * caller-provided overrides, and the age-confirmation header when the
 * cookie is present. Identity is never attached — the backend derives it
 * exclusively from the httpOnly session cookie.
 */
function buildHeaders(path: string, init?: RequestInit): Record<string, string> {
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

  return headers;
}

/**
 * Perform one HTTP exchange and translate non-2xx into {@link ApiFetchError}.
 */
async function executeRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers = buildHeaders(path, init);

  // The session cookie is httpOnly, so it only travels when credentials are
  // sent. Same-origin deployments work as-is; a cross-domain API origin must
  // answer CORS with an explicit origin (never "*") and `credentials: true`
  // or the browser drops the cookie.
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
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

/**
 * Account-scoped request wrapper.
 *
 * On the first account-touch without a session (fresh visitor, or an
 * expired anonymous session — its data is disposable by design) a session is
 * minted server-side and the original request replayed exactly once. The
 * single-flight promise collapses concurrent 401s into one issuance.
 */
export async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  try {
    return await executeRequest<T>(path, init);
  } catch (err) {
    if (
      !(err instanceof ApiFetchError) ||
      err.status !== 401 ||
      !isAccountScoped(path)
    ) {
      throw err;
    }
    await issueSessionOnce();
    return executeRequest<T>(path, init);
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle (server-issued httpOnly cookie)
// ---------------------------------------------------------------------------

/** Response of POST /api/v1/account/session (issue and rotate). */
export interface SessionInfo {
  readonly userId: string;
  readonly expiresAt: string;
  readonly verified: boolean;
}

/**
 * Issue a fresh anonymous session. Always mints a NEW account — call only
 * where abandoning the current one is intended; the token arrives as an
 * httpOnly `rajahinta_session` cookie and never in readable state.
 */
export async function issueSession(): Promise<SessionInfo> {
  return executeRequest<SessionInfo>('/api/v1/account/session', {
    method: 'POST',
  });
}

/** Single-flight issuance shared by concurrent first-touch 401s. */
let sessionIssuePromise: Promise<SessionInfo> | null = null;

function issueSessionOnce(): Promise<SessionInfo> {
  if (sessionIssuePromise === null) {
    // Cleared on completion so a later 401 can re-issue; while in flight,
    // every caller shares the same issuance.
    sessionIssuePromise = issueSession().finally(() => {
      sessionIssuePromise = null;
    });
  }
  return sessionIssuePromise;
}

/**
 * Atomically replace the presented session token. The old token stops
 * authenticating immediately; the account and its data are unchanged.
 */
export async function rotateSession(): Promise<SessionInfo> {
  return executeRequest<SessionInfo>('/api/v1/account/session/rotate', {
    method: 'POST',
  });
}

/** Revoke the session (logout) and clear the session cookie. */
export async function revokeSession(): Promise<{ revoked: true }> {
  return executeRequest<{ revoked: true }>('/api/v1/account/session', {
    method: 'DELETE',
  });
}

/**
 * Ensure an authenticated session exists and return its server-derived
 * identity. The subscription probe is the cheapest auth-required read that
 * also returns the userId; the request() wrapper mints the session on the
 * first account-touch, so callers need no issuance logic of their own.
 */
export async function ensureSession(): Promise<SessionStatus> {
  const sub = await request<{ userId: string; plan: string; active: boolean }>(
    '/api/v1/account/subscription',
  );
  return { userId: sub.userId };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * Search products by free-text query.
 *
 * @param q      Search term
 * @param sort   Sort order (default: ALPHABETICAL)
 * @param page   Page number (1-indexed, default: 1)
 * @param limit  Results per page (default: 20, max: 100)
 * @param signal Aborts the in-flight request so a superseded search never
 *               overwrites the results of a newer one
 */
export async function searchProducts(
  q: string,
  sort: string = 'ALPHABETICAL',
  page: number = 1,
  limit: number = 20,
  signal?: AbortSignal,
): Promise<ProductSearchResult> {
  const params = new URLSearchParams({ q, sort, page: String(page), limit: String(limit) });
  return request<ProductSearchResult>(`/api/v1/products?${params}`, {
    signal,
  });
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

// ---------------------------------------------------------------------------
// Correction flags
// ---------------------------------------------------------------------------

/**
 * Flag a calculation or data point for correction.
 *
 * Posts a correction flag to the backend with the target type, target ID,
 * and a human-readable reason.  Returns the created {@link CorrectionItem}.
 *
 * @param targetType  'calculation' to flag a calculation result, 'data_point' for product data
 * @param targetId    The record identifier of the flagged target
 * @param reason      Free-text explanation of the problem
 */
export async function createCorrectionFlag(
  targetType: 'calculation' | 'data_point',
  targetId: number,
  reason: string,
): Promise<CorrectionItem> {
  return request<CorrectionItem>('/api/v1/corrections', {
    method: 'POST',
    body: JSON.stringify({ targetType, targetId, reason }),
  });
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

/**
 * Cached single-flight fetch of the public feature-flag states.
 *
 * Flag values are static per deployment (loaded from env at boot), so one
 * request is shared across every caller on the page — N chart panels issue
 * a single flag lookup, not N. A failed lookup clears the cache so a later
 * call retries; callers treat rejection as "flag off" and hide gated UI
 * rather than erroring the page.
 */
let featureFlagsPromise: Promise<FeatureFlagsResponse> | null = null;

/**
 * Fetch the public feature-flag states used for UI gating.
 *
 * Throws {@link ApiFetchError} on non-2xx; resolve callers decide the
 * degraded presentation (see ProductHistoryPanel).
 */
export function getFeatureFlags(): Promise<FeatureFlagsResponse> {
  if (featureFlagsPromise === null) {
    featureFlagsPromise = request<FeatureFlagsResponse>(
      '/api/v1/feature-flags',
    ).catch((err: unknown) => {
      featureFlagsPromise = null;
      throw err;
    });
  }
  return featureFlagsPromise;
}

// ---------------------------------------------------------------------------
// Server-side reads (RSC / route handlers only)
// ---------------------------------------------------------------------------

/**
 * Canonical public origin of the frontend — used for sitemap, robots, and
 * metadataBase URLs. Configurable per deployment; the production domain is
 * the default.
 */
export const SITE_URL: string =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://rajahinta.fi';

/**
 * Every flag the frontend consumes, off. Used as the fallback when the
 * backend cannot be reached at render time — gated UI stays hidden, the
 * same degradation the client-side fetch path uses.
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlagsResponse = {
  flags: {
    HISTORICAL_PRICE_INTELLIGENCE: false,
    BASKET_OPTIMIZATION: false,
    ADVANCED_FEATURES: false,
  },
};

/**
 * Resolve feature-flag states on the server so they can be inlined into
 * the initial HTML payload (no late gated-UI flash). Values are static per
 * deployment; the short revalidate bounds staleness after a backend flip
 * without turning every render into an API round-trip.
 */
export async function getServerFeatureFlags(): Promise<FeatureFlagsResponse> {
  try {
    return await request<FeatureFlagsResponse>('/api/v1/feature-flags', {
      next: { revalidate: 60 },
    });
  } catch {
    return DEFAULT_FEATURE_FLAGS;
  }
}

/**
 * Fixed age-confirmation token for first-party server-side rendering.
 *
 * The catalog endpoints are age-gated, but crawlers cannot click a gate —
 * and the Phase 1 gate is explicit self-attestation (any non-empty token
 * passes by design). This token only ever reads public catalog data
 * server-side for metadata and the sitemap; it grants no session and no
 * account-scoped access.
 */
const SERVER_AGE_CONFIRMATION_TOKEN = 'server-prerender';

/**
 * Fetch a product with its offers on the server, or null when unavailable
 * (unknown id, launch gates closed, backend unreachable) so callers can
 * degrade to generic metadata instead of erroring the page.
 */
export async function getServerProductDetail(
  id: number,
): Promise<ProductDetailResponse | null> {
  try {
    return await request<ProductDetailResponse>(`/api/v1/products/${id}`, {
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
    const res = await request<ProductSearchResult>(
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

// ---------------------------------------------------------------------------
// Price history
// ---------------------------------------------------------------------------

/**
 * Classified failure modes of {@link getPriceHistory} that UI consumers
 * render distinctly (task 5.3): flag-off hides the chart entirely, rate
 * limiting shows a retry hint, validation errors surface the message.
 */
export type PriceHistoryErrorKind =
  | 'validation' // 400 — invalid query (including ranges wider than 365 days)
  | 'forbidden' // 403 — feature flag disabled or age confirmation missing
  | 'rate-limited' // 429 — HISTORICAL rate limit exceeded
  | 'not-found' // 404 — product does not exist
  | 'network' // fetch itself failed (no HTTP response)
  | 'unknown';

/**
 * Classify an error thrown by {@link getPriceHistory} into a typed kind.
 * Never throws and never reduces the error to a bare string — the original
 * {@link ApiFetchError} (status + parsed body) is carried by the guard for
 * callers that need the server message.
 */
export function classifyPriceHistoryError(
  err: unknown,
): { kind: PriceHistoryErrorKind; error: ApiFetchError | null } {
  if (err instanceof ApiFetchError) {
    if (err.status === 400) return { kind: 'validation', error: err };
    if (err.status === 403) return { kind: 'forbidden', error: err };
    if (err.status === 429) return { kind: 'rate-limited', error: err };
    if (err.status === 404) return { kind: 'not-found', error: err };
    return { kind: 'unknown', error: err };
  }
  return { kind: 'network', error: null };
}

/**
 * Fetch the historical price / landed-cost series for a product.
 *
 * metric and granularity default to 'price' and 'day' to mirror the DTO
 * defaults; merchant is sent only when provided (omit = product-wide
 * series). from/to are required ISO dates; ranges wider than 365 days are
 * rejected by the API with a 400, surfaced via
 * {@link classifyPriceHistoryError}.
 */
export async function getPriceHistory(
  productId: number,
  query: PriceHistoryQuery,
): Promise<PriceHistoryResponse> {
  const params = new URLSearchParams({
    metric: query.metric ?? 'price',
    granularity: query.granularity ?? 'day',
    from: query.from,
    to: query.to,
  });
  if (query.merchant !== undefined) {
    params.set('merchant', query.merchant);
  }
  return request<PriceHistoryResponse>(
    `/api/v1/products/${productId}/price-history?${params}`,
  );
}

// ---------------------------------------------------------------------------
// Saved scenarios (GET/POST/DELETE /api/v1/account/scenarios)
// ---------------------------------------------------------------------------

/**
 * List the current session's saved scenarios with their full inputs.
 *
 * Authentication rides the httpOnly session cookie injected by request();
 * no explicit identity is needed — or accepted — here.
 */
export async function listScenarios(): Promise<SavedScenario[]> {
  return request<SavedScenario[]>('/api/v1/account/scenarios');
}

/**
 * Save (upsert by name) the given calculator inputs as a scenario.
 * Saving under an existing name replaces that scenario's inputs.
 */
export async function saveScenario(
  input: SaveScenarioRequest,
): Promise<SavedScenario> {
  return request<SavedScenario>('/api/v1/account/scenarios', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Delete a saved scenario by ID (account-scoped). */
export async function deleteScenario(scenarioId: number): Promise<void> {
  return request<void>(`/api/v1/account/scenarios/${scenarioId}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Merchant reliability (GET /api/v1/merchants/reliability)
// ---------------------------------------------------------------------------

/**
 * Cached single-flight fetch of the per-merchant reliability scores.
 *
 * Every compare product column needs the same list; the cache means N
 * columns share one request per page load. A failed lookup clears the
 * cache so a later call retries. Callers gate on the ADVANCED_FEATURES
 * flag before calling — the fetch is never made for a hidden surface.
 */
let merchantReliabilityPromise: Promise<MerchantReliabilityListResponse> | null =
  null;

/** Fetch the factual reliability score for every merchant with offers. */
export function getMerchantReliability(): Promise<MerchantReliabilityListResponse> {
  if (merchantReliabilityPromise === null) {
    merchantReliabilityPromise = request<MerchantReliabilityListResponse>(
      '/api/v1/merchants/reliability',
    ).catch((err: unknown) => {
      merchantReliabilityPromise = null;
      throw err;
    });
  }
  return merchantReliabilityPromise;
}

// ---------------------------------------------------------------------------
// Declaration summary (GET /api/v1/declaration/:recordId)
// ---------------------------------------------------------------------------

/**
 * Fetch the declaration summary for a persisted calculation.
 *
 * The response includes the advanced `guidance` object only while the
 * enable_advanced_features flag is on server-side; callers treat its
 * absence as "panel hidden".
 */
export async function getDeclarationSummary(
  recordId: number,
): Promise<DeclarationSummaryResponse> {
  return request<DeclarationSummaryResponse>(
    `/api/v1/declaration/${recordId}`,
  );
}

// ---------------------------------------------------------------------------
// Calculation reports (GET /api/v1/reports/:recordId?format=json|csv|html)
// ---------------------------------------------------------------------------

/** Report export formats offered by the API. */
export type ReportFormat = 'json' | 'csv' | 'html';

/**
 * Classified failure modes of the report export that UI consumers render
 * distinctly: a PREMIUM entitlement failure gets a controlled-vocabulary
 * upsell message, never a crash.
 */
export type ReportErrorKind =
  | 'entitlement' // 403 with error 'InsufficientEntitlement' — tier too low
  | 'forbidden' // 403 otherwise (flag off server-side, age confirmation missing)
  | 'rate-limited' // 429
  | 'not-found' // 404 — calculation record does not exist
  | 'network' // fetch itself failed (no HTTP response)
  | 'unknown';

/**
 * Classify an error thrown by {@link downloadReport} /
 * {@link openPrintableReport} into a typed kind. Never throws; the
 * original {@link ApiFetchError} is carried for callers that need the
 * server message.
 */
export function classifyReportError(
  err: unknown,
): { kind: ReportErrorKind; error: ApiFetchError | null } {
  if (err instanceof ApiFetchError) {
    if (err.status === 403) {
      return err.body?.error === 'InsufficientEntitlement'
        ? { kind: 'entitlement', error: err }
        : { kind: 'forbidden', error: err };
    }
    if (err.status === 429) return { kind: 'rate-limited', error: err };
    if (err.status === 404) return { kind: 'not-found', error: err };
    return { kind: 'unknown', error: err };
  }
  return { kind: 'network', error: null };
}

/**
 * Fetch a report as a Blob.
 *
 * The report route needs the age-confirmation header, which a plain
 * anchor navigation cannot attach cross-origin — so every report action
 * (download or print) goes through fetch → blob → object URL.
 */
async function fetchReportBlob(
  recordId: number,
  format: ReportFormat,
): Promise<{ blob: Blob; filename: string }> {
  const path = `/api/v1/reports/${recordId}?format=${format}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: buildHeaders(path),
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

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const extension = format === 'json' ? 'json' : format;
  const filename =
    match?.[1] ?? `rajahinta-calculation-${recordId}.${extension}`;

  return { blob: await res.blob(), filename };
}

/**
 * Trigger a browser download of a report file (JSON or CSV).
 *
 * Mirrors the account data-export flow: blob → object URL → temporary
 * anchor click → revoke.
 */
export async function downloadReport(
  recordId: number,
  format: 'json' | 'csv',
): Promise<void> {
  const { blob, filename } = await fetchReportBlob(recordId, format);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Open the printable HTML report in a new tab and invoke the print
 * dialog.  Falls back to a file download when the popup is blocked so
 * the action always produces the report.
 */
export async function openPrintableReport(recordId: number): Promise<void> {
  const { blob } = await fetchReportBlob(recordId, 'html');
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank');
  if (opened !== null) {
    opened.addEventListener('load', () => {
      opened.print();
    });
    return;
  }

  // Popup blocked — degrade to a download of the same HTML report.
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `rajahinta-calculation-${recordId}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}