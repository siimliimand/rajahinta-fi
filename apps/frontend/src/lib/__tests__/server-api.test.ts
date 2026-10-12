/**
 * `serverRequest` unit tests (product-page-cold-latency task 3.2).
 *
 * Covers both transports of `lib/server-api.ts` hermetically (no workerd,
 * no network):
 *   1. Binding present — the `@opennextjs/cloudflare` context is mocked and
 *      the `API_WORKER` binding fetch receives a single Request carrying
 *      the internal route base + original path, the default method, and
 *      exactly the headers `request()` builds (JSON content type, the
 *      explicit age-confirmation header, generated trace context +
 *      request id); the Next-only `next` fetch option never reaches the
 *      RequestInit handed to the Request constructor.
 *   2. Context missing or throwing — the call falls back to `request()`'s
 *      URL path against the real `NEXT_PUBLIC_API_URL` base and keeps
 *      `next: { revalidate: 900 }` on the fetch init.
 *   3. Envelope parity — a non-2xx binding answer throws the SAME
 *      {@link ApiFetchError} shape `request()` throws (status, parsed
 *      body, echoed `x-request-id`), and a 2xx parses to the same JSON.
 *
 * @module ServerApiTest
 */
// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCloudflareContextMock } = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
}));

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

import {
  ApiFetchError,
  BASE_URL,
  SERVER_AGE_CONFIRMATION_TOKEN,
  request,
} from '../api';
import { getServerProductDetail, serverRequest } from '../server-api';

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRODUCT_PATH = '/api/v1/products/42';
const BINDING_BASE = 'https://api.internal';

/**
 * The realistic init the getServer* readers pass: the age gate rides the
 * explicit header (never a cookie on server reads) and the ISR window
 * governs the URL-fallback runtime.
 */
