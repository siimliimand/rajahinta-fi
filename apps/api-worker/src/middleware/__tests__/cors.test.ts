/**
 * CORS middleware tests — parity with apps/backend/src/main.ts
 * enableCors + the `cors` package semantics it delegated to (task 5.2
 * review finding). The frontend's browser fetches are non-simple
 * (JSON content type) and credentialed (httpOnly session cookie), so
 * preflight handling and Allow-Credentials are load-bearing.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware, DEFAULT_CORS_ORIGIN, resolveCorsOrigins } from '../cors';
import type { Env } from '../../env';

function appWith(corsOrigin: string | undefined): Hono<{ Bindings: Partial<Env> }> {
  const app = new Hono<{ Bindings: Partial<Env> }>();
  app.use('*', (c, next) => {
    (c as unknown as { env: Partial<Env> }).env = { CORS_ORIGIN: corsOrigin };
    return next();
  });
  app.use(corsMiddleware());
  app.notFound((c) => c.json({ message: `Cannot ${c.req.method} ${c.req.path}`, error: 'Not Found' }, 404));
  app.get('/api/v1/health', (c) => c.json({ status: 'ok' }));
  app.post('/api/v1/calculator', (c) => c.json({ ok: true }));
  return app;
}

describe('CORS parity (main.ts enableCors port)', () => {
  it('defaults to the main.ts origin when CORS_ORIGIN is unset', () => {
    expect(DEFAULT_CORS_ORIGIN).toBe('http://localhost:3001');
    expect(resolveCorsOrigins(undefined)).toEqual(['http://localhost:3001']);
    expect(resolveCorsOrigins('')).toEqual(['http://localhost:3001']);
  });

  it('preflight from an allowed origin: 204 + echoed origin + credentials + reflected headers', async () => {
    const res = await appWith('https://rajahinta.fi').request('/api/v1/calculator', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://rajahinta.fi',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://rajahinta.fi');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('content-type');
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('preflight from a disallowed origin: 204 but no CORS headers', async () => {
    const res = await appWith('https://rajahinta.fi').request('/api/v1/calculator', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('simple response from an allowed origin carries ACAO + credentials', async () => {
    const res = await appWith('https://rajahinta.fi').request('/api/v1/health', {
      headers: { Origin: 'https://rajahinta.fi' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://rajahinta.fi');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('simple response from a disallowed origin carries no CORS headers', async () => {
    const res = await appWith('https://rajahinta.fi').request('/api/v1/health', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('supports a comma-separated origin allowlist', async () => {
    const app = appWith('https://rajahinta.fi, https://staging.rajahinta.fi');
    const ok = await app.request('/api/v1/health', { headers: { Origin: 'https://staging.rajahinta.fi' } });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://staging.rajahinta.fi');
    const no = await app.request('/api/v1/health', { headers: { Origin: 'https://other.example' } });
    expect(no.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('404 envelope responses still carry CORS headers (Nest parity: cors wraps the whole app)', async () => {
    const res = await appWith('https://rajahinta.fi').request('/api/v1/does-not-exist', {
      headers: { Origin: 'https://rajahinta.fi' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://rajahinta.fi');
  });

  it('preflight short-circuits ahead of guards (OPTIONS never hits rate limit or 404)', async () => {
    // Guards/rate limiting register on API paths; a preflight to a guarded
    // path must not be treated as an API request. There is no route for
    // OPTIONS — the middleware answers before routing.
    const res = await appWith(undefined).request('/api/v1/calculator', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3001', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001');
  });
});
