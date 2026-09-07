/**
 * Account + session route ports (tasks 3.7, 2.2 and 2.3 of
 * change email-password-auth) — Hono re-host of AccountController and
 * SessionController (packages/application-api/src/accounts/) against D1
 * (src/adapters/account-store.ts + the task-2.5 session repository).
 *
 * Credential lifecycle (design D2): POST /register creates the account
 * (email = username, lowercase-canonical, unique in SQL), issues a
 * session with the same mechanics the deleted anonymous-issuance handler
 * used, and sends the verification mail best-effort; POST /login answers
 * unknown-email and wrong-password with ONE uniform 401; GET /me is the
 * cheap identity read. The anonymous `POST /api/v1/account/session`
 * issuance route and the self-asserted `POST /api/v1/account/verify-email`
 * endpoint are DELETED — register/login are the only session-issuing
 * endpoints, and email ownership is proven by single-use emailed tokens
 * (src/services/email-token.service.ts), never by client assertions.
 *
 * `verified` in every payload below derives from the account row's
 * `email_verified_at` (tasks 2.2/2.3 note) — the row is the only
 * verification source; the middleware-level derived flag was removed in
 * task 2.4.
 *
 * Guard composition is the design-D2 table: AUTH rate limit on
 * register/login/password/reset-request, sessionAuth on me and
 * verify-email/request, public confirm/reset (the token IS the
 * capability) — the wiring lives in guards.ts; rotate keeps the Nest
 * guard order (sessionAuth → DEFAULT rate limit).
 *
 * @module AccountsRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { requireRateLimit } from '../middleware/rate-limit';
import { parseIntParam, parseUuidParam } from './support';
import { z } from 'zod';
import { USER_CONTEXT_KEY, SESSION_TOKEN_CONTEXT_KEY } from '../auth/authenticated-account';
import type { AuthenticatedAccount } from '../auth/authenticated-account';
import { isValidPassword, hashPassword, verifyPassword } from '../auth/password';
import { D1SessionRepository } from '../../../../packages/data-platform/src/repositories/d1/session.repository';
import {
  D1AccountStore,
  EmailAlreadyRegisteredError,
  type AccountRow,
  type AccountCredentialRow,
  type BasketRow,
  type ScenarioRow,
} from '../adapters/account-store';
import { EmailTokenService } from '../services/email-token.service';
import { createLogger } from '../logger';
import {
  buildSessionCookie,
  buildSessionCookieClear,
  hashToken,
  issueSession,
  opaqueToken,
  readJsonBody,
  recordSecurityEvent,
  sessionTtlMs,
  isValidEmailFormat,
  LOGIN_TIMING_PARITY_ENVELOPE,
} from './auth.helpers';

// ---------------------------------------------------------------------------
// Serialization — application-layer types with Date fields cross as ISO
// ---------------------------------------------------------------------------

function toBasketJson(row: BasketRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    items: row.items,
  };
}

function toScenarioJson(row: ScenarioRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    inputs: row.inputs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Subscription projection from the account row (rowToAccount parity). */
function subscriptionOf(account: AccountRow): Record<string, unknown> {
  return { userId: account.userId, plan: account.tier, active: true };
}

// ---------------------------------------------------------------------------
// Session lifecycle routes (rotate + logout — unchanged semantics)
// ---------------------------------------------------------------------------

async function rotate(c: Context<AppEnv>): Promise<Response> {
  const user = c.get(USER_CONTEXT_KEY) as AuthenticatedAccount;
  const presented = c.get(SESSION_TOKEN_CONTEXT_KEY) ?? '';

  const newToken = opaqueToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs(c.env));
  const sessions = new D1SessionRepository(c.env.DB);
  const session = await sessions.rotate(
    await hashToken(presented),
    await hashToken(newToken),
    expiresAt,
  );
  if (session === null) {
    // The guard already validated the token; this covers a concurrent
    // rotation/expiry racing between guard and service.
    throw invalidSessionError();
  }
  c.header('Set-Cookie', buildSessionCookie(newToken, session.expiresAt));
  // `verified` derives from the account row's verification state — the
  // row is the only source (the middleware-level derived flag was
  // removed in task 2.4).
  const account = await new D1AccountStore(c.env.DB).findByUserId(user.userId);
  return c.json({
    userId: user.userId,
    expiresAt: new Date(session.expiresAt).toISOString(),
    verified: account === null ? false : account.emailVerifiedAt !== null,
  });
}

