/**
 * Embed calculator route (task 6.3) — GET /[locale]/embed/calculator
 *
 * A ROUTE HANDLER, not a page: the [locale] root layout wraps every page
 * in the site chrome, and the embeddable calculator must be a
 * self-contained minimal view with no site chrome, suitable for iframe
 * embedding (the what-if/embed precedent, task 8.3).
 *
 * Flow (spec: share-permalinks — embeddable calculator widget):
 *   1. The AGE GATE is structural, not bypassed: without a confirmation
 *      token the route renders the gate prompt and calls nothing. The
 *      token is the same `age_confirmed` cookie the main app sets on
 *      click-through; confirming inside the widget sets that same cookie
 *      server-side (?confirm=1). The ?confirm=1 query also keeps the
 *      attestation alive through form submissions for browsers that
 *      partition or block third-party cookies in iframes — the token
 *      only ever exists AFTER the gate was answered in this widget.
 *   2. Every API call goes through the normal client path
 *      (lib/api request → POST /api/v1/calculator, GET /api/v1/products)
 *      with the token forwarded as `x-age-confirmed` — the SAME guarded
 *      endpoints the calculator page uses, so rate limits, the age gate,
 *      and idempotency apply unchanged. There is no embed endpoint.
 *   3. A 429 renders a calm throttled view; a 403 AGE_GATE_REQUIRED
 *      (expired/invalid confirmation) re-renders the gate; anything else
 *      renders the unavailable view. The structural disclaimer travels
 *      with every rendered result.
 *
 * @module EmbedCalculatorRoute
 */

import { routing } from '@/i18n/routing';
import { ApiFetchError, request as apiRequest } from '@/lib/api';
import type { CalculatorResult, ProductSearchResult } from '@/lib/types';
import {
  renderEmbedCalculatorHtml,
  EMBED_MAX_QUANTITY,
  EMBED_MIN_QUERY_LENGTH,
  EMBED_MIN_QUANTITY,
  type EmbedLocale,
  type EmbedOutcome,
} from './view';

export const dynamic = 'force-dynamic';

/** Same cookie the main app's AgeGate component writes (age-gate flow). */
const AGE_COOKIE = 'age_confirmed';

/**
 * 90-day TTL — mirrors AgeGate.tsx's AGE_CONFIRMATION_TTL_DAYS. Kept
 * local so this route handler does not import a 'use client' module.
 */
const AGE_CONFIRMATION_MAX_AGE_SECONDS = 90 * 86400;

/** Destination is Finland-scoped, like the main calculator's default. */
const DEFAULT_DESTINATION = 'FI';

/** Defensive cap on the echoed search term (iframe URLs stay sane). */
const MAX_QUERY_LENGTH = 100;

function htmlResponse(body: string, headers?: Headers): Response {
  const init: HeadersInit = headers ?? { 'content-type': 'text/html; charset=utf-8' };
  return new Response(body, { status: 200, headers: init });
}

/**
 * Read the age-confirmation cookie from the request — the raw Cookie
 * header parse mirrors extractConfirmationToken's fallback in
 * age-gate.guard.ts, so the embed and the API agree on what counts as
 * presented.
 */
