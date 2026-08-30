/**
 * Account + session route ports (task 3.7) — Hono re-host of
 * AccountController and SessionController
 * (packages/application-api/src/accounts/), re-hosted against D1
 * (src/adapters/account-store.ts + the task-2.5 session repository).
 *
 * Session lifecycle (design D3): POST /api/v1/account/session issues an
 * anonymous session (identity GENERATED here, never client-supplied) and
 * sets the httpOnly `rajahinta_session` cookie — the token never appears
 * in a response body. Rotate replaces the presented token atomically;
 * DELETE revokes and clears the cookie. Guard composition is the 3.2
 * route-coverage map: issuance is public (rate-limited only), everything
 * else requires a session; scenarios additionally require
 * ADVANCED_FEATURES.
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
import { D1SessionRepository } from '../../../../packages/data-platform/src/repositories/d1/session.repository';
import { isValidEmailFormat } from '../../../../packages/application-api/src/accounts/email-verification';
import {
  D1AccountStore,
  newAnonymousUserId,
  type AccountRow,
  type BasketRow,
  type ScenarioRow,
} from '../adapters/account-store';

/** Cookie carrying the opaque session token (httpOnly, SameSite=Lax). */
const SESSION_COOKIE_NAME = 'rajahinta_session';

/** Session lifetime in hours (30 days by default — SessionTokenService parity). */
const DEFAULT_SESSION_TTL_HOURS = 24 * 30;

/** Cookie builder parity — Secure only when the deployment is production. */
function buildSessionCookie(token: string, expiresAt: Date | string, env: AppEnv['Bindings']): string {
  const expires = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const maxAgeSeconds = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
  const secure = (env as { NODE_ENV?: string }).NODE_ENV === 'production' ? '; Secure' : '';
  return (
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${maxAgeSeconds}; Expires=${expires.toUTCString()}${secure}`
  );
}

/** Clear-cookie parity (logout). */
function buildSessionCookieClear(env: AppEnv['Bindings']): string {
  const secure = (env as { NODE_ENV?: string }).NODE_ENV === 'production' ? '; Secure' : '';
  return (
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`
  );
}

/** The configured session TTL — env read with the service's fallbacks. */
function sessionTtlMs(env: AppEnv['Bindings']): number {
  const raw = (env as { SESSION_TTL_HOURS?: string }).SESSION_TTL_HOURS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_SESSION_TTL_HOURS * 3_600_000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SESSION_TTL_HOURS * 3_600_000;
  return parsed * 3_600_000;
}

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
// Session routes
// ---------------------------------------------------------------------------

async function issue(c: Context<AppEnv>): Promise<Response> {
  // The identity is GENERATED here — randomUUID, never client input.
  const userId = newAnonymousUserId();
  const store = new D1AccountStore(c.env.DB);
  const account = await store.ensureAccount(userId);

  const token = opaqueToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs(c.env));
  const sessions = new D1SessionRepository(c.env.DB);
  await sessions.create({
    tokenHash: await hashToken(token),
    accountId: account.id,
    expiresAt,
  });

  c.header('Set-Cookie', buildSessionCookie(token, expiresAt, c.env));
  return c.json({ userId, expiresAt: expiresAt.toISOString(), verified: false }, 201);
}

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
    throw new ApiHttpError(401, {
      statusCode: 401,
      message: 'Session token is invalid, expired, or revoked.',
      error: 'InvalidSession',
    });
  }
  c.header('Set-Cookie', buildSessionCookie(newToken, session.expiresAt, c.env));
  return c.json({
    userId: user.userId,
    expiresAt: new Date(session.expiresAt).toISOString(),
    verified: user.verified,
  });
}

async function revoke(c: Context<AppEnv>): Promise<Response> {
  const presented = c.get(SESSION_TOKEN_CONTEXT_KEY) ?? '';
  const sessions = new D1SessionRepository(c.env.DB);
  await sessions.revokeByTokenHash(await hashToken(presented));
  c.header('Set-Cookie', buildSessionCookieClear(c.env));
  return c.json({ revoked: true });
}

// ---------------------------------------------------------------------------
// Account routes
// ---------------------------------------------------------------------------

function requireUser(c: Context<AppEnv>): AuthenticatedAccount {
  return c.get(USER_CONTEXT_KEY) as AuthenticatedAccount;
}

/** GDPR Article 15/20 data-portability export (DataExportService parity). */
async function exportData(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const store = new D1AccountStore(c.env.DB);
  const account = await store.ensureAccount(user.userId);

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
  await new D1AccountStore(c.env.DB).createBasket(user.userId, {
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
  const account = await new D1AccountStore(c.env.DB).ensureAccount(user.userId);
  return c.json(subscriptionOf(account));
}

async function verifyEmail(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  let body: { email?: unknown };
  try {
    body = (await c.req.json()) as { email?: unknown };
  } catch {
    body = {};
  }
  if (typeof body.email !== 'string' || !isValidEmailFormat(body.email)) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: '"email" is required and must be a valid email address',
      error: 'InvalidEmail',
    });
  }

  // The verified-email write path: the real D1 UPDATE replaces the
  // UnboundVerifiedEmailStore's always-throw (task 2.4 / FIX-E wiring).
  await new D1AccountStore(c.env.DB).setVerifiedEmail(user.userId, body.email);
  return c.json({ verified: true, email: body.email });
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
  const saved = await new D1AccountStore(c.env.DB).upsertScenario(
    user.userId,
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
// Token helpers (SessionTokenService parity, WebCrypto)
// ---------------------------------------------------------------------------

/** Opaque 256-bit token, base64url — no structure to leak or guess. */
function opaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 hex digest of a token (session-resolver parity). */
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register account/session/analytics handlers (guards pre-registered). */
export function registerAccountsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // SessionController — issuance is PUBLIC (rate-limited only; Nest
  // SessionController has no class guard), rotate is session-guarded
  // (middleware from registerGuardMiddleware, so the limit composes AFTER
  // the guard exactly like Nest's SessionAuthGuard → RateLimitGuard order).
  app.post('/api/v1/account/session', requireRateLimit('DEFAULT'), issue);
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
  app.post('/api/v1/account/verify-email', verifyEmail);
  app.get('/api/v1/account/scenarios', listScenarios);
  app.post('/api/v1/account/scenarios', saveScenario);
  app.delete('/api/v1/account/scenarios/:id', deleteScenario);
  return app;
}