async function revoke(c: Context<AppEnv>): Promise<Response> {
  const presented = c.get(SESSION_TOKEN_CONTEXT_KEY) ?? '';
  const sessions = new D1SessionRepository(c.env.DB);
  await sessions.revokeByTokenHash(await hashToken(presented));
  c.header('Set-Cookie', buildSessionCookieClear());
  return c.json({ revoked: true });
}

// ---------------------------------------------------------------------------
// Credential routes (tasks 2.2/2.3 — design D2 table)
// ---------------------------------------------------------------------------

function requireUser(c: Context<AppEnv>): AuthenticatedAccount {
  return c.get(USER_CONTEXT_KEY) as AuthenticatedAccount;
}

/** Uniform invalid-session rejection (fail-closed). */
function invalidSessionError(): ApiHttpError {
  return new ApiHttpError(401, {
    statusCode: 401,
    message: 'Session token is invalid, expired, or revoked.',
    error: 'InvalidSession',
  });
}

function invalidEmailError(): ApiHttpError {
  return new ApiHttpError(400, {
    statusCode: 400,
    message: '"email" is required and must be a valid email address',
    error: 'InvalidEmail',
  });
}

function invalidPasswordError(field = 'password'): ApiHttpError {
  return new ApiHttpError(400, {
    statusCode: 400,
    message: `"${field}" is required and must be 12 to 128 characters long`,
    error: 'InvalidPassword',
  });
}

/** Email-token service wired per request (fresh stores over this env's D1). */
function emailTokenService(c: Context<AppEnv>): EmailTokenService {
  return new EmailTokenService({
    d1: c.env.DB,
    log: createLogger(c.env.LOG_LEVEL),
    config: {
      // Frontend origin the mailed links point at (design D4). Per-env
      // wrangler var; the fallback is the production custom-domain origin.
      frontendOrigin:
        (c.env as { APP_PUBLIC_URL?: string }).APP_PUBLIC_URL ?? 'https://rajahinta.fi',
      emailWorkerUrl: c.env.EMAIL_WORKER_URL,
      emailSendSecret: c.env.EMAIL_SEND_SECRET,
    },
  });
}

/**
 * POST /api/v1/account/register — validate, create the account (the
 * lower(email) unique index is the duplicate rejection), issue a session
 * with the deleted issuance handler's mechanics, and send the
 * verification mail best-effort (design D4: mail failure never fails
 * registration — the resend flow exists).
 */
async function register(c: Context<AppEnv>): Promise<Response> {
  const body = await readJsonBody(c);
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || !isValidEmailFormat(email)) {
    throw invalidEmailError();
  }
  // Policy gate BEFORE hashing — the task-2.1 invariant (never run the
  // 600k-iteration derivation on policy-rejected input).
  if (typeof password !== 'string' || !isValidPassword(password)) {
    throw invalidPasswordError();
  }

  const store = new D1AccountStore(c.env.DB);
  let account: AccountCredentialRow;
  try {
    account = await store.createRegisteredAccount({
      email,
      passwordHash: await hashPassword(password),
    });
  } catch (err) {
    if (err instanceof EmailAlreadyRegisteredError) {
      await recordSecurityEvent(c.env.DB, {
        entityType: 'account',
        entityId: email.toLowerCase(),
        author: 'anonymous',
        action: 'created',
        reason: 'registration rejected: email already registered',
        newValue: { email: email.toLowerCase() },
      });
      throw new ApiHttpError(409, {
        statusCode: 409,
        message: 'Email already registered.',
        error: 'EmailAlreadyRegistered',
      });
    }
    throw err;
  }

  await recordSecurityEvent(c.env.DB, {
    entityType: 'account',
    entityId: account.userId,
    author: account.userId,
    action: 'created',
    reason: 'account registered',
    newValue: { email: account.email, tier: account.tier },
  });

  const issued = await issueSession(c.env.DB, account.id, sessionTtlMs(c.env));
  c.header('Set-Cookie', buildSessionCookie(issued.token, issued.expiresAt));

  // Never throws — dispatch/store failures are logged in the service.
  await emailTokenService(c).sendVerificationEmail(account);

  return c.json(
    {
      userId: account.userId,
      expiresAt: issued.expiresAt.toISOString(),
      verified: account.emailVerifiedAt !== null,
    },
    201,
  );
}

