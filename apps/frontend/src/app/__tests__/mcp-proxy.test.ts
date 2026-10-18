/**
 * Route tests for the same-origin `/mcp` proxy (seo-aeo-agent-surfaces
 * follow-up): gate envelope on an unconfirmed visitor, raw JSON-RPC
 * passthrough on a confirmed one, POST-only surface.
 *
 * The route's binding path is unreachable under vitest (no Cloudflare
 * context — getCloudflareContext throws, the route falls through), so
 * the passthrough case exercises the URL-base fallback with a mocked
 * global fetch and asserts the exact upstream contract: method, URL,
 * the server confirmation header, and the untouched body/status.
 *
 * @module McpProxyRouteTest
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST, GET } from '../mcp/route';
import { BASE_URL } from '@/lib/api';

/**
 * `cookies()` needs a request scope this harness cannot provide — mock
 * the store per test with the jar the scenario needs.
 */
let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name in cookieJar ? { name, value: cookieJar[name] } : undefined,
  }),
}));

const GATE_SHAPE = {
  code: 'AGE_GATE_REQUIRED',
  error: 'Forbidden',
  statusCode: 403,
  path: '/mcp',
};

function jsonRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request('https://rajahinta.fi/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /mcp proxy', () => {
  afterEach(() => {
    cookieJar = {};
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('unconfirmed visitor gets the age-gate envelope and upstream is never called', async () => {
    cookieJar = {};
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(jsonRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    for (const [key, value] of Object.entries(GATE_SHAPE)) {
      expect(body[key]).toEqual(value);
    }
    expect(typeof body.message).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirmed visitor passes through raw: URL, method, server token, body, status', async () => {
    cookieJar = { age_confirmed: 'true' };
    const upstreamBody = {
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [] },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(upstreamBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // The visitor's age_confirmed cookie — the same host-only cookie the
    // AgeGate writes; the route reads it from the request's cookie jar.
    const request = new Request('https://rajahinta.fi/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        cookie: 'age_confirmed=true',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    vi.spyOn(request, 'text').mockResolvedValue(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    );

    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual(upstreamBody);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.href).toBe(`${BASE_URL}/mcp`);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('x-age-confirmed')).toBe('server-prerender');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/json, text/event-stream');
    expect(init.body).toBe(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  });

  it('upstream non-200 statuses stream through untouched (429 keeps its shape)', async () => {
    cookieJar = { age_confirmed: 'true' };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Too Many Requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '30' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://rajahinta.fi/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'age_confirmed=true' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    });
    vi.spyOn(request, 'text').mockResolvedValue(
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    );

    const res = await POST(request);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
  });
});

describe('GET /mcp proxy', () => {
  it('is a 405 — the surface registers POST only', async () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});
