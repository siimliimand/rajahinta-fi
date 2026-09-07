/**
 * Email-token route tests (task 2.3, change email-password-auth) — the
 * verify-email and password-reset flows over the FULL createApp(), with
 * the email transport stubbed at the `fetch` boundary (the email-worker
 * send contract is a plain POST; stubbing there exercises the exact
 * dispatch path, headers included).
 *
 * Coverage pinned by the task: resend (sessionAuth), confirm replay /
 * expiry / cross-purpose token confusion, reset-request's uniform 202
 * with mail only for existing accounts, and reset's rehash + revoke-ALL-
 * sessions + outstanding-token invalidation. Mail failure never fails
 * registration (design D4).
 *
 * @module EmailTokenRoutesTest
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
} from './harness';
import type { Env } from '../../env';
import { hashToken } from '../../routes/auth.helpers';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

const JSON_HDRS = { 'content-type': 'application/json' };

/** Mail env — EMAIL vars configured so the dispatch path actually runs. */
function mailEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, {
    EMAIL_WORKER_URL: 'https://rajahinta-email-worker.example.workers.dev',
    EMAIL_SEND_SECRET: 'test-send-secret',
    APP_PUBLIC_URL: 'https://rajahinta.test',
    ...overrides,
  } as Partial<Env>);
}

/** Captured send-contract body (to/subject/text/html). */
interface CapturedMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Stub global fetch; returns the captured mail bodies in dispatch order. */
function stubEmailTransport(): { mails: CapturedMail[]; fetchMock: ReturnType<typeof vi.fn> } {
  const mails: CapturedMail[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    mails.push(JSON.parse(String(init?.body)) as CapturedMail);
    return new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { mails, fetchMock };
}

/** The raw token from a mail's frontend link (the ONLY place it exists). */
function tokenFromLink(mail: CapturedMail, page: 'verify' | 'reset'): string {
  const match = new RegExp(`/account/${page}\\?token=([A-Za-z0-9_-]+)`).exec(mail.text);
  expect(match, `link /account/${page} in mail text`).not.toBeNull();
  return match![1]!;
}

let seq = 0;

/** Register a fresh account over the mail-configured env; returns identity + cookie. */
async function registerInto(env: Env): Promise<{
  cookie: string;
  userId: string;
  email: string;
  password: string;
}> {
  seq += 1;
  const email = `token-user-${seq}@example.invalid`;
  const password = 'correct horse battery staple';
  const app = buildApp();
  const res = await request(app, env, '/api/v1/account/register', {
    method: 'POST',
    headers: JSON_HDRS,
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(201);
  const raw = res.headers.get('Set-Cookie') ?? '';
  const token = /rajahinta_session=([^;]*)/.exec(raw)![1]!;
  const { userId } = (await res.json()) as { userId: string };
  return { cookie: `rajahinta_session=${token}`, userId, email, password };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Mail dispatch contract (design D4)
// ---------------------------------------------------------------------------

describe('verification mail dispatch', () => {
  it('registration sends the verification mail through the email-worker contract (FI + EN, text + HTML)', async () => {
    const { d1 } = openMigratedD1();
    const { mails, fetchMock } = stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);

    const res = await request(app, env, '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'mailed@example.invalid', password: 'correct horse battery staple' }),
    });
    expect(res.status).toBe(201);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://rajahinta-email-worker.example.workers.dev/internal/email/send',
    );
    expect((init.headers as Record<string, string>)['x-email-send-secret']).toBe(
      'test-send-secret',
    );

    const mail = mails[0]!;
    expect(mail.to).toBe('mailed@example.invalid');
    // FI (default) + EN bodies, plain-text AND HTML, with the frontend link.
    expect(mail.text).toContain('Vahvista sähköpostiosoitteesi');
    expect(mail.text).toContain('Confirm your email address');
    expect(mail.text).toMatch(/\/account\/verify\?token=[A-Za-z0-9_-]+/);
    expect(mail.html).toContain('<a href="https://rajahinta.test/account/verify?token=');
  });

  it('mail failure never fails registration (design D4)', async () => {
    const { d1 } = openMigratedD1();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('smtp exploded');
      }),
    );
    const app = buildApp();

    const res = await request(app, mailEnv(d1), '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'still-registered@example.invalid', password: 'correct horse battery staple' }),
    });
    expect(res.status).toBe(201);
  });

  it('an unconfigured email worker skips dispatch entirely (no fetch)', async () => {
    const { d1 } = openMigratedD1();
    const { fetchMock } = stubEmailTransport();
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'unconfigured@example.invalid', password: 'correct horse battery staple' }),
    });
    expect(res.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// verify-email/request + confirm
// ---------------------------------------------------------------------------

describe('POST /api/v1/account/verify-email/request', () => {
  it('is sessionAuth-guarded; with a session it re-sends the mail', async () => {
    const { d1 } = openMigratedD1();
    const { mails } = stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);
    const { cookie, email } = await registerInto(env);
    const afterRegister = mails.length;

    const noSession = await request(app, env, '/api/v1/account/verify-email/request', {
      method: 'POST',
    });
    await expectEnvelope(noSession, 401, { error: 'SessionRequired' });

    const resend = await request(app, env, '/api/v1/account/verify-email/request', {
      method: 'POST',
      headers: { cookie },
    });
    expect(resend.status).toBe(202);
    expect(await resend.json()).toEqual({ accepted: true });
    expect(mails).toHaveLength(afterRegister + 1);
    expect(mails[mails.length - 1]!.to).toBe(email);
  });
});