/**
 * POST /api/v1/account/login — ONE uniform 401 for unknown email and
 * wrong password (no enumeration), with matching work: a missing
 * credential verifies against the timing-parity envelope so both failure
 * modes cost the same PBKDF2 derivation. Empty/null stored hashes fail
 * safe (design D7) without ever authenticating.
 */
async function login(c: Context<AppEnv>): Promise<Response> {
  const body = await readJsonBody(c);
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || !isValidEmailFormat(email)) {
    throw invalidEmailError();
  }
  if (typeof password !== 'string' || !isValidPassword(password)) {
    throw invalidPasswordError();
  }

  const account = await new D1AccountStore(c.env.DB).findCredentialByEmail(email);
  const storedHash = account?.passwordHash;
  const passwordOk =
    storedHash !== undefined && storedHash !== null && storedHash.length > 0
      ? await verifyPassword(password, storedHash)
      : await verifyPassword(password, LOGIN_TIMING_PARITY_ENVELOPE);

  if (account === null || !passwordOk) {
    // Security event (design D6) — outcome in `reason`; the actor is the
    // resolved userId, 'anonymous' otherwise. Never the password.
    await recordSecurityEvent(c.env.DB, {
      entityType: 'account_session',
      entityId: account?.userId ?? 'unknown',
      author: account?.userId ?? 'anonymous',
      action: 'created',
      reason: 'login failed: invalid credentials',
      newValue: { email: account?.email ?? email.toLowerCase() },
    });
    throw new ApiHttpError(401, {
      statusCode: 401,
      message: 'Invalid email or password.',
      error: 'InvalidCredentials',
    });
  }

  await recordSecurityEvent(c.env.DB, {
    entityType: 'account_session',
    entityId: account.userId,
    author: account.userId,
    action: 'created',
    reason: 'login succeeded',
  });

  const issued = await issueSession(c.env.DB, account.id, sessionTtlMs(c.env));
  c.header('Set-Cookie', buildSessionCookie(issued.token, issued.expiresAt));
  return c.json({
    userId: account.userId,
    expiresAt: issued.expiresAt.toISOString(),
    verified: account.emailVerifiedAt !== null,
  });
}

/** GET /api/v1/account/me — cheap identity read for the frontend. */
async function me(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const account = await new D1AccountStore(c.env.DB).findByUserId(user.userId);
  if (account === null) {
    // The session resolved but the account row is gone — fail closed.
    throw invalidSessionError();
  }
  return c.json({
    userId: account.userId,
    email: account.email,
    verified: account.emailVerifiedAt !== null,
  });
}

/**
 * POST /api/v1/account/verify-email/request — re-send the verification
 * token to the account's address (sessionAuth; the service's dispatch
 * failures are logged, never surfaced as a failed request).
 */
async function verifyEmailRequest(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const account = await new D1AccountStore(c.env.DB).findByUserId(user.userId);
  if (account === null) {
    throw invalidSessionError();
  }
  await emailTokenService(c).sendVerificationEmail(account);
  return c.json({ accepted: true }, 202);
}

