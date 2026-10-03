/**
 * Contact route tests (task 3.2, change first-impression-pass; design
 * D8, spec contact-intake) — POST /api/v1/contact over the full
 * createApp() harness (fake D1 with the committed migrations + real
 * RateLimiterDO), both body dialects:
 *
 * - JSON callers: uniform 202 ack, unified error envelopes.
 * - Form-encoded (the no-JS HTML form): 303 redirects to the page's
 *   rendered ack (?sent=1) or error (?error=<code>) state.
 *
 * Honesty + data-minimization pins:
 * - the honeypot (`website`) answers the SAME ack as a human success
 *   and stores nothing — no bot oracle;
 * - the stored row carries the salted HMAC of the source IP (pinned
 *   against node:crypto), never the raw address;
 * - rate limiting is per-source (429 envelope for JSON, rendered
 *   redirect for form), and rejections store nothing.
 *
 * @module ContactRoutesTest
 */

import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
} from './harness';
import type { Env } from '../../env';

const IP = '203.0.113.9';
const SALT = 'contact-test-salt';
const IP_HEADER = { 'cf-connecting-ip': IP } as const;
const JSON_HEADERS = { 'content-type': 'application/json', ...IP_HEADER } as const;
const FORM_HEADERS = {
  'content-type': 'application/x-www-form-urlencoded',
  ...IP_HEADER,
} as const;

/** Expected stored hash — HMAC-SHA-256(salt, ip) hex, the route's contract. */
function expectedIpHash(salt: string, ip: string): string {
  return createHmac('sha256', salt).update(ip).digest('hex');
}

function contactEnv(overrides: Partial<Env> = {}): {
  env: Env;
  db: DatabaseSync;
} {
  const { db, d1 } = openMigratedD1();
  return {
    env: permissiveEnv(d1, { CONTACT_IP_HASH_SALT: SALT, ...overrides }),
    db,
  };
}

/** Every stored row, full columns. */
function rows(db: DatabaseSync): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM contact_messages ORDER BY id')
    .all() as Record<string, unknown>[];
}

function postJson(
  app: ReturnType<typeof buildApp>,
  env: Env,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return request(app, env, '/api/v1/contact', {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function postForm(
  app: ReturnType<typeof buildApp>,
  env: Env,
  fields: Record<string, string>,
): Promise<Response> {
  return request(app, env, '/api/v1/contact', {
    method: 'POST',
    headers: FORM_HEADERS,
    body: new URLSearchParams(fields),
  });
}

const VALID_JSON = {
  message: 'Hinnassa on virhe: Karhu III 0,33l näkyy 0,00 €.',
  topic: 'product_error',
  reply_email: 'sender@example.com',
  locale: 'fi',
} as const;

const VALID_FORM: Record<string, string> = {
  message: 'Kysymys Tallinnan lauttahinnoista.',
  topic: 'store_inquiry',
  locale: 'fi',
};

describe('POST /api/v1/contact — JSON path', () => {
  it('acknowledges uniformly (202 received) and stores the message', async () => {
    const { env, db } = contactEnv();
    const res = await postJson(buildApp(), env, { ...VALID_JSON });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'received' });

    const stored = rows(db);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      message: VALID_JSON.message,
      topic: 'product_error',
      reply_email: 'sender@example.com',
      locale: 'fi',
    });
  });

  it('defaults the locale to fi and stores a blank reply email as NULL', async () => {
    const { env, db } = contactEnv();
    const res = await postJson(buildApp(), env, {
      message: 'Ilman sähköpostia — yksisuuntainen viesti.',
      topic: 'other',
      reply_email: '   ',
    });

    expect(res.status).toBe(202);
    expect(rows(db)[0]).toMatchObject({ locale: 'fi', reply_email: null });
  });

  it('stores a salted HMAC of the source IP — never the raw address', async () => {
    const { env, db } = contactEnv();
    await postJson(buildApp(), env, { ...VALID_JSON });

    const stored = rows(db)[0]!;
    const ipHash = String(stored.ip_hash);
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    // The pinned salted digest — and provably not the raw address or an
    // unsalted SHA-256 of it.
    expect(ipHash).toBe(expectedIpHash(SALT, IP));
    expect(ipHash).not.toContain(IP);
    for (const value of Object.values(stored)) {
      expect(String(value)).not.toContain(IP);
    }
  });

  it('same IP + same salt hashes identically; a different salt hashes differently', async () => {
    const app = buildApp();
    const first = contactEnv();
    await postJson(app, first.env, { ...VALID_JSON });
    await postJson(app, first.env, { ...VALID_JSON, message: 'Toinen viesti.' });
    const second = contactEnv({ CONTACT_IP_HASH_SALT: 'other-salt' });
    await postJson(app, second.env, { ...VALID_JSON });

    const [row1, row2] = rows(first.db);
    expect(row1!.ip_hash).toBe(row2!.ip_hash);
    expect(rows(second.db)[0]!.ip_hash).not.toBe(row1!.ip_hash);
  });

  it('rejects an oversized message with a clear validation error and stores nothing', async () => {
    const { env, db } = contactEnv();
    const res = await postJson(buildApp(), env, {
      ...VALID_JSON,
      message: 'a'.repeat(5001),
    });

    await expectEnvelope(res, 400, { error: 'ValidationError' });
    expect(rows(db)).toHaveLength(0);
  });

  it('rejects a body past the request-size cap with 413', async () => {
    const { env, db } = contactEnv();
    // The declared length — real clients always send it; the harness's
    // app.request() does not synthesize it, so it is pinned explicitly.
    const res = await postJson(
      buildApp(),
      env,
      { ...VALID_JSON, message: 'a'.repeat(20_000) },
      { 'content-length': '99999' },
    );

    await expectEnvelope(res, 413, { error: 'PayloadTooLarge' });
    expect(rows(db)).toHaveLength(0);
  });

  it('rejects a malformed reply email (InvalidEmail) and an unknown topic', async () => {
    const app = buildApp();
    const { env, db } = contactEnv();

    const badEmail = await postJson(app, env, {
      ...VALID_JSON,
      reply_email: 'not-an-email',
    });
    await expectEnvelope(badEmail, 400, { error: 'InvalidEmail' });

    const badTopic = await postJson(app, env, {
      ...VALID_JSON,
      topic: 'hello',
    });
    await expectEnvelope(badTopic, 400, { error: 'ValidationError' });

    const emptyMessage = await postJson(app, env, { ...VALID_JSON, message: '   ' });
    await expectEnvelope(emptyMessage, 400, { error: 'ValidationError' });

    expect(rows(db)).toHaveLength(0);
  });

  it('fails closed without the salt — 500, nothing stored', async () => {
    const { env, db } = contactEnv({ CONTACT_IP_HASH_SALT: undefined });
    const res = await postJson(buildApp(), env, { ...VALID_JSON });

    await expectEnvelope(res, 500, {});
    expect(rows(db)).toHaveLength(0);
  });
});

