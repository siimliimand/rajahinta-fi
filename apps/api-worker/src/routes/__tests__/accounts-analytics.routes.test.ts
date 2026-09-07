/**
 * Accounts + analytics route parity tests (tasks 3.7, 2.2).
 *
 * Expectations ported from:
 * - packages/application-api/src/accounts/__tests__/session.controller.test.ts
 *   and session-security.test.ts (session shape, cookie flags, rotation
 *   invalidates the predecessor, revoke clears the cookie),
 * - account.controller.test.ts / gdpr-integration.test.ts (export shape),
 * - account-scenarios.controller.test.ts / account-history.controller.test.ts
 *   (upsert-by-name, account-scoped deletes, history claim semantics),
 * - analytics/__tests__/analytics.controller.test.ts and
 *   outbound-redirect.controller.test.ts (payload policy, count report,
 *   redirect).
 *
 * Task 2.2 (change email-password-auth): the anonymous
 * `POST /api/v1/account/session` issuance route is DELETED — sessions are
 * issued by `POST /register` / `POST /login` (credential routes), which
 * these suites drive directly. Coverage here: register/login happy paths,
 * lowercase normalization, duplicate-email 409, enumeration-identical
 * login 401s (unknown email vs wrong password, empty-hash fail-safe),
 * `/me`, the AUTH rate-limit profile and its composition order, and the
 * durable audit_events security trail (D6 — never the password, never a
 * raw token). The email-token flows (verify/reset) live in
 * email-token.routes.test.ts.
 *
 * @module AccountsAnalyticsRoutesTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
  seedCalculationRecord,
  seedOffer,
  seedProduct,
  lockedEnv,
} from './harness';
import type { Env } from '../../env';

const AGE = { 'x-age-confirmed': 'confirmed' };
const JSON_HDRS = { 'content-type': 'application/json', ...AGE };

/** Extract the issued cookie's token value from a Set-Cookie header. */
function sessionCookieOf(res: Response): { raw: string; token: string } {
  const raw = res.headers.get('Set-Cookie') ?? '';
  const match = /rajahinta_session=([^;]*)/.exec(raw);
  expect(match).not.toBeNull();
  return { raw, token: match![1]! };
}

let registerSeq = 0;

/**
 * Register a fresh account against the app and return its session cookie
 * + identity. The replacement for the deleted anonymous-issuance helper —
 * every authenticated flow in this file starts from a real registration.
 */
async function registerInto(
  env: Env,
  app: ReturnType<typeof buildApp>,
  overrides: { email?: string; password?: string } = {},
): Promise<{ cookie: string; userId: string; email: string; password: string }> {
  registerSeq += 1;
  const email = overrides.email ?? `user-${registerSeq}@example.invalid`;
  const password = overrides.password ?? 'correct horse battery staple';
  const res = await request(app, env, '/api/v1/account/register', {
    method: 'POST',
    headers: JSON_HDRS,
    body: JSON.stringify({ email, password }),
  });
  expect(res.status, `register ${email}`).toBe(201);
  const body = (await res.json()) as { userId: string };
  return {
    cookie: `rajahinta_session=${sessionCookieOf(res).token}`,
    userId: body.userId,
    email,
    password,
  };
}

