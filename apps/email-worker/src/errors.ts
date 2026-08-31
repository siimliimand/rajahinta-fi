/**
 * Unified error envelope — mirrors the `ApiErrorResponse` shape documented in
 * packages/application-api/src/common/api-error.filter.ts:
 *
 * ```json
 * { "statusCode": 422, "message": "…", "error": "…",
 *   "timestamp": "2026-08-28T12:00:00.000Z", "path": "/internal/email/send" }
 * ```
 *
 * The shape is reimplemented here rather than imported: application-api is
 * NestJS-bound and the email Worker must stay free of that dependency. Keep
 * the two envelopes in sync.
 *
 * @module errors
 */

export interface ApiErrorEnvelope {
  readonly statusCode: number;
  readonly message: string;
  readonly error: string;
  readonly timestamp: string;
  readonly path: string;
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  405: 'Method Not Allowed',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

/** HTTP status text used for the envelope's `error` field when not overridden. */
export function statusText(status: number): string {
  return STATUS_TEXT[status] ?? 'Error';
}

/** Build the envelope exactly like the API's error filter does. */
export function apiErrorEnvelope(
  status: number,
  message: string,
  path: string,
  error?: string,
): ApiErrorEnvelope {
  return {
    statusCode: status,
    message,
    error: error && error.length > 0 ? error : statusText(status),
    timestamp: new Date().toISOString(),
    path,
  };
}

/**
 * Error carrying an HTTP status (and optional envelope `error` label),
 * thrown by route handlers and rendered by the app's onError middleware.
 * Internal failures never reach the envelope as-is — the generic 500 path
 * keeps internals out of responses, matching the API filter.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly error?: string;

  constructor(status: number, message: string, error?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.error = error;
  }
}
