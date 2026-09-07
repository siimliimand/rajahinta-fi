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
 * Connection strategy (migrate-to-cloudflare 5.2): the API base is a plain
 * URL per environment (same-zone routing — `api.rajahinta.fi`-style custom
 * domain per env on the same Cloudflare zone). No service binding: browser
 * fetches cannot traverse a binding, build-time sitemap fetches run outside
 * any Worker, and a binding/URL split would give SSR and the browser
 * different cookie origins. See apps/frontend/OPENNEXT.md.
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
 * Resolve the API base from the build-time `NEXT_PUBLIC_API_URL` value.
 * A pure function so the per-environment resolution is unit-testable;
 * `process.env.NEXT_PUBLIC_*` is inlined by `next build` (runtime
 * `wrangler.jsonc` vars cannot change it — OPENNEXT.md).
 */
export function resolveApiBaseUrl(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return 'http://localhost:3000';
  return trimmed.replace(/\/+$/, '');
}

/**
 * Base URL for the rajahinta.fi API.
 *
 * NEXT_PUBLIC_API_URL can be set at build-time; defaults to the dev server
 * running on port 3000 (the NestJS backend default). Per-environment
 * values and the local concurrent-run convention are documented in
 * OPENNEXT.md.
 */
const BASE_URL: string = resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);

/** Exported so other modules can construct full outbound URLs. */
export { BASE_URL };

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when an API call returns a non-2xx status.
 * Carries the parsed {@link ApiError} body when available.
 *
 * `requestId` is the API's echoed `x-request-id` (the request-logging
 * middleware returns it on every response) — surfaced so support and log
 * correlation never depend on the user reading a network panel.
 */
export class ApiFetchError extends Error {
  readonly status: number;
  readonly body: ApiError | null;
  readonly requestId: string | null;

  constructor(status: number, body: ApiError | null, requestId?: string | null) {
    super(body?.message ?? `API returned ${status}`);
    this.name = 'ApiFetchError';
    this.status = status;
    this.body = body;
    this.requestId = requestId ?? null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Window event fired when the API demands age (re)confirmation. */
const AGE_GATE_REQUIRED_EVENT = 'age-gate:required';

/**
 * Window event fired after an auth-state change (sign-in, registration,
 * logout). The SiteHeader probes `/account/me` on mount only — a client-side
 * navigation never remounts it — so auth pages and the logout button use
 * this event to make the header re-probe (same recovery pattern as
 * `age-gate:required`).
 */
const AUTH_STATE_CHANGED_EVENT = 'auth:state-changed';

/** Notify listeners (the SiteHeader) that the signed-in state may have changed. */
function notifyAuthStateChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_STATE_CHANGED_EVENT));
  }
}

/**
 * Re-open the AgeGate prompt in place when the API rejects a request with
 * 403 `AGE_GATE_REQUIRED`. The confirmation cookie can expire while
 * client-side state still treats the visitor as verified, leaving
 * age-gated flows without a rendered prompt to recover through; this
 * window event is the recovery hook the AgeGate modal listens for
 * (age-gate-recovery). The `window` guard keeps the call SSR-safe —
 * build-time fetches share this module.
 */
function notifyAgeGateRequired(status: number, body: ApiError | null): void {
  if (
    status === 403 &&
    body?.code === 'AGE_GATE_REQUIRED' &&
    typeof window !== 'undefined'
  ) {
    window.dispatchEvent(new CustomEvent(AGE_GATE_REQUIRED_EVENT));
  }
}

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

// ---------------------------------------------------------------------------
// Trace context (migrate-to-cloudflare 6.2 note, src/observability/TRACES.md)
// ---------------------------------------------------------------------------

/** Lowercase hex string of `n` random bytes (2 chars per byte). */
function randomHex(nBytes: number): string {
  const bytes = new Uint8Array(nBytes);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build a standalone W3C Trace Context `traceparent` header
 * (`00-<32hex trace id>-<16hex span id>-01`). Version `00`, flags `01`
 * (sampled); an all-zero span id is invalid, so the id is generated.
 * Without a RUM SDK this standalone header is what lets the API's span
 * join a trace at all (TRACES.md, task 6.2).
 */
export function buildTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

/**
 * Merge the W3C trace-context and request-ID headers onto an outbound
 * API request: caller-supplied values pass through verbatim (server
 * routes can forward the inbound request's headers for full
 * browser→frontend→API waterfalls); otherwise a fresh standalone
 * `traceparent` and a UUID `x-request-id` (the API echoes it, UUID-only)
 * are generated per request. Existing header casing is preserved — only
 * the trace keys are matched case-insensitively.
 */
export function withTraceHeaders(existing?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(existing ?? {}).map(([k, v]) => [k, String(v)]),
    ),
  };

  const traceparentKey =
    Object.keys(headers).find((k) => k.toLowerCase() === 'traceparent') ?? 'traceparent';
  if (!TRACEPARENT_PATTERN.test(headers[traceparentKey] ?? '')) {
    headers[traceparentKey] = buildTraceparent();
  }

  const requestIdKey =
    Object.keys(headers).find((k) => k.toLowerCase() === 'x-request-id') ?? 'x-request-id';
  if (headers[requestIdKey] === undefined || headers[requestIdKey] === '') {
    headers[requestIdKey] = crypto.randomUUID();
  }

  return headers;
}

