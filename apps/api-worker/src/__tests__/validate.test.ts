import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { createApp } from '../index';
import { parseBody, validateBody } from '../middleware/validate';
import {
  exciseCalculationSchema,
  type ExciseCalculationDto,
} from '../dto/exemplar';

/** App with the exemplar DTO wired through both validation forms. */
function demoApp(): Hono<AppEnv> {
  const app = createApp();
  app.post('/api/v1/test/parse', async (c) =>
    c.json(await parseBody(c, exciseCalculationSchema)),
  );
  app.post(
    '/api/v1/test/middleware',
    validateBody(exciseCalculationSchema),
    (c) => c.json(c.get('validatedBody')),
  );
  return app;
}

const VALID: ExciseCalculationDto = {
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 4.7,
};

function post(app: Hono<AppEnv>, path: string, body: string) {
  return app.request(path, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

describe('parseBody (zod validation helper)', () => {
  it('passes a valid body through as the parsed DTO', async () => {
    const res = await post(
      demoApp(),
      '/api/v1/test/parse',
      JSON.stringify(VALID),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VALID);
  });

  it('returns a 400 envelope with all issues joined into one message', async () => {
    const res = await post(
      demoApp(),
      '/api/v1/test/parse',
      JSON.stringify({ category: 'mead', volumeLitres: -1 }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      path: '/api/v1/test/parse',
    });
    const message = body.message as string;
    expect(message).toContain('category:');
    expect(message).toContain('volumeLitres:');
    expect(message).toContain('; ');
  });

  it('returns a 400 envelope for a non-JSON body', async () => {
    const res = await post(demoApp(), '/api/v1/test/parse', 'not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      statusCode: 400,
      message: 'Request body must be JSON',
    });
  });
});

describe('validateBody (middleware form)', () => {
  it('stores the parsed body for the handler', async () => {
    const res = await post(
      demoApp(),
      '/api/v1/test/middleware',
      JSON.stringify(VALID),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VALID);
  });

  it('rejects an invalid body with the same 400 envelope', async () => {
    const res = await post(
      demoApp(),
      '/api/v1/test/middleware',
      JSON.stringify({ alcoholByVolume: 200 }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.statusCode).toBe(400);
    expect(String(body.message)).toContain('category:');
  });
});