/** All audit rows, oldest first — the D6 trail assertions read these. */
function auditRows(db: DatabaseSync): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT entity_type, entity_id, action, author, reason, new_value
         FROM audit_events ORDER BY occurred_at ASC, id ASC`,
    )
    .all() as unknown as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Credential routes — register / login / me (task 2.2, design D2)
// ---------------------------------------------------------------------------

describe('POST /api/v1/account/register', () => {
  it('creates the account and issues a session: 201, httpOnly cookie, no token in the body', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'me@example.invalid', password: 'correct horse battery staple' }),
    });
    expect(res.status).toBe(201);
    const { raw, token } = sessionCookieOf(res);
    for (const flag of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) {
      expect(raw).toContain(flag);
    }
    expect(raw).not.toMatch(/domain=/i);

    const body = (await res.json()) as { userId: string; expiresAt: string; verified: boolean };
    expect(body.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(body.verified).toBe(false); // email_verified_at is null until the token flow
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The session token never appears in a response body.
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('normalizes the email to lowercase — case variants are one identity', async () => {
    const { db, d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const registered = await request(app, env, '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'Mixed@Case.EXAMPLE.invalid', password: 'correct horse battery staple' }),
    });
    expect(registered.status).toBe(201);
    const { userId } = (await registered.json()) as { userId: string };

    // Stored lowercase-canonical (the lower(email) unique index's form).
    const row = db.prepare(`SELECT email FROM accounts WHERE user_id = ?`).get(userId) as
      | { email: string }
      | undefined;
    expect(row?.email).toBe('mixed@case.example.invalid');

    // Login with a different case resolves the same account.
    const login = await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'MIXED@case.example.invalid', password: 'correct horse battery staple' }),
    });
    expect(login.status).toBe(200);
    expect(((await login.json()) as { userId: string }).userId).toBe(userId);
  });

  it('rejects duplicate emails with 409 — across case variants too', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const password = 'correct horse battery staple';

    const first = await request(app, env, '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'dupe@example.invalid', password }),
    });
    expect(first.status).toBe(201);

    const duplicate = await request(app, env, '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'dupe@example.invalid', password }),
    });
    await expectEnvelope(duplicate, 409, {
      message: 'Email already registered.',
      error: 'EmailAlreadyRegistered',
    });

    const caseVariant = await request(app, env, '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'DUPE@example.invalid', password }),
    });
    await expectEnvelope(caseVariant, 409, { error: 'EmailAlreadyRegistered' });
  });

  it('validates email format and the 12–128 password policy (400, before any hashing side effect)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    const badEmail = await request(app, env, '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'not-an-email', password: 'correct horse battery staple' }),
    });
    await expectEnvelope(badEmail, 400, {
      message: '"email" is required and must be a valid email address',
      error: 'InvalidEmail',
    });

    const shortPassword = await request(app, env, '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'me@example.invalid', password: 'short' }),
    });
    await expectEnvelope(shortPassword, 400, { error: 'InvalidPassword' });
  });

  it('appends register success (and duplicate rejection) to audit_events — never the password', async () => {
    const { db, d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const password = 'correct horse battery staple';

    await request(app, env, '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'audited@example.invalid', password }),
    });
    await request(app, env, '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'audited@example.invalid', password }),
    });

    const rows = auditRows(db);
    expect(rows.some((r) => r.reason === 'account registered' && r.action === 'created')).toBe(true);
    expect(
      rows.some((r) => r.reason === 'registration rejected: email already registered'),
    ).toBe(true);
    // D6: never log the password (or any credential material).
    expect(JSON.stringify(rows)).not.toContain(password);
  });
});

describe('POST /api/v1/account/login', () => {
  it('logs in with the registered credential: 200, cookie set, verified flag from the account row', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { email, password } = await registerInto(env, app);

    const res = await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    const { raw, token } = sessionCookieOf(res);
    expect(raw).toContain('HttpOnly');
    expect(JSON.stringify(await res.json())).not.toContain(token);

    // The issued cookie authenticates the account endpoints.
    const me = await request(app, env, '/api/v1/account/me', {
      headers: { cookie: `rajahinta_session=${token}` },
    });
    expect(me.status).toBe(200);
  });

  it('answers unknown email and wrong password with the IDENTICAL 401 envelope', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    await registerInto(env, app, { email: 'known@example.invalid' });

    const unknownEmail = await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'who@example.invalid', password: 'correct horse battery staple' }),
    });
    const wrongPassword = await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'known@example.invalid', password: 'wrong horse battery staple' }),
    });

    const unknownBody = await expectEnvelope(unknownEmail, 401, {
      message: 'Invalid email or password.',
      error: 'InvalidCredentials',
    });
    const wrongBody = await expectEnvelope(wrongPassword, 401, {
      message: 'Invalid email or password.',
      error: 'InvalidCredentials',
    });
    // Enumeration resistance: strip the per-request envelope fields and
    // the two failure modes must be byte-identical.
    const stable = (b: Record<string, unknown>) =>
      JSON.stringify({ ...b, timestamp: undefined, path: undefined });
    expect(stable(unknownBody)).toBe(stable(wrongBody));
  });

  it('fails safe on an empty stored hash: 401, never 500, never authenticated', async () => {
    const { db, d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    // Migration 0014 backfills pre-credential rows with '' — a stray row
    // must fail CLOSED (design D7).
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO accounts (id, user_id, email, password_hash, tier, created_at, last_active_at)
       VALUES (501, 'user-501', 'hashless@example.invalid', '', 'FREE', ?, ?)`,
    ).run(now, now);

    const res = await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'hashless@example.invalid', password: 'correct horse battery staple' }),
    });
    await expectEnvelope(res, 401, { error: 'InvalidCredentials' });
  });

  it('appends login success + failure security events (D6) — actor is the userId', async () => {
    const { db, d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { userId, email, password } = await registerInto(env, app, { email: 'login-audit@example.invalid' });

    await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email, password: 'wrong horse battery staple' }),
    });
    await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email, password }),
    });
    await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'unknown@example.invalid', password }),
    });

    const rows = auditRows(db);
    const failure = rows.find((r) => r.reason === 'login failed: invalid credentials');
    expect(failure).toBeDefined();
    expect(failure!.entity_type).toBe('account_session');
    expect(JSON.stringify(rows)).not.toContain(password);

    const success = rows.find((r) => r.reason === 'login succeeded');
    expect(success).toBeDefined();
    expect(success!.entity_id).toBe(userId);
    expect(success!.author).toBe(userId);
  });
});