/**
 * Assemble the default headers for an API request: JSON content type,
 * caller-provided overrides, and the age-confirmation header when the
 * cookie is present. Trace context is added once by the caller
 * ({@link apiFetch} / {@link executeRequest}). Identity is never attached —
 * the backend derives it exclusively from the httpOnly session cookie.
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
 * The single low-level outbound path for EVERY API fetch in the app:
 * base-URL assembly plus trace-context/request-ID headers. `request()`
 * adds credentials and error translation on top; the operator-console
 * client (`app/[locale]/ops/api.ts`) uses it directly with its bearer
 * auth, so ops calls carry the same trace context.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  return fetch(url, {
    ...init,
    headers: withTraceHeaders(init?.headers),
  });
}

/**
 * Perform one HTTP exchange and translate non-2xx into {@link ApiFetchError}.
 */
async function executeRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = buildHeaders(path, init);

  // The session cookie is httpOnly, so it only travels when credentials are
  // sent. Same-origin deployments work as-is; a cross-domain API origin must
  // answer CORS with an explicit origin (never "*") and `credentials: true`
  // or the browser drops the cookie.
  const res = await apiFetch(path, {
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
    notifyAgeGateRequired(res.status, body);
    const requestId = res.headers?.get?.('x-request-id') ?? null;
    throw new ApiFetchError(res.status, body, requestId);
  }

  return res.json() as Promise<T>;
}

/**
 * Request wrapper used by every domain function.
 *
 * There is no anonymous-issuance retry (design D8, change
 * email-password-auth): an account-scoped 401 propagates as
 * {@link ApiFetchError} so route-level code can redirect to `/login`.
 * Sign-in happens only through {@link registerAccount} /
 * {@link loginAccount}, which set the cookie server-side.
 */
export async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return executeRequest<T>(path, init);
}

// ---------------------------------------------------------------------------
// Session lifecycle (credentials auth; server-issued httpOnly cookie)
// ---------------------------------------------------------------------------

/**
 * Session payload of the endpoints that issue or rotate the cookie
 * (register, login, rotate). The token itself travels only in the
 * httpOnly `rajahinta_session` cookie and never in readable state.
 */
export interface SessionInfo {
  readonly userId: string;
  readonly expiresAt: string;
  readonly verified: boolean;
}

/**
 * Create an account (email = username) and sign in: the API validates the
 * credentials, issues the session cookie, and fires a best-effort
 * verification email. Rejections: 400 InvalidEmail/InvalidPassword, 409
 * EmailAlreadyRegistered, 429 (AUTH rate limit).
 */
export async function registerAccount(
  email: string,
  password: string,
): Promise<SessionInfo> {
  const info = await request<SessionInfo>('/api/v1/account/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  notifyAuthStateChanged();
  return info;
}

/**
 * Sign in with the email credential. The API answers unknown email and
 * wrong password with one uniform 401 (no enumeration); 429 is possible
 * under the AUTH rate limit.
 */
export async function loginAccount(
  email: string,
  password: string,
): Promise<SessionInfo> {
  const info = await request<SessionInfo>('/api/v1/account/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  notifyAuthStateChanged();
  return info;
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
  const result = await request<{ revoked: true }>('/api/v1/account/session', {
    method: 'DELETE',
  });
  notifyAuthStateChanged();
  return result;
}

/**
 * Ensure a signed-in session exists and return its server-derived
 * identity. `GET /account/me` is the cheapest auth-required read; a 401
 * here is the sign-in redirect signal for route-level code.
 */
export async function ensureSession(): Promise<SessionStatus> {
  return request<SessionStatus>('/api/v1/account/me');
}

// ---------------------------------------------------------------------------
// Email verification and password reset (design D2/D3/D4)
// ---------------------------------------------------------------------------

/** Response of `POST /account/verify-email/confirm`. */
export interface EmailVerificationResult {
  readonly verified: true;
  readonly userId: string;
  readonly email: string;
}

/**
 * Consume the emailed verification token (public — the token IS the
 * capability; single-use, 24 h expiry). Invalid, expired, and replayed
 * tokens all fail with a 401 InvalidToken.
 */
export async function confirmEmailVerification(
  token: string,
): Promise<EmailVerificationResult> {
  return request<EmailVerificationResult>(
    '/api/v1/account/verify-email/confirm',
    { method: 'POST', body: JSON.stringify({ token }) },
  );
}

/**
 * Re-send the verification email for the signed-in account
 * (sessionAuth). Mail dispatch failures are logged server-side and never
 * break the 202.
 */
export async function requestVerificationEmail(): Promise<{ accepted: true }> {
  return request<{ accepted: true }>('/api/v1/account/verify-email/request', {
    method: 'POST',
  });
}

/**
 * Request a password-reset email. The API answers 202 unconditionally so
 * the route cannot leak account existence.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ accepted: true }> {
  return request<{ accepted: true }>('/api/v1/account/password/reset-request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/**
 * Complete the password reset with the emailed token (public — the token
 * IS the capability). The API rehashes the password and revokes ALL of
 * the account's sessions. Rejections: 400 InvalidPassword (policy),
 * 401 InvalidToken (invalid/expired/replayed).
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ reset: true }> {
  return request<{ reset: true }>('/api/v1/account/password/reset', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
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
 * render distinctly (task 5.3): forbidden failures hide the chart
 * entirely, rate limiting shows a retry hint, validation errors surface
 * the message.
 */
export type PriceHistoryErrorKind =
  | 'validation' // 400 — invalid query (including ranges wider than 365 days)
  | 'forbidden' // 403 — age confirmation missing
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
 * cache so a later call retries.
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
 * The response may omit the advanced `guidance` object; callers treat
 * its absence as "panel hidden".
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
  | 'forbidden' // 403 otherwise (age confirmation missing)
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
  const res = await apiFetch(path, {
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
    notifyAgeGateRequired(res.status, body);
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