/**
 * POST /api/v1/account/verify-email/confirm — public; the token IS the
 * capability. Single-use consumption stamps `email_verified_at` (24 h
 * horizon; replay/expiry/wrong-purpose all see the same 401).
 */
async function verifyEmailConfirm(c: Context<AppEnv>): Promise<Response> {
  const body = await readJsonBody(c);
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: '"token" is required',
      error: 'InvalidToken',
    });
  }
  const result = await emailTokenService(c).confirmEmailVerification(body.token);
  if (!result.ok) {
    throw new ApiHttpError(401, {
      statusCode: 401,
      message: 'Verification token is invalid, expired, or already used.',
      error: 'InvalidToken',
    });
  }
  return c.json({ verified: true, userId: result.userId, email: result.email });
}

/**
 * POST /api/v1/account/password/reset-request — ALWAYS 202. Mail goes
 * out only when the account exists (design D2); the send outcome is
 * invisible to the caller, so the route cannot leak account existence.
 */
async function passwordResetRequest(c: Context<AppEnv>): Promise<Response> {
  const body = await readJsonBody(c);
  if (typeof body.email === 'string' && body.email.length > 0) {
    await emailTokenService(c).sendPasswordResetEmail(body.email.toLowerCase());
  }
  return c.json({ accepted: true }, 202);
}

/**
 * POST /api/v1/account/password/reset — public; the token IS the
 * capability. Rehashes the password, revokes ALL of the account's
 * sessions, and retires its outstanding reset tokens (design D2/D3).
 */
async function passwordReset(c: Context<AppEnv>): Promise<Response> {
  const body = await readJsonBody(c);
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: '"token" is required',
      error: 'InvalidToken',
    });
  }
  // Policy gate BEFORE the service (and before hashing — task-2.1
  // invariant), so a policy-rejected password never burns the token.
  if (typeof body.newPassword !== 'string' || !isValidPassword(body.newPassword)) {
    throw invalidPasswordError('newPassword');
  }
  const result = await emailTokenService(c).resetPassword(body.token, body.newPassword);
  if (!result.ok) {
    // 'invalid_password' is unreachable here (gated above) — the only
    // observable failure is the uniform token rejection.
    throw new ApiHttpError(401, {
      statusCode: 401,
      message: 'Reset token is invalid, expired, or already used.',
      error: 'InvalidToken',
    });
  }
  return c.json({ reset: true });
}

// ---------------------------------------------------------------------------
// Account routes
// ---------------------------------------------------------------------------

/** GDPR Article 15/20 data-portability export (DataExportService parity). */
async function exportData(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const store = new D1AccountStore(c.env.DB);
  // Mirror /me: the session resolved but the account row is gone — fail
  // closed. No account is ever minted here.
  const account = await store.findByUserId(user.userId);
  if (account === null) {
    throw invalidSessionError();
  }

  const savedBaskets = (await store.findBaskets(user.userId)).map(toBasketJson);
  const savedScenarios = (await store.findScenarios(user.userId)).map(toScenarioJson);
  const calculationHistory = (await store.findHistoryEntries(user.userId)).map((entry) => ({
    calculationId: entry.calculationId,
    timestamp: entry.calculatedAt.toISOString(),
    totalCents: entry.totalCents,
    productName: entry.productName,
    quantity: entry.quantity,
  }));

  return c.json({
    userId: account.userId,
    exportDate: new Date().toISOString(),
    account: {
      userId: account.userId,
      email: account.email,
      tier: account.tier,
      createdAt: account.createdAt.toISOString(),
      lastActiveAt: account.lastActiveAt.toISOString(),
    },
    savedBaskets,
    savedScenarios,
    calculationHistory,
    subscription: subscriptionOf(account),
  });
}

async function listBaskets(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const baskets = await new D1AccountStore(c.env.DB).findBaskets(user.userId);
  return c.json(baskets.map(toBasketJson));
}