describe('GET /api/v1/account/me', () => {
  it('returns { userId, email, verified } from the account row (sessionAuth)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie, userId, email } = await registerInto(env, app);

    const res = await request(app, env, '/api/v1/account/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId, email, verified: false });
  });

  it('requires a session', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const noSession = await request(app, lockedEnv(d1), '/api/v1/account/me');
    await expectEnvelope(noSession, 401, { error: 'SessionRequired' });
  });
});

// ---------------------------------------------------------------------------
// AUTH rate limit (design D5) and its composition order
// ---------------------------------------------------------------------------

describe('AUTH rate-limit profile (register/login/reset-request)', () => {
  it('admits 10 AUTH requests per 5 min, then rejects the handler with the 429 envelope', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    // 10 failed logins (handler reached → 401 each) exhaust the bucket.
    for (let i = 0; i < 10; i++) {
      const attempt = await request(app, env, '/api/v1/account/login', {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ email: 'who@example.invalid', password: 'wrong horse battery staple' }),
      });
      expect(attempt.status).toBe(401);
    }

    // The 11th never reaches the handler — the limiter (composed AHEAD of
    // the route in the guard table) rejects with the guard's 429 shape.
    const rejected = await request(app, env, '/api/v1/account/login', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'who@example.invalid', password: 'wrong horse battery staple' }),
    });
    await expectEnvelope(rejected, 429, { error: 'TooManyRequests' });
    expect(rejected.headers.get('Retry-After')).toBeTruthy();
  });

  it('the AUTH bucket is its own window — exhausting it leaves DEFAULT routes untouched', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);

    for (let i = 0; i < 10; i++) {
      await request(app, env, '/api/v1/account/register', {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ email: `burst-${i}@example.invalid`, password: 'correct horse battery staple' }),
      });
    }
    const authExhausted = await request(app, env, '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'burst-over@example.invalid', password: 'correct horse battery staple' }),
    });
    expect(authExhausted.status).toBe(429);

    // A DEFAULT-profile route still admits (profile windows are isolated).
    const click = await request(app, env, '/api/v1/analytics/click', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ merchantId: 'alko', url: 'https://example.invalid/karhu' }),
    });
    expect(click.status).toBe(200);
  });

  it('composition order on rotate: sessionAuth runs BEFORE the rate limit (Nest guard order)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    // Without a cookie the guard rejects — the limiter never admits these,
    // and repeated unauthenticated calls keep hitting the guard's 401, not
    // the handler's output or a limiter state change.
    for (let i = 0; i < 3; i++) {
      const denied = await request(app, lockedEnv(d1), '/api/v1/account/session/rotate', {
        method: 'POST',
      });
      await expectEnvelope(denied, 401, { error: 'SessionRequired' });
    }
  });
});

// ---------------------------------------------------------------------------
// Deleted anonymous surfaces
// ---------------------------------------------------------------------------

describe('removed anonymous-account endpoints', () => {
  it('POST /api/v1/account/session is gone — register/login are the only issuance', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/account/session', {
      method: 'POST',
    });
    await expectEnvelope(res, 404, { message: 'Cannot POST /api/v1/account/session' });
  });

  it('the self-asserted POST /api/v1/account/verify-email is gone', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie } = await registerInto(env, app);
    const res = await request(app, env, '/api/v1/account/verify-email', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({ email: 'me@example.invalid' }),
    });
    await expectEnvelope(res, 404, { message: 'Cannot POST /api/v1/account/verify-email' });
  });
});

// ---------------------------------------------------------------------------
// Session cookie lifecycle (rotate + logout) over credential sessions
// ---------------------------------------------------------------------------

