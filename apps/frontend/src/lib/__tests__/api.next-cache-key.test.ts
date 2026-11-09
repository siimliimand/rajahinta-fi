/**
 * Fetch-cache key regression against Next's REAL `generateCacheKey`
 * (fix-r2-fetch-cache-key-explosion task 1.2).
 *
 * Task 1.1 stopped minting a generated `x-request-id` on positive-revalidate
 * reads. Next 16.4.3 builds the fetch data-cache key from the request
 * headers after stripping ONLY `traceparent`/`tracestate`
 * (`next/dist/server/lib/incremental-cache/index.js`,
 * `IncrementalCache.prototype.generateCacheKey`), so a generated UUID on
 * those reads minted a distinct cache key — and a distinct R2 object — per
 * render. This file proves the header change against the actual key
 * algorithm, not a re-implementation of it:
 *
 *   1. Identical blog/guide index reads (`next: { revalidate: 900 }`, the
 *      SiteFooter's `getServerBlogIndex` / `getServerGuidesIndex` shape)
 *      whose only difference is generated trace context map to ONE key.
 *   2. The same reads WITH a generated `x-request-id` still mint per-call
 *      keys — the defect, asserted so the suite cannot pass against a key
 *      function that ignored headers entirely.
 *   3. Non-cacheable shapes (no `next`, `revalidate: false`, `revalidate: 0`,
 *      tags-only) keep the generated UUID and the per-call key.
 *   4. An explicit caller `x-request-id` travels verbatim and keeps
 *      framework cache-key semantics (different IDs → different keys), the
 *      accepted trade-off in the change design (D1).
 *
 * The key function is loaded from Next's internal CommonJS path
 * `next/dist/server/lib/incremental-cache` via `createRequire`: the package
 * has no `exports` map, the file has no type declarations, and a dynamic
 * `import()` of a CJS module that itself calls `require('crypto')` is less
 * reliable under vitest. `generateCacheKey` only reads
 * `fetchCacheKeyPrefix` off `this`, so a one-field host stands in for a
 * fully constructed IncrementalCache.
 *
 * @module ApiNextCacheKeyTest
 */
// @vitest-environment node

import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, withTraceHeaders } from '../api';

const API_BASE = 'http://localhost:3000';

/** The blog-index read `getServerBlogIndex(locale)` issues. */
const BLOG_PATH = '/api/v1/blog/posts?locale=fi';
/** The guides-index read `getServerGuidesIndex(locale)` issues. */
const GUIDES_PATH = '/api/v1/guides?locale=fi';

/** Caller init mirroring `getServerBlogIndex` (positive revalidate). */
const BLOG_INIT: RequestInit = {
  headers: { accept: 'application/json' },
  next: { revalidate: 900, tags: ['blog'] },
};

/** Caller init mirroring `getServerGuidesIndex` (positive revalidate). */
const GUIDES_INIT: RequestInit = {
  headers: { accept: 'application/json' },
  next: { revalidate: 900, tags: ['guides'] },
};

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXPLICIT_ID_A = '11111111-2222-4333-8444-555555555555';
const EXPLICIT_ID_B = '99999999-2222-4333-8444-555555555555';

// ---------------------------------------------------------------------------

type GenerateCacheKey = (
  this: { fetchCacheKeyPrefix?: string },
  url: string,
  init?: RequestInit,
) => Promise<string>;

const nodeRequire = createRequire(import.meta.url);

const { IncrementalCache } = nodeRequire('next/dist/server/lib/incremental-cache') as {
  IncrementalCache: { prototype: { generateCacheKey: GenerateCacheKey } };
};

const generateCacheKey = IncrementalCache.prototype.generateCacheKey;

/** Stand-in `this`: the only field `generateCacheKey` reads off the instance. */
const CACHE_HOST = { fetchCacheKeyPrefix: '' };

type FetchCall = [string, RequestInit];

