/**
 * Same-origin `/mcp` proxy (follow-up to change `seo-aeo-agent-surfaces`).
 *
 * The Cloudflare WebMCP toggle's Site MCP Server pack accepts only a
 * same-origin PATH for its `data-mcp-url` (the dashboard rejects full
 * URLs), but the MCP endpoint itself lives on the api-worker origin —
 * and the `age_confirmed` cookie is host-only (`document.cookie`, no
 * `Domain` attribute), so a browser-side bridge can NEVER reach the
 * cross-origin endpoint with its confirmation. This route closes both
 * gaps: the bridge talks to `POST /mcp` on the page's own origin, the
 * visitor's cookie rides along same-origin, and the proxy converts it
 * to the server confirmation token the API trusts — the exact
 * `server-api.ts` exchange (API_WORKER service binding when present,
 * URL base as the dev/build fallback), but passing the JSON-RPC
 * response through raw instead of parsing it.
 *
 * The gate is structural, never bypassed: without the visitor's
 * `age_confirmed` cookie the proxy answers the API's own 403
 * `AGE_GATE_REQUIRED` envelope and calls nothing — an unconfirmed
 * agent gets the same contract error the /mcp endpoint would return,
 * never tool results. Only POST reaches upstream (the endpoint
 * registers POST only; anything else is a 405, not a silent GET).
 *
 * Dynamic by nature (per-request cookie read); nothing here is
 * cacheable. The upstream response body streams through unmodified —
 * the proxy adds no MCP semantics of its own.
 *
 * @module McpProxyRoute
 */

import { cookies } from 'next/headers';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { BASE_URL, SERVER_AGE_CONFIRMATION_TOKEN } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Same cookie the main app's AgeGate component writes (age-gate flow). */
const AGE_COOKIE = 'age_confirmed';

const BINDING_ROUTE_BASE = 'https://api.internal';

/** The API's own gate envelope, byte-shape identical (age-gate middleware). */
function gateResponse(): Response {
  return Response.json(
    {
      message:
        'Age confirmation required. Please confirm your age via the age-gate prompt.',
      error: 'Forbidden',
      code: 'AGE_GATE_REQUIRED',
      statusCode: 403,
      timestamp: new Date().toISOString(),
      path: '/mcp',
    },
    { status: 403 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const confirmed = (await cookies()).get(AGE_COOKIE)?.value;
  if (!confirmed) {
    return gateResponse();
  }

  const body = await request.text();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // The streamable-HTTP transport requires both media types.
    accept: request.headers.get('accept') ?? 'application/json, text/event-stream',
    'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN,
  };

  try {
    const apiWorker = getCloudflareContext().env.API_WORKER;
    if (apiWorker) {
      const upstream = await apiWorker.fetch(
        new Request(new URL('/mcp', BINDING_ROUTE_BASE), {
          method: 'POST',
          headers,
          body,
        }),
      );
      return new Response(upstream.body, {
        status: upstream.status,
        headers: passthroughHeaders(upstream),
      });
    }
  } catch {
    // No worker context (next dev / next build / vitest) — URL base below.
  }

  const upstream = await fetch(new URL('/mcp', BASE_URL), {
    method: 'POST',
    headers,
    body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: passthroughHeaders(upstream),
  });
}

/**
 * Header allowlist for the proxied response: content type, the rate-limit
 * `Retry-After` contract, and the house `x-request-id` error echo.
 * Everything hop-by-hop or stateful (cookies) stays at the edge.
 */
function passthroughHeaders(upstream: Response): Record<string, string> {
  const out: Record<string, string> = {
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
  };
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter !== null) out['retry-after'] = retryAfter;
  const requestId = upstream.headers.get('x-request-id');
  if (requestId !== null) out['x-request-id'] = requestId;
  return out;
}

/** The endpoint registers POST only — never a silent GET surface. */
export function GET(): Response {
  return Response.json(
    { message: 'Method Not Allowed', error: 'Method Not Allowed', statusCode: 405 },
    { status: 405 },
  );
}