describe('session cookie attributes — Workers deployment (task 5.2)', () => {
  const EXPECTED_FLAGS = ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];

  it('issues with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain attribute', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/account/register', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ email: 'flags@example.invalid', password: 'correct horse battery staple' }),
    });
    expect(res.status).toBe(201);
    const { raw } = sessionCookieOf(res);
    for (const flag of EXPECTED_FLAGS) {
      expect(raw).toContain(flag);
    }
    expect(raw).not.toMatch(/domain=/i);
  });

  it('keeps the same flags on the rotated cookie', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie } = await registerInto(env, app);

    const rotated = await request(app, env, '/api/v1/account/session/rotate', {
      method: 'POST',
      headers: { cookie },
    });
    expect(rotated.status).toBe(200);
    const { raw } = sessionCookieOf(rotated);
    for (const flag of EXPECTED_FLAGS) {
      expect(raw).toContain(flag);
    }
    expect(raw).not.toMatch(/domain=/i);
  });

  it('clears the cookie on logout with the same Secure host-only shape', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie } = await registerInto(env, app);

    const logout = await request(app, env, '/api/v1/account/session', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(logout.status).toBe(200);
    const cleared = logout.headers.get('Set-Cookie') ?? '';
    for (const flag of EXPECTED_FLAGS) {
      expect(cleared).toContain(flag);
    }
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).not.toMatch(/domain=/i);
  });
});

describe('POST /api/v1/account/session/rotate + DELETE /session', () => {
  it('rotates atomically: the old token stops authenticating immediately', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie, userId } = await registerInto(env, app);

    const rotated = await request(app, env, '/api/v1/account/session/rotate', {
      method: 'POST',
      headers: { cookie },
    });
    expect(rotated.status).toBe(200);
    const second = sessionCookieOf(rotated);
    expect(second.token).not.toBe(cookie);
    const rotatedBody = (await rotated.json()) as { userId: string; verified: boolean };
    expect(rotatedBody.userId).toBe(userId);
    expect(rotatedBody.verified).toBe(false);

    // The predecessor is dead — a rotated token never mints a successor.
    const stale = await request(app, env, '/api/v1/account/session/rotate', {
      method: 'POST',
      headers: { cookie },
    });
    await expectEnvelope(stale, 401, { error: 'InvalidSession' });

    // The successor authenticates.
    const ok = await request(app, env, '/api/v1/account/subscription', {
      headers: { cookie: `rajahinta_session=${second.token}` },
    });
    expect(ok.status).toBe(200);
  });

  it('revokes on logout and clears the cookie', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie } = await registerInto(env, app);

    const logout = await request(app, env, '/api/v1/account/session', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ revoked: true });
    const cleared = logout.headers.get('Set-Cookie') ?? '';
    expect(cleared).toContain('Max-Age=0');

    // The revoked token no longer authenticates.
    const after = await request(app, env, '/api/v1/account/subscription', {
      headers: { cookie },
    });
    await expectEnvelope(after, 401, { error: 'InvalidSession' });
  });
});

// ---------------------------------------------------------------------------
// Account data — baskets, history, subscription, GDPR export
// ---------------------------------------------------------------------------