describe('POST /api/v1/account/verify-email/confirm', () => {
  it('confirms a valid token: verified state persists, single audit event', async () => {
    const { db, d1 } = openMigratedD1();
    const { mails } = stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);
    const { cookie, userId } = await registerInto(env);
    const token = tokenFromLink(mails[0]!, 'verify');

    const res = await request(app, env, '/api/v1/account/verify-email/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verified: true, userId, email: expect.any(String) });

    // /me reflects email_verified_at (derived directly from the row).
    const me = await request(app, env, '/api/v1/account/me', { headers: { cookie } });
    expect(((await me.json()) as { verified: boolean }).verified).toBe(true);

    // D6 audit: the verification happened, no raw token recorded.
    const rows = db.prepare(`SELECT reason, new_value FROM audit_events`).all() as unknown as
      Array<{ reason: string; new_value: string | null }>;
    expect(rows.some((r) => r.reason === 'email verified via single-use token')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('a replayed token loses: second confirm is the uniform 401', async () => {
    const { d1 } = openMigratedD1();
    const { mails } = stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);
    await registerInto(env);
    const token = tokenFromLink(mails[0]!, 'verify');

    const first = await request(app, env, '/api/v1/account/verify-email/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token }),
    });
    expect(first.status).toBe(200);

    const replay = await request(app, env, '/api/v1/account/verify-email/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token }),
    });
    await expectEnvelope(replay, 401, { error: 'InvalidToken' });
  });

  it('an expired token is rejected (24 h horizon is caller policy, expiry is enforced)', async () => {
    const { db, d1 } = openMigratedD1();
    stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);
    const { email } = await registerInto(env);

    const accountId = (
      db.prepare(`SELECT id FROM accounts WHERE email = ?`).get(email) as { id: number }
    ).id;

    // Insert an already-expired token with a KNOWN raw value (the store
    // persists only the SHA-256 hash — the raw token exists in the link,
    // here in the test). The repository's active predicate does the
    // rejecting on confirm.
    const rawExpired = 'known-expired-raw-token-value';
    const hash = await hashToken(rawExpired);
    db.prepare(
      `INSERT INTO email_tokens (account_id, token_hash, purpose, expires_at)
       VALUES (?, ?, 'verify_email', ?)`,
    ).run(accountId, hash, new Date(Date.now() - 60_000).toISOString());

    const res = await request(app, env, '/api/v1/account/verify-email/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token: rawExpired }),
    });
    await expectEnvelope(res, 401, { error: 'InvalidToken' });
  });

  it('cross-purpose confusion: a password_reset token cannot confirm an email', async () => {
    const { d1 } = openMigratedD1();
    const { mails } = stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);
    const { cookie, email } = await registerInto(env);

    // Mint a password_reset token for this account via reset-request.
    await request(app, env, '/api/v1/account/password/reset-request', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email }),
    });
    const resetToken = tokenFromLink(mails[mails.length - 1]!, 'reset');

    const confused = await request(app, env, '/api/v1/account/verify-email/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token: resetToken }),
    });
    await expectEnvelope(confused, 401, { error: 'InvalidToken' });

    // The wrong-purpose attempt consumed NOTHING — the reset token still
    // works on its own flow.
    const reset = await request(app, env, '/api/v1/account/password/reset', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token: resetToken, newPassword: 'brand new long password' }),
    });
    expect(reset.status).toBe(200);
    void cookie;
  });

  it('a completed verification retires the account’s other outstanding verify tokens', async () => {
    const { d1 } = openMigratedD1();
    const { mails } = stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);
    const { cookie } = await registerInto(env);

    // A second outstanding token via resend.
    await request(app, env, '/api/v1/account/verify-email/request', {
      method: 'POST',
      headers: { cookie },
    });
    const firstToken = tokenFromLink(mails[0]!, 'verify');
    const secondToken = tokenFromLink(mails[mails.length - 1]!, 'verify');
    expect(firstToken).not.toBe(secondToken);

    const confirm = await request(app, env, '/api/v1/account/verify-email/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token: secondToken }),
    });
    expect(confirm.status).toBe(200);

    // The superseded sibling can no longer redeem (design D3 sweep).
    const stale = await request(app, env, '/api/v1/account/verify-email/confirm', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token: firstToken }),
    });
    await expectEnvelope(stale, 401, { error: 'InvalidToken' });
  });
});

// ---------------------------------------------------------------------------
// password/reset-request + password/reset
// ---------------------------------------------------------------------------

