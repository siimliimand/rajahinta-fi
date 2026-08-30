/**
 * Route suite for POST /internal/email/send (task 5.3): shared-secret
 * enforcement, unified error envelope on every failure, delivery outcome on
 * success, and dispatch passthrough to the EmailTransport port / send_email
 * binding — all via Hono's in-process request helper, no Workers runtime.
 *
 * @module route.test
 */

import { describe, expect, it, vi } from 'vitest';
import { createEmailWorkerApp, SEND_SECRET_HEADER, secretsMatch } from '../app';
import type { BuiltEmailMessage } from '../mime';
import type { EmailTransport } from '../transport';
import type { SendEmailBinding, SendEmailBindingMessage, WorkerEnv } from '../env';

const SECRET = 'correct-horse-battery-staple';

function fakeBinding(
  impl: (message: SendEmailBindingMessage) => Promise<unknown> = async () => undefined,
): { binding: SendEmailBinding; calls: SendEmailBindingMessage[] } {
  const calls: SendEmailBindingMessage[] = [];
  return {
    calls,
    binding: {
      send: vi.fn(async (message: SendEmailBindingMessage) => {
        calls.push(message);
        return impl(message);
      }),
    },
  };
}

function stubTransport() {
  const sent: BuiltEmailMessage[] = [];
  const transport: EmailTransport = {
    send: vi.fn(async (message: BuiltEmailMessage) => {
      sent.push(message);
    }),
  };
  return { transport, sent };
}

interface AppOverrides {
  secret?: string;
  from?: string;
  transport?: EmailTransport;
}

function buildApp(overrides: AppOverrides = {}) {
  const { binding, calls } = fakeBinding();
  const app = createEmailWorkerApp({
    env: {
      EMAIL: binding,
      EMAIL_SEND_SECRET: overrides.secret ?? SECRET,
      EMAIL_FROM: overrides.from ?? 'alerts@rajahinta.fi',
    } satisfies WorkerEnv,
    ...(overrides.transport ? { transport: overrides.transport } : {}),
  });
  return { app, calls };
}