describe('account data endpoints', () => {
  it('saves and lists baskets with the persisted identity', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie } = await registerInto(env, app);

    const saved = await request(app, env, '/api/v1/account/baskets', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'Weekend',
        items: [{ productId: 1, productName: 'Karhu III', quantity: 6 }],
      }),
    });
    expect(saved.status).toBe(201);

    const list = await request(app, env, '/api/v1/account/baskets', {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const baskets = (await list.json()) as Array<Record<string, any>>;
    expect(baskets).toHaveLength(1);
    expect(baskets[0]!.name).toBe('Weekend');
    expect(baskets[0]!.items).toEqual([
      { productId: 1, productName: 'Karhu III', quantity: 6 },
    ]);
  });

  it('rejects basket deletion for non-UUID ids (ParseUUIDPipe parity) and unknown ids with 404', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie } = await registerInto(env, app);

    const bad = await request(app, env, '/api/v1/account/baskets/not-a-uuid', {
      method: 'DELETE',
      headers: { cookie },
    });
    await expectEnvelope(bad, 400, {
      message: 'Validation failed (uuid is expected)',
      error: 'Bad Request',
    });

    const missing = await request(
      app,
      env,
      '/api/v1/account/baskets/00000000-0000-4000-8000-000000000000',
      { method: 'DELETE', headers: { cookie } },
    );
    await expectEnvelope(missing, 404, { error: 'BasketNotFound' });
  });

  it('claims calculation records for history — first claim wins', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedCalculationRecord(db, { id: 42, productMasterId: 1 });
    const app = buildApp();
    const env = permissiveEnv(d1);
    const first = await registerInto(env, app);
    const second = await registerInto(env, app);

    const add = await request(app, env, '/api/v1/account/history', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie: first.cookie },
      body: JSON.stringify({ recordId: 42 }),
    });
    expect(add.status).toBe(201);
    expect(await add.json()).toEqual({ success: true, recordId: 42 });

    // A replay of the same record id to another session is idempotent and
    // never re-assigns ownership.
    const replay = await request(app, env, '/api/v1/account/history', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie: second.cookie },
      body: JSON.stringify({ recordId: 42 }),
    });
    expect(replay.status).toBe(201);

    const mine = await request(app, env, '/api/v1/account/history', {
      headers: { cookie: first.cookie },
    });
    expect(await mine.json()).toEqual([42]);

    const theirs = await request(app, env, '/api/v1/account/history', {
      headers: { cookie: second.cookie },
    });
    expect(await theirs.json()).toEqual([]);

    const invalid = await request(app, env, '/api/v1/account/history', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie: first.cookie },
      body: JSON.stringify({ recordId: 0 }),
    });
    await expectEnvelope(invalid, 400, {
      message: 'recordId must be a positive integer',
      error: 'InvalidRecordId',
    });
  });

  it('exports the full GDPR payload: account, baskets, scenarios, history, subscription', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedCalculationRecord(db, { id: 7, productMasterId: 1 });
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie, userId, email } = await registerInto(env, app);

    await request(app, env, '/api/v1/account/history', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({ recordId: 7 }),
    });
    await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'Cheap beer',
        inputs: { productId: 1, quantity: 6, destination: 'FI' },
      }),
    });

    const res = await request(app, env, '/api/v1/account/export', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const exported = (await res.json()) as Record<string, any>;

    expect(exported.userId).toBe(userId);
    expect(exported.exportDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(exported.account).toMatchObject({
      userId,
      email,
      tier: 'FREE',
    });
    expect(exported.savedBaskets).toEqual([]);
    expect(exported.savedScenarios).toHaveLength(1);
    expect(exported.savedScenarios[0]!.name).toBe('Cheap beer');
    expect(exported.calculationHistory).toHaveLength(1);
    expect(exported.calculationHistory[0]).toMatchObject({
      calculationId: 7,
      totalCents: 873,
      quantity: 1,
    });
    expect(exported.subscription).toEqual({ userId, plan: 'FREE', active: true });
  });

  it('returns the FREE-tier subscription status', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie, userId } = await registerInto(env, app);

    const res = await request(app, env, '/api/v1/account/subscription', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId, plan: 'FREE', active: true });
  });
});

// ---------------------------------------------------------------------------
// Scenarios (session-guarded; flag removed)
// ---------------------------------------------------------------------------

