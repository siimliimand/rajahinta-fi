/**
 * Unified error envelope — Hono port of
 * packages/application-api/src/common/api-error.filter.ts (design D1:
 * the documented ApiErrorResponse contract is preserved exactly).
 *
 * Every error response from every route conforms to:
 *
 *   { statusCode, message, error, timestamp, path }
 *
 * Thrown API errors carry `statusCode`, `message`, often `error` plus
 * domain context (productId, retryAfterSeconds, requiredTier, …); the
 * envelope keeps those fields and adds the missing `timestamp` and `path`,
 * so envelope fields win on collision and domain context survives. Unknown
 * (non-API) errors become a generic 500 — internals never leak; their
 * details go to the structured log with the request ID instead.
 *
 * Differences from the Nest host are mechanical only:
 * - Hono exposes an absolute request URL, so `path` is normalized to the
 *   pathname — the documented "/api/v1/…" shape, and query strings (which
 *   can carry tokens) stay out of responses.
 * - `error`/`message` fallbacks reproduce `HttpStatus[statusCode]`
 *   (TypeScript enum reverse mapping → "BAD_REQUEST" style keys).
 */

import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Context } from 'hono';
import { createLogger } from './logger';

/**
 * Documented error contract. Structural copy of
 * packages/application-api/src/interfaces (ApiErrorResponse) — the
 * canonical shape; kept local so the Worker build does not depend on the
 * Nest-era package.
 */
export interface ApiErrorResponse {
  readonly statusCode: number;
  readonly message: string;
  readonly error: string;
  readonly timestamp: string;
  readonly path: string;
}

/** Nest built-in exception bodies use the standard status name ("Not Found"). */
const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** `HttpStatus[statusCode]` reverse mapping used by the filter's fallbacks. */
const STATUS_ENUM_KEYS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

export type ApiErrorPayload = string | Record<string, unknown>;

/**
 * Port of Nest's HttpException for the Worker: status + response body.
 * Throw sites use it exactly like the built-in exceptions today.
 */
export class ApiHttpError extends Error {
  readonly payload: Record<string, unknown>;

  constructor(
    readonly status: number,
    payload: ApiErrorPayload = {},
  ) {
    super(typeof payload === 'string' ? payload : 'API error');
    this.name = 'ApiHttpError';
    // Mirror Nest's HttpException.createBody: a string message becomes
    // { message, error: <standard status name> } — the exact body the
    // built-in exceptions produce; an object body passes through so throw
    // sites keep full control (domain context rides along to the envelope).
    this.payload =
      typeof payload === 'string'
        ? {
            message: payload,
            error: STATUS_TITLES[status] ?? STATUS_ENUM_KEYS[status] ?? 'Error',
          }
        : payload;
  }
}

/** Normalise a thrown message to the envelope's single string field. */
function normalizeMessage(message: unknown, fallback: string): string {
  if (typeof message === 'string' && message.length > 0) return message;
  // class-validator style arrays (none today — validation throws plain
  // strings — but the envelope must keep normalizing them).
  if (Array.isArray(message) && message.length > 0) {
    return message.map((m) => String(m)).join('; ');
  }
  return fallback;
}

/** Request path for the envelope — pathname only, query never echoed. */
export function requestPath(c: Context): string {
  return new URL(c.req.url).pathname;
}

/**
 * Build the unified envelope response for any thrown error. Returns the
 * status plus the serialized body; the error boundary (or app.onError)
 * writes it.
 */
export function buildErrorResponse(
  err: unknown,
  path: string,
): { status: number; body: ApiErrorResponse & Record<string, unknown> } {
  if (err instanceof ApiHttpError || err instanceof HTTPException) {
    const status = err.status;
    const raw: unknown =
      err instanceof ApiHttpError
        ? err.payload
        : // Hono's own HTTPException (c.throw / internals): same treatment.
          { message: err.message };
    const payload: Record<string, unknown> =
      typeof raw === 'string' ? { message: raw } : { ...(raw as Record<string, unknown>) };

    const envelope: ApiErrorResponse = {
      statusCode: status,
      message: normalizeMessage(
        payload.message,
        STATUS_ENUM_KEYS[status] ?? 'Error',
      ),
      error:
        typeof payload.error === 'string' && payload.error.length > 0
          ? payload.error
          : STATUS_ENUM_KEYS[status] ?? 'Error',
      timestamp: new Date().toISOString(),
      path,
    };

    // Envelope fields win; domain context (productId, retryAfterSeconds,
    // requiredTier, …) from the thrown body is preserved alongside them.
    return { status, body: { ...payload, ...envelope } };
  }

  // Unknown error: generic 500, details only in the structured log.
  return {
    status: 500,
    body: {
      statusCode: 500,
      message: 'Internal server error',
      error: 'InternalServerError',
      timestamp: new Date().toISOString(),
      path,
    },
  };
}

/**
 * Unknown routes: Nest's RoutesNotFoundException parity —
 * 404 { message: "Cannot GET /…", error: "Not Found" } envelope.
 */
export function routeNotFoundResponse(
  method: string,
  path: string,
): { status: number; body: ApiErrorResponse & Record<string, unknown> } {
  return buildErrorResponse(
    new ApiHttpError(404, { message: `Cannot ${method} ${path}`, error: 'Not Found' }),
    path,
  );
}

/**
 * Respond to any thrown error with the unified envelope. Shared by
 * app.onError (Hono delivers Error instances to it at the innermost
 * dispatch frame) and the error-boundary middleware (the net for
 * non-Error throws compose rethrows outward) — one implementation keeps
 * both interception points byte-identical, mirroring @Catch() coverage.
 *
 * Unknown errors are logged here with the request ID; internals never
 * reach the response.
 */
export function respondToError(c: Context, err: unknown): Response {
  const { status, body } = buildErrorResponse(err, requestPath(c));
  if (status === 500) {
    // Mirror the filter's log line; internals live only here.
    createLogger(c.env?.LOG_LEVEL).error({
      requestId: c.get('requestId'),
      message: 'Unhandled exception outside HttpException',
      detail: err instanceof Error ? (err.stack ?? String(err)) : String(err),
    });
  }
  return c.json(body, status as ContentfulStatusCode);
}