function readAgeCookie(request: Request): string | null {
  const raw = request.headers.get('cookie');
  if (raw === null) return null;
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${AGE_COOKIE}=`)) {
      const value = trimmed.slice(AGE_COOKIE.length + 1);
      if (value.length > 0) return value;
    }
  }
  return null;
}

/** The age-confirmation header, exactly as the main app's client sends it. */
function ageHeaders(token: string): Record<string, string> {
  return { 'x-age-confirmed': token };
}

type ApiFailure =
  | { readonly kind: 'throttled'; readonly retryAfterSeconds: number }
  | { readonly kind: 'age-gate' }
  | { readonly kind: 'unavailable' };

/**
 * Classify an API failure for the embed view. Rate-limited rejections
 * keep the structured retryAfterSeconds; age-gate rejections (403 with
 * body code AGE_GATE_REQUIRED) re-render the gate prompt — an expired
 * confirmation can never keep the widget computing.
 */
function classifyApiError(err: unknown): ApiFailure {
  if (err instanceof ApiFetchError) {
    if (err.status === 429) {
      return {
        kind: 'throttled',
        retryAfterSeconds:
          typeof err.body?.retryAfterSeconds === 'number' ? err.body.retryAfterSeconds : 60,
      };
    }
    if (err.status === 403 && err.body?.code === 'AGE_GATE_REQUIRED') {
      return { kind: 'age-gate' };
    }
  }
  return { kind: 'unavailable' };
}

/** Positive-integer param, or null when absent/malformed. */
function intParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale: rawLocale } = await params;
  // Mirror the layout's locale validation — unknown segments are not
  // pages, so they are not embeds either.
  if (!(routing.locales as readonly string[]).includes(rawLocale)) {
    return new Response('Not found', { status: 404 });
  }
  const locale = rawLocale as EmbedLocale;

  const url = new URL(request.url);
  const confirmRequested = url.searchParams.get('confirm') === '1';
  const declinedRequested = url.searchParams.get('declined') === '1';

  // ── Age gate (see module doc): cookie first, ?confirm=1 as the
  //    click-through fallback. Absent → render the gate, call nothing.
  const cookieToken = readAgeCookie(request);
  const ageToken = cookieToken ?? (confirmRequested ? 'true' : null);

  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  if (confirmRequested && ageToken !== null) {
    // Same cookie write the main app performs client-side on confirm.
    headers.append(
      'set-cookie',
      `${AGE_COOKIE}=${ageToken}; Path=/; SameSite=Lax; Max-Age=${AGE_CONFIRMATION_MAX_AGE_SECONDS}`,
    );
  }
  if (declinedRequested) {
    // A denial sticks — the stale confirmation is cleared like the main
    // app's decline handler does.
    headers.append('set-cookie', `${AGE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);
  }

  let outcome: EmbedOutcome;
  if (declinedRequested) {
    outcome = { kind: 'declined' };
  } else if (ageToken === null) {
    outcome = { kind: 'age-gate' };
  } else {
    const requestInit = { headers: ageHeaders(ageToken) };
    const productId = intParam(url, 'product');
    const quantityRaw = intParam(url, 'quantity') ?? EMBED_MIN_QUANTITY;
    // Same clamp as the page's QuantitySelector.
    const quantity = Math.min(EMBED_MAX_QUANTITY, Math.max(EMBED_MIN_QUANTITY, quantityRaw));
    const query = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);

    try {
      if (productId !== null && productId > 0) {
        // Same POST /api/v1/calculator the calculator page submits:
        // RateLimit(CALCULATOR) → AgeGate → idempotency, unchanged.
        const result = await apiRequest<CalculatorResult>('/api/v1/calculator', {
          method: 'POST',
          body: JSON.stringify({
            productId,
            quantity,
            destination: DEFAULT_DESTINATION,
          }),
          ...requestInit,
        });
        outcome = { kind: 'result', result };
      } else if (query.length >= EMBED_MIN_QUERY_LENGTH) {
        // Same GET /api/v1/products query the calculator page runs.
        const searchParams = new URLSearchParams({
          q: query,
          sort: 'ALPHABETICAL',
          page: '1',
          limit: '20',
        });
        const res = await apiRequest<ProductSearchResult>(
          `/api/v1/products?${searchParams}`,
          requestInit,
        );
        outcome =
          res.items.length > 0
            ? { kind: 'search', query, items: res.items }
            : { kind: 'no-results', query };
      } else {
        outcome = { kind: 'search', query: '', items: [] };
      }
    } catch (err: unknown) {
      const failure = classifyApiError(err);
      outcome =
        failure.kind === 'throttled'
          ? {
              kind: 'throttled',
              retryAfterSeconds: failure.retryAfterSeconds,
              // Same-origin retry target: the request's own path + query.
              retryPath: `${url.pathname}${url.search}`,
            }
          : failure.kind === 'age-gate'
            ? { kind: 'age-gate' }
            : { kind: 'unavailable' };
    }
  }

  return htmlResponse(renderEmbedCalculatorHtml(locale, outcome), headers);
}