describe('account scenarios', () => {
  it('stays session-guarded', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const noSession = await request(app, lockedEnv(d1), '/api/v1/account/scenarios');
    await expectEnvelope(noSession, 401, { error: 'SessionRequired' });
  });

  it('upserts by name and returns the persisted scenario (201)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const { cookie } = await registerInto(env, app);

    const invalid = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({ name: '', inputs: { productId: 1 } }),
    });
    await expectEnvelope(invalid, 400, {
      message: 'name must be a non-empty string',
      error: 'InvalidScenarioRequest',
    });

    const badInputs = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'X',
        inputs: { productId: 1, quantity: 6, destination: '', transportArrangement: 'TELEPORT' },
      }),
    });
    // The controller's fail() throws on the FIRST violation — one message.
    await expectEnvelope(badInputs, 400, {
      message: 'inputs.destination must be a non-empty string',
      error: 'InvalidScenarioRequest',
    });

    const badArrangement = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'X',
        inputs: { productId: 1, quantity: 6, destination: 'FI', transportArrangement: 'TELEPORT' },
      }),
    });
    await expectEnvelope(badArrangement, 400, {
      message:
        'inputs.transportArrangement must be one of SELLER_ARRANGED, INDEPENDENT_CARRIER, PERSONAL when provided',
      error: 'InvalidScenarioRequest',
    });

    const created = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'Cheap beer',
        inputs: { productId: 1, quantity: 6, destination: 'FI' },
      }),
    });
    expect(created.status).toBe(201);
    const scenario = (await created.json()) as Record<string, any>;
    expect(scenario.name).toBe('Cheap beer');
    expect(scenario.inputs).toEqual({ productId: 1, quantity: 6, destination: 'FI' });

    // Upsert-by-name: same identity, refreshed inputs.
    const replaced = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie },
      body: JSON.stringify({
        name: 'Cheap beer',
        inputs: { productId: 2, quantity: 12, destination: 'FI' },
      }),
    });
    expect(replaced.status).toBe(201);
    const replacedBody = (await replaced.json()) as Record<string, any>;
    expect(replacedBody.id).toBe(scenario.id);
    expect(replacedBody.inputs).toEqual({ productId: 2, quantity: 12, destination: 'FI' });

    const list = await request(app, env, '/api/v1/account/scenarios', {
      headers: { cookie },
    });
    const scenarios = (await list.json()) as Array<Record<string, any>>;
    expect(scenarios).toHaveLength(1);
  });

  it('deletes account-scoped: foreign ids are not found, never cross-account', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const cookieA = (await registerInto(env, app)).cookie;
    const cookieB = (await registerInto(env, app)).cookie;

    const created = await request(app, env, '/api/v1/account/scenarios', {
      method: 'POST',
      headers: { ...JSON_HDRS, cookie: cookieA },
      body: JSON.stringify({
        name: 'Mine',
        inputs: { productId: 1, quantity: 1, destination: 'FI' },
      }),
    });
    const { id } = (await created.json()) as { id: number };

    const foreign = await request(app, env, `/api/v1/account/scenarios/${id}`, {
      method: 'DELETE',
      headers: { cookie: cookieB },
    });
    await expectEnvelope(foreign, 404, {
      message: `Scenario "${id}" not found`,
      error: 'ScenarioNotFound',
    });

    const nonInteger = await request(app, env, '/api/v1/account/scenarios/abc', {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    await expectEnvelope(nonInteger, 400, {
      message: 'Validation failed (numeric string is expected)',
    });

    const ok = await request(app, env, `/api/v1/account/scenarios/${id}`, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    expect(ok.status).toBe(200);

    const list = await request(app, env, '/api/v1/account/scenarios', {
      headers: { cookie: cookieA },
    });
    expect(await list.json()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Analytics (click + outbound redirect)
// ---------------------------------------------------------------------------

describe('POST /api/v1/analytics/click', () => {
  it('rejects forbidden fields before any other validation', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    for (const field of ['commission', 'affiliate', 'purchase', 'transactionId', 'orderId']) {
      const res = await request(app, permissiveEnv(d1), '/api/v1/analytics/click', {
        method: 'POST',
        headers: JSON_HDRS,
        body: JSON.stringify({ [field]: 1, merchantId: 'alko', url: 'https://x' }),
      });
      await expectEnvelope(res, 400, {
        message: `Field "${field}" is not allowed in click analytics payload`,
        error: 'ForbiddenField',
      });
    }
  });

  it('requires non-empty merchantId and url strings', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/analytics/click', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify({ merchantId: '', url: 5 }),
    });
    await expectEnvelope(res, 400, {
      message: '"merchantId" is required and must be a non-empty string',
      error: 'ValidationError',
    });
  });

  it('records the click through ClickCounterDO and reports the updated count', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const env = permissiveEnv(d1);
    const payload = { merchantId: 'alko', url: 'https://example.invalid/karhu' };

    const first = await request(app, env, '/api/v1/analytics/click', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, count: 1 });

    const second = await request(app, env, '/api/v1/analytics/click', {
      method: 'POST',
      headers: JSON_HDRS,
      body: JSON.stringify(payload),
    });
    expect(await second.json()).toEqual({ success: true, count: 2 });
  });
});

describe('GET /api/v1/outbound/:offerId', () => {
  it('redirects (302) to the merchant source URL', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 11, productId: 1, sourceUrl: 'https://shop.example/karhu' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/outbound/11');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://shop.example/karhu');
  });

  it('404s an unknown offer or one without a source URL', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { id: 12, productId: 1, sourceUrl: null });
    const app = buildApp();

    const unknown = await request(app, permissiveEnv(d1), '/api/v1/outbound/999');
    await expectEnvelope(unknown, 404, {
      message: 'Offer 999 not found or has no source URL',
    });

    const noUrl = await request(app, permissiveEnv(d1), '/api/v1/outbound/12');
    await expectEnvelope(noUrl, 404, {
      message: 'Offer 12 not found or has no source URL',
    });
  });
});