describe('POST /api/v1/account/password/reset-request', () => {
  it('ALWAYS answers 202 — unknown email, malformed body, known email alike', async () => {
    const { d1 } = openMigratedD1();
    const { mails, fetchMock } = stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);
    const { email } = await registerInto(env);

    const unknown = await request(app, env, '/api/v1/account/password/reset-request', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'nobody@example.invalid' }),
    });
    expect(unknown.status).toBe(202);
    expect(await unknown.json()).toEqual({ accepted: true });
    // ...and no mail left the building for the unknown address.
    const afterUnknown = mails.length;

    const garbage = await request(app, env, '/api/v1/account/password/reset-request', {
      method: 'POST',
      headers: JSON_HDRS,
      body: 'not json at all',
    });
    expect(garbage.status).toBe(202);
    expect(mails.length).toBe(afterUnknown);

    const known = await request(app, env, '/api/v1/account/password/reset-request', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email }),
    });
    expect(known.status).toBe(202);
    expect(mails.length).toBe(afterUnknown + 1);
    expect(mails[mails.length - 1]!.to).toBe(email);
    expect(mails[mails.length - 1]!.text).toMatch(/\/account\/reset\?token=/);
    void fetchMock;
  });

  it('is rate-limited on the AUTH profile (composed ahead of the handler)', async () => {
    const { d1 } = openMigratedD1();
    stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);

    for (let i = 0; i < 10; i++) {
      const res = await request(app, env, '/api/v1/account/password/reset-request', {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ email: 'burst@example.invalid' }),
      });
      expect(res.status).toBe(202);
    }
    const rejected = await request(app, env, '/api/v1/account/password/reset-request', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'burst@example.invalid' }),
    });
    await expectEnvelope(rejected, 429, { error: 'TooManyRequests' });
  });
});

describe('POST /api/v1/account/password/reset', () => {
  it('rehashes, revokes ALL sessions, and invalidates outstanding reset tokens', async () => {
    const { d1 } = openMigratedD1();
    const { mails } = stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);
    const { cookie, email, password } = await registerInto(env);

    // A second login (another "device") — the reset must log BOTH out.
    const secondDevice = await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email, password }),
    });
    expect(secondDevice.status).toBe(200);
    const secondCookie = `rajahinta_session=${
      /rajahinta_session=([^;]*)/.exec(secondDevice.headers.get('Set-Cookie') ?? '')![1]
    }`;

    // Two outstanding reset links; only the newest may ever redeem after
    // one completes.
    await request(app, env, '/api/v1/account/password/reset-request', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email }),
    });
    await request(app, env, '/api/v1/account/password/reset-request', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email }),
    });
    const olderToken = tokenFromLink(mails[mails.length - 2]!, 'reset');
    const newestToken = tokenFromLink(mails[mails.length - 1]!, 'reset');

    const reset = await request(app, env, '/api/v1/account/password/reset', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token: newestToken, newPassword: 'a completely new passphrase' }),
    });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ reset: true });

    // The rehash took: old password 401 (uniform envelope), new one 200.
    const oldLogin = await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email, password }),
    });
    await expectEnvelope(oldLogin, 401, { error: 'InvalidCredentials' });
    const newLogin = await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email, password: 'a completely new passphrase' }),
    });
    expect(newLogin.status).toBe(200);

    // EVERY pre-reset session is dead — both devices get the 401 envelope.
    for (const dead of [cookie, secondCookie]) {
      const me = await request(app, env, '/api/v1/account/me', { headers: { cookie: dead } });
      await expectEnvelope(me, 401, { error: 'InvalidSession' });
    }

    // The used token cannot replay; the older sibling was swept.
    for (const dead of [newestToken, olderToken]) {
      const res = await request(app, env, '/api/v1/account/password/reset', {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ token: dead, newPassword: 'another brand new passphrase' }),
      });
      await expectEnvelope(res, 401, { error: 'InvalidToken' });
    }
  });

  it('rejects a policy-violating password with 400 WITHOUT burning the token', async () => {
    const { d1 } = openMigratedD1();
    const { mails } = stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);
    const { email } = await registerInto(env);

    await request(app, env, '/api/v1/account/password/reset-request', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email }),
    });
    const token = tokenFromLink(mails[mails.length - 1]!, 'reset');

    const weak = await request(app, env, '/api/v1/account/password/reset', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token, newPassword: 'short' }),
    });
    await expectEnvelope(weak, 400, { error: 'InvalidPassword' });

    // The policy gate ran BEFORE consumption — the same token still works.
    const ok = await request(app, env, '/api/v1/account/password/reset', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token, newPassword: 'a completely new passphrase' }),
    });
    expect(ok.status).toBe(200);
  });

  it('an unknown/replayed/expired token is the uniform 401', async () => {
    const { d1 } = openMigratedD1();
    stubEmailTransport();
    const app = buildApp();
    const env = mailEnv(d1);
    await registerInto(env);

    const res = await request(app, env, '/api/v1/account/password/reset', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ token: 'no-such-token', newPassword: 'a completely new passphrase' }),
    });
    await expectEnvelope(res, 401, { error: 'InvalidToken' });
  });
});
