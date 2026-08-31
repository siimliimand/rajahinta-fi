import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../index';
import { ApiHttpError } from '../errors';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENVELOPE_KEYS = [
  'statusCode',
  'message',
  'error',
  'timestamp',
  'path',
].sort();

/** App with extra routes that exercise each error class. */
function testApp() {
  const app = createApp();
  app.get('/api/v1/test/not-found', () => {
    throw new ApiHttpError(404, 'Product not found');
  });
  app.get('/api/v1/test/domain-context', () => {
    throw new ApiHttpError(422, {
      message: 'Age gate rejected',
      error: 'ClassificationGateRejection',
      productId: 7,
      reason: 'age',
    });
  });
  app.get('/api/v1/test/boom', () => {
    throw new Error('secret-internal-detail');
  });
  return app;
}

describe('GET /api/v1/health (liveness)', () => {
  it('answers 200 with the process-only health shape', async () => {
    const res = await testApp().request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});

describe('request-ID middleware', () => {
  it('generates a UUID request ID and echoes it in x-request-id', async () => {
    const res = await testApp().request('/api/v1/health');
    expect(UUID_RE.test(res.headers.get('x-request-id') ?? '')).toBe(true);
  });

  it('propagates a valid inbound UUID', async () => {
    const inbound = crypto.randomUUID();
    const res = await testApp().request('/api/v1/health', {
      headers: { 'x-request-id': inbound },
    });
    expect(res.headers.get('x-request-id')).toBe(inbound);
  });

  it('regenerates when the inbound ID is not a plain UUID', async () => {
    const res = await testApp().request('/api/v1/health', {
      headers: { 'x-request-id': '../../etc/passwd' },
    });
    const echoed = res.headers.get('x-request-id') ?? '';
    expect(echoed).not.toBe('../../etc/passwd');
    expect(UUID_RE.test(echoed)).toBe(true);
  });

  it('logs one structured completion line carrying the requestId', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await testApp().request('/api/v1/health');
    const requestId = res.headers.get('x-request-id');
    const line = spy.mock.calls
      .map((args) => args[0])
      .find((f) => (f as { message?: string })?.message === 'request completed');
    expect(line).toMatchObject({
      requestId,
      method: 'GET',
      path: '/api/v1/health',
      status: 200,
    });
    spy.mockRestore();
  });
});

describe('unified error envelope', () => {
  it('maps a thrown API error to the documented envelope', async () => {
    const res = await testApp().request('/api/v1/test/not-found');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(ENVELOPE_KEYS);
    expect(body).toMatchObject({
      statusCode: 404,
      message: 'Product not found',
      error: 'Not Found',
      path: '/api/v1/test/not-found',
    });
    expect(Number.isNaN(Date.parse(body.timestamp as string))).toBe(false);
  });

  it('preserves domain context alongside the envelope (envelope fields win)', async () => {
    const res = await testApp().request('/api/v1/test/domain-context');
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      statusCode: 422,
      message: 'Age gate rejected',
      error: 'ClassificationGateRejection',
      productId: 7,
      reason: 'age',
      path: '/api/v1/test/domain-context',
    });
  });

  it('maps unknown errors to the generic 500 fallback without leaking internals', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await testApp().request('/api/v1/test/boom');
    expect(res.status).toBe(500);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('secret-internal-detail');
    expect(JSON.parse(raw)).toEqual({
      statusCode: 500,
      message: 'Internal server error',
      error: 'InternalServerError',
      timestamp: expect.any(String),
      path: '/api/v1/test/boom',
    });
    // Details went to the structured log with the request ID instead.
    const logged = JSON.stringify(spy.mock.calls.map((args) => args[0]));
    expect(logged).toContain('Unhandled exception outside HttpException');
    expect(logged).toContain('secret-internal-detail');
    spy.mockRestore();
  });

  it('serves the Nest-parity envelope for unknown routes', async () => {
    const res = await testApp().request('/api/v1/definitely-missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      statusCode: 404,
      message: 'Cannot GET /api/v1/definitely-missing',
      error: 'Not Found',
      timestamp: expect.any(String),
      path: '/api/v1/definitely-missing',
    });
  });

  it('echoes x-request-id on error responses too', async () => {
    const res = await testApp().request('/api/v1/test/boom');
    expect(UUID_RE.test(res.headers.get('x-request-id') ?? '')).toBe(true);
  });
});
