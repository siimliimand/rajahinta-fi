/**
 * Fetch-client unit tests (migrate-to-cloudflare task 5.2).
 *
 * Covers the outbound contract of the single API fetch module:
 *   1. Base-URL resolution per environment (`resolveApiBaseUrl`).
 *   2. W3C trace-context propagation: `traceparent`/`tracestate` and
 *      `x-request-id` pass through when the caller supplies them, and a
 *      valid standalone `traceparent` is generated otherwise (task 6.2,
 *      apps/api-worker/src/observability/TRACES.md).
 *   3. `credentials: 'include'` so the httpOnly `rajahinta_session` cookie
 *      travels on every request.
 *   4. The unified error envelope passes through intact, carrying the
 *      API's echoed `x-request-id`.
 *
 * @module ApiFetchClientTest
 */
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ApiFetchError,
  buildTraceparent,
  request,
  resolveApiBaseUrl,
  withTraceHeaders,
} from '../api';

const API_BASE = 'http://localhost:3000';

/** Build a fetch Response-like object for a JSON body and status. */
function jsonResponse(
  body: unknown,
  status = 200,
  responseHeaders: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(responseHeaders),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

type FetchCall = [string, RequestInit];

function lastCalls(): FetchCall[] {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as FetchCall[];
}

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------

describe('resolveApiBaseUrl — per-environment base URL', () => {
  it('falls back to the local dev backend when the build var is unset', () => {
    expect(resolveApiBaseUrl(undefined)).toBe('http://localhost:3000');
    expect(resolveApiBaseUrl('')).toBe('http://localhost:3000');
    expect(resolveApiBaseUrl('   ')).toBe('http://localhost:3000');
  });

  it('passes a configured base through as-is', () => {
    expect(resolveApiBaseUrl('https://api.rajahinta.fi')).toBe('https://api.rajahinta.fi');
    expect(resolveApiBaseUrl('https://rajahinta-api-staging.example.workers.dev')).toBe(
      'https://rajahinta-api-staging.example.workers.dev',
    );
  });

  it('strips trailing slashes so path joins never double up', () => {
    expect(resolveApiBaseUrl('https://api.rajahinta.fi/')).toBe('https://api.rajahinta.fi');
    expect(resolveApiBaseUrl('http://localhost:8788///')).toBe('http://localhost:8788');
  });
});

describe('trace-context headers (task 6.2 note)', () => {
  it('builds a valid standalone traceparent (version 00, sampled, nonzero ids)', () => {
    const tp = buildTraceparent();
    expect(tp).toMatch(TRACEPARENT_RE);
    // All-zero trace or span ids are invalid per the W3C spec.
    expect(tp).not.toContain('-00000000000000000000000000000000-');
    expect(tp).not.toMatch(/-0{16}-/);
  });

  it('generates a different traceparent per call', () => {
    expect(buildTraceparent()).not.toBe(buildTraceparent());
  });

  it('generates traceparent and a UUID request id when none are supplied', () => {
    const headers = withTraceHeaders();
    expect(headers['traceparent']).toMatch(TRACEPARENT_RE);
    expect(headers['x-request-id']).toMatch(UUID_RE);
  });

  it('passes caller-supplied traceparent, tracestate, and request id through verbatim', () => {
    const inbound = {
      traceparent:
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      tracestate: 'congo=t61rcWkgMzE',
      'x-request-id': '11111111-2222-4333-8444-555555555555',
    };
    const headers = withTraceHeaders(inbound);
    expect(headers['traceparent']).toBe(inbound.traceparent);
    expect(headers['tracestate']).toBe(inbound.tracestate);
    expect(headers['x-request-id']).toBe(inbound['x-request-id']);
  });

  it('replaces a malformed caller traceparent with a valid one, keeps tracestate', () => {
    const headers = withTraceHeaders({
      traceparent: 'garbage',
      tracestate: 'vendor=data',
    });
    expect(headers['traceparent']).toMatch(TRACEPARENT_RE);
    expect(headers['tracestate']).toBe('vendor=data');
  });

  it('matches trace keys case-insensitively and preserves other headers as given', () => {
    const input = {
      TraceParent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01',
      'X-Request-Id': '11111111-2222-4333-8444-555555555555',
      'Content-Type': 'application/json',
    };
    const headers = withTraceHeaders(input);
    expect(headers['TraceParent']).toBe(input.TraceParent);
    expect(headers['X-Request-Id']).toBe(input['X-Request-Id']);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('generates a request id when the caller sends an empty one', () => {
    const headers = withTraceHeaders({ 'x-request-id': '' });
    expect(headers['x-request-id']).toMatch(UUID_RE);
  });
});

describe('request() outbound contract', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('assembles the configured base URL with the request path', async () => {
    await request('/api/v1/feature-flags');
    const [url] = lastCalls()[0];
    expect(url).toBe(`${API_BASE}/api/v1/feature-flags`);
  });

  it('always sends credentials: include so the httpOnly session cookie travels', async () => {
    await request('/api/v1/products?q=karhu');
    const [, init] = lastCalls()[0];
    expect(init.credentials).toBe('include');
  });

  it('sends a standalone traceparent and UUID request id on every call', async () => {
    await request('/api/v1/products?q=karhu');
    const headers = lastCalls()[0][1].headers as Record<string, string>;
    expect(headers['traceparent']).toMatch(TRACEPARENT_RE);
    expect(headers['x-request-id']).toMatch(UUID_RE);
  });

  it('forwards caller header overrides alongside the generated trace context', async () => {
    await request('/api/v1/products/1', {
      headers: {
        'x-age-confirmed': 'server-prerender',
        'x-request-id': '11111111-2222-4333-8444-555555555555',
      },
      next: { revalidate: 900 },
    });
    const headers = lastCalls()[0][1].headers as Record<string, string>;
    expect(headers['x-age-confirmed']).toBe('server-prerender');
    expect(headers['x-request-id']).toBe('11111111-2222-4333-8444-555555555555');
    expect(headers['traceparent']).toMatch(TRACEPARENT_RE);
  });

  it('passes the unified error envelope through and carries the echoed request id', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(
        { statusCode: 429, message: 'Too many requests', error: 'RateLimitExceeded' },
        429,
        { 'x-request-id': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
      ),
    );

    const err = await request('/api/v1/products/1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiFetchError);
    const apiError = err as ApiFetchError;
    expect(apiError.status).toBe(429);
    expect(apiError.body).toEqual({
      statusCode: 429,
      message: 'Too many requests',
      error: 'RateLimitExceeded',
    });
    expect(apiError.message).toBe('Too many requests');
    expect(apiError.requestId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });

  it('keeps requestId null when the API response has no echo header', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ statusCode: 404, message: 'Not found', error: 'NotFound' }, 404),
    );

    const err = await request('/api/v1/products/999999').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiFetchError);
    expect((err as ApiFetchError).requestId).toBeNull();
  });
});