async function saveBasket(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  let body: { name?: unknown; items?: unknown };
  try {
    body = (await c.req.json()) as { name?: unknown; items?: unknown };
  } catch {
    throw new ApiHttpError(400, 'Request body must be JSON');
  }
  if (typeof body.name !== 'string' || !Array.isArray(body.items)) {
    // The controller passes the body straight to the store; a malformed
    // payload surfaces here as the store's 400 (basket.name/items contract).
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: 'name must be a string and items must be an array',
      error: 'ValidationError',
    });
  }
  const store = new D1AccountStore(c.env.DB);
  // Resolve the session's account (fail closed like /me) — writes are
  // account-scoped and never mint a row.
  const account = await store.findByUserId(user.userId);
  if (account === null) {
    throw invalidSessionError();
  }
  await store.createBasket(account.id, {
    name: body.name,
    items: body.items,
  });
  return c.body(null, 201);
}

async function deleteBasket(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  // ParseUUIDPipe parity — non-UUID ids reject before any lookup.
  const basketId = parseUuidParam(c, 'basketId');
  const deleted = await new D1AccountStore(c.env.DB).deleteBasket(user.userId, basketId);
  if (!deleted) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: `Basket "${basketId}" not found`,
      error: 'BasketNotFound',
    });
  }
  return c.body(null, 200);
}

async function getHistory(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const ids = await new D1AccountStore(c.env.DB).findHistoryIds(user.userId);
  return c.json(ids);
}

const addHistorySchema = z.object({
  recordId: z
    .number({
      required_error: 'recordId must be a positive integer',
      invalid_type_error: 'recordId must be a positive integer',
    })
    .int('recordId must be a positive integer')
    .positive('recordId must be a positive integer'),
});

async function addHistory(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  const parsed = addHistorySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: 'recordId must be a positive integer',
      error: 'InvalidRecordId',
    });
  }
  // First claim wins — a cache-hit record id replayed to another session
  // never re-assigns ownership; the POST stays idempotent either way.
  await new D1AccountStore(c.env.DB).linkCalculation(parsed.data.recordId, user.userId);
  return c.json({ success: true, recordId: parsed.data.recordId }, 201);
}

async function getSubscription(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  // Fail closed like /me — the real account row or a 401, never a mint.
  const account = await new D1AccountStore(c.env.DB).findByUserId(user.userId);
  if (account === null) {
    throw invalidSessionError();
  }
  return c.json(subscriptionOf(account));
}

// ---------------------------------------------------------------------------
// Scenarios (ADVANCED_FEATURES-gated)
// ---------------------------------------------------------------------------

/** Allowed values of `inputs.transportArrangement` (core-domain parity). */
const TRANSPORT_ARRANGEMENTS = ['SELLER_ARRANGED', 'INDEPENDENT_CARRIER', 'PERSONAL'];

/**
 * Verbatim port of the controller's validateScenarioBody — same checks,
 * same order, same 400 InvalidScenarioRequest payloads.
 */
function validateScenarioBody(body: {
  name?: unknown;
  inputs?: {
    productId?: unknown;
    quantity?: unknown;
    destination?: unknown;
    transportMethod?: unknown;
    transportArrangement?: unknown;
  };
}): void {
  const fail = (message: string): never => {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message,
      error: 'InvalidScenarioRequest',
    });
  };

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('Request body must be a JSON object with name and inputs');
  }
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    fail('name must be a non-empty string');
  }

  const rawInputs = body.inputs;
  if (!rawInputs || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
    fail('inputs must be an object');
  }
  const inputs = rawInputs as Record<string, unknown>;
  const productId = inputs.productId;
  const quantity = inputs.quantity;
  const destination = inputs.destination;
  const transportMethod = inputs.transportMethod;
  const transportArrangement = inputs.transportArrangement;
  if (!Number.isInteger(productId) || (productId as number) <= 0) {
    fail('inputs.productId must be a positive integer');
  }
  if (!Number.isInteger(quantity) || (quantity as number) <= 0) {
    fail('inputs.quantity must be a positive integer');
  }
  if (typeof destination !== 'string' || destination.trim().length === 0) {
    fail('inputs.destination must be a non-empty string');
  }
  if (
    transportMethod !== undefined &&
    (typeof transportMethod !== 'string' || transportMethod.trim().length === 0)
  ) {
    fail('inputs.transportMethod must be a non-empty string when provided');
  }
  if (
    transportArrangement !== undefined &&
    !TRANSPORT_ARRANGEMENTS.includes(transportArrangement as string)
  ) {
    fail(
      'inputs.transportArrangement must be one of SELLER_ARRANGED, ' +
        'INDEPENDENT_CARRIER, PERSONAL when provided',
    );
  }
}