describe('POST /api/v1/contact — form path (no-JS native POST)', () => {
  it('redirects 303 to the rendered ack state and stores the message', async () => {
    const { env, db } = contactEnv();
    const res = await postForm(buildApp(), env, VALID_FORM);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://rajahinta.fi/contact?sent=1');
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({
      message: VALID_FORM.message,
      topic: 'store_inquiry',
      reply_email: null,
      locale: 'fi',
    });
  });

  it('discards a honeypot fill with the uniform ack — no row, no error', async () => {
    const app = buildApp();
    const { env, db } = contactEnv();

    const form = await postForm(app, env, { ...VALID_FORM, website: 'spam.example' });
    expect(form.status).toBe(303);
    expect(form.headers.get('location')).toBe('https://rajahinta.fi/contact?sent=1');

    const json = await postJson(app, env, { ...VALID_JSON, website: 'spam.example' });
    expect(json.status).toBe(202);
    // Byte-identical to a human success — the endpoint is not a bot oracle.
    expect(await json.text()).toBe(JSON.stringify({ status: 'received' }));

    expect(rows(db)).toHaveLength(0);
  });

  it('renders validation failures as the error-state redirect', async () => {
    const app = buildApp();
    const { env, db } = contactEnv();

    const invalid = await postForm(app, env, { ...VALID_FORM, topic: 'hello' });
    expect(invalid.status).toBe(303);
    expect(invalid.headers.get('location')).toBe('https://rajahinta.fi/contact?error=invalid');

    const badEmail = await postForm(app, env, {
      ...VALID_FORM,
      reply_email: 'not-an-email',
    });
    expect(badEmail.headers.get('location')).toBe('https://rajahinta.fi/contact?error=email');

    const oversize = await postForm(app, env, {
      ...VALID_FORM,
      message: 'a'.repeat(5001),
    });
    expect(oversize.headers.get('location')).toBe('https://rajahinta.fi/contact?error=size');

    const hugeBody = await postForm(app, env, {
      ...VALID_FORM,
      message: 'a'.repeat(20_000),
    });
    expect(hugeBody.status).toBe(303);
    expect(hugeBody.headers.get('location')).toBe('https://rajahinta.fi/contact?error=size');

    expect(rows(db)).toHaveLength(0);
  });

  it('answers a rate-limited form submit with the error-state redirect', async () => {
    const app = buildApp();
    const { env, db } = contactEnv();
    // The CONTACT profile admits 5 per 10 min per source.
    for (let i = 0; i < 5; i++) {
      const res = await postJson(app, env, { ...VALID_JSON, message: `Viesti ${i}` });
      expect(res.status).toBe(202);
    }

    const json = await postJson(app, env, { ...VALID_JSON });
    await expectEnvelope(json, 429, { error: 'TooManyRequests' });

    const form = await postForm(app, env, VALID_FORM);
    expect(form.status).toBe(303);
    expect(form.headers.get('location')).toBe('https://rajahinta.fi/contact?error=rate_limited');

    expect(rows(db)).toHaveLength(5);
  });
});
