/**
 * ApiErrorFilter — unified error envelope (task 3.4, change
 * technical-assessment-remediation).
 *
 * Every error response from every controller — including the legacy ones —
 * conforms to the documented `ApiErrorResponse` shape:
 *
 * ```json
 * { "statusCode": 422, "message": "…", "error": "…",
 *   "timestamp": "2026-08-28T12:00:00.000Z", "path": "/api/v1/…" }
 * ```
 *
 * Controller-thrown exceptions already carry `statusCode`, `message`, and
 * often `error` plus domain context (productId, retryAfterSeconds, …);
 * this filter keeps those fields and adds the missing `timestamp` and
 * `path`, so partial envelopes written over time all converge on the
 * documented contract without touching every throw site. Unknown
 * (non-HttpException) errors become a generic 500 — internals never leak.
 *
 * Registered globally via APP_FILTER in ApplicationApiModule.
 *
 * @module ApiErrorFilter
 */

import {
  Catch,
  HttpException,
  type ExceptionFilter,
  type ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorResponse } from '../interfaces';

/** Normalise a thrown message to the envelope's single string field. */
function normalizeMessage(message: unknown, fallback: string): string {
  if (typeof message === 'string' && message.length > 0) return message;
  // class-validator style arrays (none today — controllers validate
  // manually — but pipes may produce them).
  if (Array.isArray(message) && message.length > 0) {
    return message.map((m) => String(m)).join('; ');
  }
  return fallback;
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{ status?: (code: number) => unknown; json?: (body: unknown) => unknown }>();
    const request = ctx.getRequest<{ url?: string }>();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const raw = exception.getResponse();
      const payload: Record<string, unknown> =
        typeof raw === 'string' ? { message: raw } : { ...(raw as Record<string, unknown>) };

      const envelope: ApiErrorResponse = {
        statusCode,
        message: normalizeMessage(
          payload.message,
          HttpStatus[statusCode] ?? 'Error',
        ),
        error:
          typeof payload.error === 'string' && payload.error.length > 0
            ? payload.error
            : HttpStatus[statusCode] ?? 'Error',
        timestamp: new Date().toISOString(),
        path: request?.url ?? '',
      };

      // Envelope fields win; domain context (productId, retryAfterSeconds,
      // requiredTier, …) from the thrown body is preserved alongside them.
      response.status?.(statusCode);
      response.json?.({ ...payload, ...envelope });
      return;
    }

    // Unknown error: generic 500, details only in the server log.
    this.logger.error(
      'Unhandled exception outside HttpException',
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status?.(HttpStatus.INTERNAL_SERVER_ERROR);
    response.json?.({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'InternalServerError',
      timestamp: new Date().toISOString(),
      path: request?.url ?? '',
    } satisfies ApiErrorResponse);
  }
}
