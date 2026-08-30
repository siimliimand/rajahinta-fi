/**
 * Request-ID + structured request logging (design D8) — the Workers Logs
 * adaptation of the pino bootstrap in apps/backend/src/main.ts:
 *
 * - a client-supplied x-request-id is honored only when it is a plain
 *   UUID, otherwise a fresh UUID is generated;
 * - the ID is echoed in the x-request-id response header (current
 *   behavior) and stamped on every structured log line;
 * - one completion line per request with safe fields only: method, path
 *   without query (query strings can carry tokens), matched route
 *   pattern, status, duration.
 *
 * Registered first so it wraps the whole chain: error responses are
 * finalized inside the chain (app.onError / error-boundary), so the
 * completion line below still reads the final status — the same
 * behavior the pino `res.on('finish')` hook produced.
 */

import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { requestPath } from '../errors';
import { createLogger } from '../logger';

/** Accept a client-supplied request ID only when it is a plain UUID. */
export function sanitizeRequestId(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    trimmed,
  )
    ? trimmed
    : null;
}

export function requestLogging(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId =
      sanitizeRequestId(c.req.header('x-request-id')) ?? crypto.randomUUID();
    c.set('requestId', requestId);
    // Context headers apply to whatever this context finalizes — including
    // error-boundary and not-found responses produced further down.
    c.header('x-request-id', requestId);

    const start = performance.now();
    try {
      await next();
    } finally {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      // A logging failure must never destroy an already-produced response.
      try {
        const path = requestPath(c);
        // Route pattern (low cardinality) when matched; the query string is
        // deliberately never logged — it can carry tokens.
        let route = path;
        try {
          route = c.req.routePath || path;
        } catch {
          // no matched route — pathname is the low-cardinality fallback
        }
        createLogger(c.env?.LOG_LEVEL).info({
          requestId,
          method: c.req.method,
          path,
          route,
          status: c.res.status,
          durationMs,
          message: 'request completed',
        });
      } catch {
        // logging is best-effort
      }
    }
  };
}