async function listScenarios(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const scenarios = await new D1AccountStore(c.env.DB).findScenarios(user.userId);
  return c.json(scenarios.map(toScenarioJson));
}

async function saveScenario(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  let body: { name?: unknown; inputs?: unknown };
  try {
    body = (await c.req.json()) as { name?: unknown; inputs?: unknown };
  } catch {
    throw new ApiHttpError(400, 'Request body must be JSON');
  }
  validateScenarioBody(body as never);
  const store = new D1AccountStore(c.env.DB);
  // Resolve the session's account (fail closed like /me) — writes are
  // account-scoped and never mint a row.
  const account = await store.findByUserId(user.userId);
  if (account === null) {
    throw invalidSessionError();
  }
  const saved = await store.upsertScenario(
    account.id,
    body.name as string,
    body.inputs,
  );
  return c.json(toScenarioJson(saved), 201);
}

async function deleteScenario(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const scenarioId = parseIntParam(c, 'id');
  // Account-scoped: a foreign or absent id is reported as not found.
  const deleted = await new D1AccountStore(c.env.DB).deleteScenario(user.userId, scenarioId);
  if (!deleted) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: `Scenario "${scenarioId}" not found`,
      error: 'ScenarioNotFound',
    });
  }
  return c.body(null, 200);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register account/session/analytics handlers (guards pre-registered). */
export function registerAccountsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // Credential routes (tasks 2.2/2.3). Guard wiring is the design-D2
  // table in guards.ts: AUTH rate limit composes ahead of register,
  // login, and password/reset-request; sessionAuth ahead of me and
  // verify-email/request; confirm and password/reset are public (the
  // token IS the capability). The anonymous POST /api/v1/account/session
  // issuance route and the self-asserted POST /api/v1/account/verify-email
  // endpoint are deleted — no anonymous identity is minted anywhere.
  app.post('/api/v1/account/register', register);
  app.post('/api/v1/account/login', login);
  app.get('/api/v1/account/me', me);
  app.post('/api/v1/account/verify-email/request', verifyEmailRequest);
  app.post('/api/v1/account/verify-email/confirm', verifyEmailConfirm);
  app.post('/api/v1/account/password/reset-request', passwordResetRequest);
  app.post('/api/v1/account/password/reset', passwordReset);

  // SessionController parity — rotate is session-guarded (middleware from
  // registerGuardMiddleware, so the limit composes AFTER the guard exactly
  // like Nest's SessionAuthGuard → RateLimitGuard order); DELETE revokes.
  app.on('POST', '/api/v1/account/session/rotate', requireRateLimit('DEFAULT'));
  app.post('/api/v1/account/session/rotate', rotate);
  app.delete('/api/v1/account/session', revoke);

  // AccountController.
  app.get('/api/v1/account/export', exportData);
  app.get('/api/v1/account/baskets', listBaskets);
  app.post('/api/v1/account/baskets', saveBasket);
  app.delete('/api/v1/account/baskets/:basketId', deleteBasket);
  app.get('/api/v1/account/history', getHistory);
  app.post('/api/v1/account/history', addHistory);
  app.get('/api/v1/account/subscription', getSubscription);
  app.get('/api/v1/account/scenarios', listScenarios);
  app.post('/api/v1/account/scenarios', saveScenario);
  app.delete('/api/v1/account/scenarios/:id', deleteScenario);
  return app;
}