function post(
  app: ReturnType<typeof buildApp>['app'],
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request('/internal/email/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SEND_SECRET_HEADER]: SECRET,
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

function expectEnvelope(
  body: unknown,
  status: number,
  path = '/internal/email/send',
): void {
  const envelope = body as Record<string, unknown>;
  expect(envelope['statusCode']).toBe(status);
  expect(typeof envelope['message']).toBe('string');
  expect((envelope['message'] as string).length).toBeGreaterThan(0);
  expect(typeof envelope['error']).toBe('string');
  expect((envelope['error'] as string).length).toBeGreaterThan(0);
  expect(typeof envelope['timestamp']).toBe('string');
  expect(envelope['timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  expect(envelope['path']).toBe(path);
}

const validBody = { to: 'ops@example.com', subject: 'Freshness alert', text: 'stale prices' };

// ---------------------------------------------------------------------------
// Shared secret
// ---------------------------------------------------------------------------

describe('shared-secret enforcement', () => {
  it('rejects a missing secret header with a 401 envelope and does not dispatch', async () => {
    const { app, calls } = buildApp();
    const response = await app.request('/internal/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(response.status).toBe(401);
    expectEnvelope(await response.json(), 401);
    expect(calls).toEqual([]);
  });

  it('rejects a wrong secret with a 401 envelope and does not dispatch', async () => {
    const { app, calls } = buildApp();
    const response = await post(app, validBody, { [SEND_SECRET_HEADER]: 'wrong' });
    expect(response.status).toBe(401);
    expectEnvelope(await response.json(), 401);
    expect(calls).toEqual([]);
  });

  it('rejects when the server-side secret is unset', async () => {
    const { app } = buildApp({ secret: '' });
    const response = await post(app, validBody);
    expect(response.status).toBe(401);
    expectEnvelope(await response.json(), 401);
  });

  it('secretsMatch is exact: equal passes, different fails, missing fails', async () => {
    expect(await secretsMatch(SECRET, SECRET)).toBe(true);
    expect(await secretsMatch(SECRET, 'other')).toBe(false);
    expect(await secretsMatch(undefined, SECRET)).toBe(false);
    expect(await secretsMatch(SECRET, undefined)).toBe(false);
    expect(await secretsMatch('', '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validation failures — each with the envelope and no dispatch
// ---------------------------------------------------------------------------

describe('request validation', () => {
  it('rejects malformed JSON with a 400 envelope', async () => {
    const { app, calls } = buildApp();
    const response = await post(app, '{"to": "ops@example.com",');
    expect(response.status).toBe(400);
    expectEnvelope(await response.json(), 400);
    expect(calls).toEqual([]);
  });

  it.each([
    ['missing to', { subject: 's', text: 't' }, 422],
    ['invalid to', { ...validBody, to: 'not-an-email' }, 422],
    ['missing subject', { to: 'ops@example.com', text: 't' }, 422],
    ['empty subject', { ...validBody, subject: '' }, 422],
    ['over-long subject', { ...validBody, subject: 'x'.repeat(256) }, 413],
    ['subject with line breaks', { ...validBody, subject: 'ok\r\nBcc: v@x.co' }, 422],
    ['non-string text', { ...validBody, text: 5 }, 422],
    ['over-long text', { ...validBody, text: 'x'.repeat(256 * 1024 + 1) }, 413],
    ['no body part', { to: 'ops@example.com', subject: 's' }, 422],
    ['invalid replyTo', { ...validBody, replyTo: 'nope' }, 422],
  ])('%s → %i envelope, no dispatch', async (_name, body, expectedStatus) => {
    const { app, calls } = buildApp();
    const response = await post(app, body);
    expect(response.status).toBe(expectedStatus);
    expectEnvelope(await response.json(), expectedStatus);
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Success — MIME built, dispatch through port/binding, outcome returned
// ---------------------------------------------------------------------------

describe('successful send', () => {
  it('dispatches via the port and returns the delivery outcome (202)', async () => {
    const { transport, sent } = stubTransport();
    const { app } = buildApp({ transport });

    const response = await post(app, validBody);

    expect(response.status).toBe(202);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['accepted']).toBe(true);
    expect(body['status']).toBe('sent');
    expect(body['to']).toBe('ops@example.com');
    expect(body['messageId']).toMatch(/^<[\w-]+@rajahinta\.fi>$/);

    expect(sent.length).toBe(1);
    expect(sent[0]!.mime).toContain(`To: ops@example.com`);
    expect(sent[0]!.mime).toContain('Subject: Freshness alert');
    expect(sent[0]!.bindingMessage.text).toBe('stale prices');
  });

  it('passes structured fields through the binding adapter (dispatch passthrough)', async () => {
    const { app, calls } = buildApp();
    const response = await post(app, {
      to: 'ops@example.com',
      subject: 'Määräpäivä',
      text: 'plain',
      html: '<p>rich</p>',
      replyTo: 'replies@example.com',
    });

    expect(response.status).toBe(202);
    expect(calls).toEqual([
      {
        from: 'alerts@rajahinta.fi',
        to: 'ops@example.com',
        subject: 'Määräpäivä',
        text: 'plain',
        html: '<p>rich</p>',
        reply_to: 'replies@example.com',
      },
    ]);
  });

  it('sends html-only messages', async () => {
    const { app, calls } = buildApp();
    const response = await post(app, {
      to: 'ops@example.com',
      subject: 'Alert',
      html: '<p>rich</p>',
    });
    expect(response.status).toBe(202);
    expect(calls.length).toBe(1);
    expect(calls[0]!.html).toBe('<p>rich</p>');
    expect('text' in calls[0]!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Failure after authentication — configuration and dispatch errors
// ---------------------------------------------------------------------------

describe('post-auth failures', () => {
  it('returns a 503 envelope when EMAIL_FROM is missing', async () => {
    const { app, calls } = buildApp({ from: '' });
    const response = await post(app, validBody);
    expect(response.status).toBe(503);
    expectEnvelope(await response.json(), 503);
    expect(calls).toEqual([]);
  });

  it('returns a 503 envelope when EMAIL_FROM is not a valid address', async () => {
    const { app, calls } = buildApp({ from: 'not-an-address' });
    const response = await post(app, validBody);
    expect(response.status).toBe(503);
    expectEnvelope(await response.json(), 503);
    expect(calls).toEqual([]);
  });

  it('returns a 502 envelope when the binding rejects the dispatch', async () => {
    const { binding } = fakeBinding(async () => {
      throw new Error('upstream unavailable');
    });
    const app = createEmailWorkerApp({
      env: { EMAIL: binding, EMAIL_SEND_SECRET: SECRET, EMAIL_FROM: 'alerts@rajahinta.fi' },
    });

    const response = await post(app, validBody);

    expect(response.status).toBe(502);
    const body = (await response.json()) as Record<string, unknown>;
    expectEnvelope(body, 502);
    expect(body['error']).toBe('EmailDeliveryError');
    // Internals never leak into the message.
    expect(body['message']).not.toContain('upstream unavailable');
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('routing', () => {
  it('returns a 404 envelope for unknown paths', async () => {
    const { app } = buildApp();
    const response = await app.request('/internal/email/other', { method: 'POST' });
    expect(response.status).toBe(404);
    expectEnvelope(await response.json(), 404, '/internal/email/other');
  });

  it('returns a 405 envelope for non-POST methods on the send path', async () => {
    const { app } = buildApp();
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const response = await app.request('/internal/email/send', { method });
      expect(response.status).toBe(405);
      expectEnvelope(await response.json(), 405);
    }
  });
});
