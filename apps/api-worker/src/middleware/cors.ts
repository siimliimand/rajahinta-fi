/**
 * CORS middleware — parity port of `app.enableCors({...})` from
 * apps/backend/src/main.ts (task 5.2 review finding): the Nest app ran
 * the `cors` package with an explicit origin, GET/POST/PUT/DELETE, and
 * `credentials: true` (the httpOnly session cookie only travels on
 * credentialed requests — `credentials: 'include'` in the frontend API
 * client). Without the same headers the Worker API breaks every
 * cross-origin browser flow at preflight.
 *
 * Mirrored `cors`-package semantics, pinned by tests:
 *  - explicit origin (string or comma-separated list from CORS_ORIGIN,
 *    default `http://localhost:3001` exactly like main.ts) → echoed in
 *    Access-Control-Allow-Origin, never "*"
 *  - Access-Control-Allow-Credentials: true on allowed responses
 *  - preflight (OPTIONS + Access-Control-Request-Method) short-circuits
 *    204 before guards/routing, reflects Access-Control-Request-Headers,
 *    204 with no CORS headers on a disallowed origin
 *  - `Vary: Origin` on responses so caches key correctly
 */

import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

/** Mirrors main.ts: process.env.CORS_ORIGIN ?? 'http://localhost:3001'. */
export const DEFAULT_CORS_ORIGIN = 'http://localhost:3001';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

export function resolveCorsOrigins(configured: string | undefined): string[] {
  const raw = configured?.trim() || DEFAULT_CORS_ORIGIN;
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

export function corsMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origins = resolveCorsOrigins(c.env?.CORS_ORIGIN);
    const requestOrigin = c.req.header('Origin');
    const allowed = requestOrigin != null && origins.includes(requestOrigin);

    // Preflight: short-circuit before guards/routing (Nest's cors package
    // answers OPTIONS itself; the guard chain never sees it).
    const isPreflight =
      c.req.method === 'OPTIONS' &&
      c.req.header('Access-Control-Request-Method') != null;

    if (isPreflight) {
      const headers = new Headers();
      headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
      if (allowed) {
        headers.set('Access-Control-Allow-Origin', requestOrigin);
        headers.set('Access-Control-Allow-Credentials', 'true');
        headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
        const requestedHeaders = c.req.header('Access-Control-Request-Headers');
        // cors-package default with no allowedHeaders: reflect the request.
        if (requestedHeaders) headers.set('Access-Control-Allow-Headers', requestedHeaders);
      }
      c.res = new Response(null, { status: 204, headers });
      return;
    }

    await next();

    if (allowed && requestOrigin != null && c.res) {
      const headers = new Headers(c.res.headers);
      headers.set('Access-Control-Allow-Origin', requestOrigin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.append('Vary', 'Origin');
      c.res = new Response(c.res.body, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers,
      });
    }
  };
}