const DETAIL_INIT: RequestInit & { next?: { revalidate: number } } = {
  headers: { 'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN },
  next: { revalidate: 900 },
};

const PRODUCT_DETAIL = {
  product: { id: 42, name: 'Karhu IV' },
  offers: [{ merchant: 'alko', priceCents: 2490 }],
};

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

/** Install a context whose env carries one API_WORKER binding fetch. */
function withBinding(fetchMock: ReturnType<typeof vi.fn>): void {
  getCloudflareContextMock.mockReturnValue({
    env: { API_WORKER: { fetch: fetchMock } },
  });
}

// ---------------------------------------------------------------------------

describe('serverRequest — binding path (API_WORKER present)', () => {
  beforeEach(() => {
    getCloudflareContextMock.mockReset();
    // Loud stand-in: a binding-path test that leaks to the URL fallback
    // would observe this payload instead of the fixture below.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ urlFallback: 'should-not-run' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends one Request to the binding with the internal base URL, the original path, and the headers request() builds', async () => {
    const bindingFetch = vi.fn().mockResolvedValue(jsonResponse(PRODUCT_DETAIL));
    withBinding(bindingFetch);

    await getServerProductDetail(42);

    expect(bindingFetch).toHaveBeenCalledTimes(1);
    const [input, init] = bindingFetch.mock.calls[0] as [Request, RequestInit?];
    // The exchange travels as a single Request — no RequestInit second arg.
    expect(init).toBeUndefined();
    expect(input).toBeInstanceOf(Request);
    expect(input.url).toBe(`${BINDING_BASE}${PRODUCT_PATH}`);
    expect(input.method).toBe('GET');
    expect(input.headers.get('content-type')).toBe('application/json');
    expect(input.headers.get('x-age-confirmed')).toBe(
      SERVER_AGE_CONFIRMATION_TOKEN,
    );
    expect(input.headers.get('traceparent')).toMatch(TRACEPARENT_RE);
    expect(input.headers.get('x-request-id')).toMatch(UUID_RE);
    // The binding path never touches Next's patched global fetch.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('strips the Next-only `next` option from the RequestInit handed to the Request constructor', async () => {
    const bindingFetch = vi.fn().mockResolvedValue(jsonResponse(PRODUCT_DETAIL));
    withBinding(bindingFetch);

    // Record the RequestInit without changing construction semantics: the
    // stand-in constructor returns a real Request.
    const OriginalRequest = globalThis.Request;
    let capturedInit: RequestInit | undefined;
    (globalThis as { Request: typeof Request }).Request = function (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Request {
      capturedInit = init;
      return new OriginalRequest(input, init);
    } as unknown as typeof Request;

    try {
      await getServerProductDetail(42);
    } finally {
      (globalThis as { Request: typeof Request }).Request = OriginalRequest;
    }

    expect(capturedInit).toBeDefined();
    expect(capturedInit).not.toHaveProperty('next');
    // Everything request() would send survives the strip.
    expect(capturedInit?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN,
    });
  });
});

describe('serverRequest — context missing → request() URL fallback', () => {
  beforeEach(() => {
    getCloudflareContextMock.mockReset();
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(PRODUCT_DETAIL));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to global fetch against the real URL base when getCloudflareContext throws', async () => {
    getCloudflareContextMock.mockImplementation(() => {
      throw new Error('getCloudflareContext() called outside a worker runtime');
    });

    const result = await getServerProductDetail(42);

    expect(result).toEqual(PRODUCT_DETAIL);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${PRODUCT_PATH}`);
    // request()'s contract travels with the fallback: session credentials
    // and the same assembled headers (buildHeaders + trace context).
    expect(init.credentials).toBe('include');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN,
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.traceparent).toMatch(TRACEPARENT_RE);
    expect(headers['x-request-id']).toMatch(UUID_RE);
  });

  it('keeps `next: { revalidate: 900 }` on the fallback init', async () => {
    getCloudflareContextMock.mockImplementation(() => {
      throw new Error('no context');
    });

    await getServerProductDetail(42);

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit & { next?: unknown }];
    expect(init.next).toEqual({ revalidate: 900 });
  });

  it('also falls back when a context exists but env carries no API_WORKER binding', async () => {
    getCloudflareContextMock.mockReturnValue({ env: {} });

    const result = await getServerProductDetail(42);

    expect(result).toEqual(PRODUCT_DETAIL);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string];
    expect(url).toBe(`${BASE_URL}${PRODUCT_PATH}`);
  });

  it('degrades to the fallback when the context factory yields nothing', async () => {
    getCloudflareContextMock.mockReturnValue(undefined);

    const result = await getServerProductDetail(42);

    expect(result).toEqual(PRODUCT_DETAIL);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('serverRequest — error envelope parity with request()', () => {
  beforeEach(() => {
    getCloudflareContextMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws the same ApiFetchError on a binding non-2xx as request() does on the URL path', async () => {
    const envelope = {
      statusCode: 429,
      message: 'Too many requests',
      error: 'RateLimitExceeded',
    };
    const requestId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const answer = () => jsonResponse(envelope, 429, { 'x-request-id': requestId });

    // Reference: request()'s URL path with the identical backend answer.
    globalThis.fetch = vi.fn().mockResolvedValue(answer());
    const urlError = (await request(PRODUCT_PATH, DETAIL_INIT).catch(
      (err: unknown) => err,
    )) as ApiFetchError;

    // Subject: the binding path with the identical backend answer.
    const bindingFetch = vi.fn().mockResolvedValue(answer());
    withBinding(bindingFetch);
    const bindingError = (await serverRequest(PRODUCT_PATH, DETAIL_INIT).catch(
      (err: unknown) => err,
    )) as ApiFetchError;

    expect(urlError).toBeInstanceOf(ApiFetchError);
    expect(bindingError).toBeInstanceOf(ApiFetchError);
    expect(bindingError.status).toBe(urlError.status);
    expect(bindingError.message).toBe(urlError.message);
    expect(bindingError.body).toEqual(urlError.body);
    // The x-request-id echo rides the binding response headers exactly as
    // on the URL path.
    expect(bindingError.requestId).toBe(requestId);
    expect(bindingError.requestId).toBe(urlError.requestId);
  });

  it('keeps requestId null on the binding path when the response carries no echo header', async () => {
    const bindingFetch = vi.fn().mockResolvedValue(
      jsonResponse({ statusCode: 404, message: 'Not found', error: 'NotFound' }, 404),
    );
    withBinding(bindingFetch);

    const err = (await serverRequest(PRODUCT_PATH, DETAIL_INIT).catch(
      (err: unknown) => err,
    )) as ApiFetchError;

    expect(err).toBeInstanceOf(ApiFetchError);
    expect(err.status).toBe(404);
    expect(err.requestId).toBeNull();
  });
});

describe('serverRequest — 2xx parse parity with request()', () => {
  beforeEach(() => {
    getCloudflareContextMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the parsed JSON body from the binding exactly as request() does', async () => {
    const bindingFetch = vi.fn().mockResolvedValue(jsonResponse(PRODUCT_DETAIL));
    withBinding(bindingFetch);
    const viaBinding = await serverRequest(PRODUCT_PATH, DETAIL_INIT);

    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(PRODUCT_DETAIL));
    const viaUrl = await request(PRODUCT_PATH, DETAIL_INIT);

    expect(viaBinding).toEqual(PRODUCT_DETAIL);
    expect(viaUrl).toEqual(PRODUCT_DETAIL);
    expect(viaBinding).toEqual(viaUrl);
  });
});