interface Outbound {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function fetchCalls(): FetchCall[] {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as FetchCall[];
}

function headerMap(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

function requestIdKeys(headers: Record<string, string>): string[] {
  return Object.keys(headers).filter((k) => k.toLowerCase() === 'x-request-id');
}

function lastCall(): FetchCall {
  const call = fetchCalls()[fetchCalls().length - 1];
  if (call === undefined) throw new Error('expected a fetch call');
  return call;
}

/** Drive the production `request()` path and capture what Next's fetch sees. */
async function outboundFor(path: string, init?: RequestInit): Promise<Outbound> {
  await request(path, init);
  const [url, outboundInit] = lastCall();
  return { url, init: outboundInit };
}

function cacheKeyOf(outbound: Outbound): Promise<string> {
  return generateCacheKey.call(CACHE_HOST, outbound.url, outbound.init);
}

function cacheKeyWithHeaders(outbound: Outbound, headers: Record<string, string>): Promise<string> {
  return generateCacheKey.call(CACHE_HOST, outbound.url, { ...outbound.init, headers });
}

function explicitInit(requestId: string): RequestInit {
  return {
    headers: { accept: 'application/json', 'x-request-id': requestId },
    next: { revalidate: 900, tags: ['blog'] },
  };
}

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('positive-revalidate reads share one Next fetch-cache key', () => {
  it('blog index: regenerated trace context maps to the same key', async () => {
    const first = await outboundFor(BLOG_PATH, BLOG_INIT);
    const second = await outboundFor(BLOG_PATH, BLOG_INIT);

    expect(first.url).toBe(`${API_BASE}${BLOG_PATH}`);
    expect(second.url).toBe(first.url);

    const headersA = headerMap(first.init);
    const headersB = headerMap(second.init);

    // Precondition: the omit path actually fired, and the two renders
    // really do carry different generated trace context.
    expect(requestIdKeys(headersA)).toEqual([]);
    expect(requestIdKeys(headersB)).toEqual([]);
    expect(headersA['traceparent']).toMatch(TRACEPARENT_RE);
    expect(headersB['traceparent']).toMatch(TRACEPARENT_RE);
    expect(headersA['traceparent']).not.toBe(headersB['traceparent']);

    expect(await cacheKeyOf(first)).toBe(await cacheKeyOf(second));
  });

  it('guides index: regenerated trace context maps to the same key', async () => {
    const first = await outboundFor(GUIDES_PATH, GUIDES_INIT);
    const second = await outboundFor(GUIDES_PATH, GUIDES_INIT);

    expect(first.url).toBe(`${API_BASE}${GUIDES_PATH}`);
    expect(requestIdKeys(headerMap(first.init))).toEqual([]);
    expect(headerMap(first.init)['traceparent']).not.toBe(
      headerMap(second.init)['traceparent'],
    );

    expect(await cacheKeyOf(first)).toBe(await cacheKeyOf(second));
  });

  it('blog and guide keys stay distinct from each other', async () => {
    const blog = await outboundFor(BLOG_PATH, BLOG_INIT);
    const guides = await outboundFor(GUIDES_PATH, GUIDES_INIT);

    expect(await cacheKeyOf(blog)).not.toBe(await cacheKeyOf(guides));
  });

  it('the defect: a generated x-request-id still splits the key', async () => {
    const pairs = [
      [await outboundFor(BLOG_PATH, BLOG_INIT), await outboundFor(BLOG_PATH, BLOG_INIT)],
      [await outboundFor(GUIDES_PATH, GUIDES_INIT), await outboundFor(GUIDES_PATH, GUIDES_INIT)],
    ] as const;

    for (const [first, second] of pairs) {
      // Pre-fix assembly: `withTraceHeaders` without the omit option keeps
      // the already-valid generated `traceparent` and mints a fresh UUID —
      // exactly the headers the old `apiFetch` put on the wire.
      const defectA = withTraceHeaders(headerMap(first.init));
      const defectB = withTraceHeaders(headerMap(second.init));

      expect(defectA['x-request-id']).toMatch(UUID_RE);
      expect(defectB['x-request-id']).toMatch(UUID_RE);
      expect(defectA['x-request-id']).not.toBe(defectB['x-request-id']);

      expect(await cacheKeyWithHeaders(first, defectA)).not.toBe(
        await cacheKeyWithHeaders(second, defectB),
      );
    }
  });
});

describe('non-cacheable requests keep generated request IDs and per-call keys', () => {
  const NON_CACHEABLE: ReadonlyArray<[string, RequestInit]> = [
    ['no next option', {}],
    ['revalidate false', { next: { revalidate: false } }],
    ['revalidate 0', { next: { revalidate: 0 } }],
    ['tags only', { next: { tags: ['blog'] } }],
  ];

  it.each(NON_CACHEABLE)('%s', async (_label, init) => {
    const first = await outboundFor(BLOG_PATH, init);
    const second = await outboundFor(BLOG_PATH, init);

    const headersA = headerMap(first.init);
    const headersB = headerMap(second.init);
    expect(headersA['x-request-id']).toMatch(UUID_RE);
    expect(headersB['x-request-id']).toMatch(UUID_RE);
    expect(headersA['x-request-id']).not.toBe(headersB['x-request-id']);
    expect(headersA['traceparent']).not.toBe(headersB['traceparent']);

    // The generated UUID is a real cache-key input: the non-cacheable path
    // keeps today's per-call key semantics.
    expect(await cacheKeyOf(first)).not.toBe(await cacheKeyOf(second));
  });
});

describe('explicit caller request IDs keep framework cache-key semantics', () => {
  it('travels verbatim on a positive-revalidate read', async () => {
    const outbound = await outboundFor(BLOG_PATH, explicitInit(EXPLICIT_ID_A));

    expect(headerMap(outbound.init)['x-request-id']).toBe(EXPLICIT_ID_A);
    expect(headerMap(outbound.init)['traceparent']).toMatch(TRACEPARENT_RE);
  });

  it('different explicit IDs produce different keys', async () => {
    const a = await outboundFor(BLOG_PATH, explicitInit(EXPLICIT_ID_A));
    const b = await outboundFor(BLOG_PATH, explicitInit(EXPLICIT_ID_B));

    expect(await cacheKeyOf(a)).not.toBe(await cacheKeyOf(b));
  });

  it('the same explicit ID with different trace context produces the same key', async () => {
    const a = await outboundFor(BLOG_PATH, explicitInit(EXPLICIT_ID_A));
    const b = await outboundFor(BLOG_PATH, explicitInit(EXPLICIT_ID_A));

    expect(headerMap(a.init)['traceparent']).not.toBe(headerMap(b.init)['traceparent']);
    expect(await cacheKeyOf(a)).toBe(await cacheKeyOf(b));
  });

  it('an explicit ID still fragments the key relative to the omit path', async () => {
    const withId = await outboundFor(BLOG_PATH, explicitInit(EXPLICIT_ID_A));
    const withoutId = await outboundFor(BLOG_PATH, BLOG_INIT);

    expect(await cacheKeyOf(withId)).not.toBe(await cacheKeyOf(withoutId));
  });
});
