/**
 * Shared harness for the guard-middleware parity tests (task 3.2).
 *
 * Probe handlers are appended AFTER `registerGuardMiddleware`, so each
 * probe composes behind its guards exactly like a real route handler will
 * when the route ports land (tasks 3.5–3.8): middleware passing falls
 * through to the probe ({ ok: true, … }), middleware rejecting produces
 * the unified error envelope. Sessions run against the real D1 session
 * repository over the established fake-D1 harness (node:sqlite in-memory +
 * committed migrations).
 *
 * Pure fixtures live in ./guard-test-fixtures so unit-level suites can
 * avoid this module's app imports.
 *
 * @module guard-test-harness
 */

import type { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  requestPath,
  respondToError,
  routeNotFoundResponse,
} from '../../errors';
import { errorBoundary } from '../../middleware/error-boundary';
import { requestLogging } from '../../middleware/request-id';
import { registerGuardMiddleware } from '../../middleware/guards';
import type { AppEnv, Env } from '../../env';
import { hashToken } from '../../auth/session-resolver';
import { D1SessionRepository } from '../../../../../packages/data-platform/src/repositories/d1/session.repository';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';

export { accountFixture, FAKE_OPS_TOKEN, mintOpaqueToken } from './guard-test-fixtures';
import { mintOpaqueToken } from './guard-test-fixtures';

/** A Worker env over the fake D1, with opt-in guard configuration. */
export function testEnv(
  d1: D1DatabaseLike,
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: d1 as unknown as Env['DB'],
    LOG_LEVEL: 'error', // keep warn/info noise out of test output
    ...overrides,
  } as Env;
}

/**
 * The probe app — the EXACT createApp() composition (request logging,
 * error boundary, notFound envelope) plus the task-3.2 guards, WITHOUT
 * importing the entry script: index.ts is shared surface with other
 * in-flight migration tasks, and the guard suites must not depend on it.
 * Probes are appended after the guards, so each probe composes behind its
 * guards exactly like a real route handler will when the route ports land
 * (tasks 3.5–3.8): middleware passing falls through to the probe
 * ({ ok: true, … }), middleware rejecting produces the unified envelope.
 */
export function buildProbeApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(requestLogging());
  app.onError((err, c) => respondToError(c, err));
  app.use(errorBoundary());
  app.notFound((c) => {
    const { status, body } = routeNotFoundResponse(
      c.req.method,
      requestPath(c),
    );
    return c.json(body, status as ContentfulStatusCode);
  });

  // Health stays unguarded (registered before the guards, as in createApp).
  app.get('/api/v1/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  registerGuardMiddleware(app);

  const ok = (c: Context) =>
    c.json({
      ok: true,
      user: c.get('user') ?? null,
      sessionToken: c.get('sessionToken') ?? null,
    });

  // Calculator routes (guard prefixes hit these probes).
  app.post('/api/v1/calculator', ok);
  app.get('/api/v1/calculator/result/:recordId', ok);
  app.get('/api/v1/products', ok);
  app.post('/api/v1/basket/optimize', ok);
  app.get('/api/v1/declaration/:recordId', ok);

  // Account routes.
  app.get('/api/v1/account/export', ok);
  app.get('/api/v1/account/baskets', ok);
  app.post('/api/v1/account/baskets', ok);
  app.delete('/api/v1/account/baskets/:basketId', ok);
  app.get('/api/v1/account/history', ok);
  app.post('/api/v1/account/history', ok);
  app.get('/api/v1/account/subscription', ok);
  app.post('/api/v1/account/verify-email', ok);
  app.get('/api/v1/account/scenarios', ok);
  app.post('/api/v1/account/scenarios', ok);
  app.delete('/api/v1/account/scenarios/:id', ok);

  // SessionController routes — issuance probe proves the route is public.
  app.post('/api/v1/account/session', ok);
  app.post('/api/v1/account/session/rotate', ok);
  app.delete('/api/v1/account/session', ok);

  // Ops routes.
  app.get('/ops/health', ok);
  app.get('/ops/console/audit', ok);

  return app;
}

/** Issue a request against the probe app with a Worker env attached. */
export async function probe(
  app: Hono<AppEnv>,
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return (await app.request(path, init, env)) as Response;
}

/** Assert the unified error envelope (ApiErrorFilter parity). */
export async function expectEnvelope(
  res: Response,
  status: number,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    statusCode: status,
    timestamp: expect.any(String),
    path: expect.any(String),
    ...fields,
  });
  return body;
}

// ---------------------------------------------------------------------------
// D1 session seeding — real repositories over the fake-D1 harness
// ---------------------------------------------------------------------------

export interface SeededAccount {
  readonly id: number;
  readonly userId: string;
  readonly email: string;
  readonly tier: string;
}

/** Insert an account row exactly as the accounts table stores it. */
export function seedAccount(db: DatabaseSync, account: SeededAccount): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO accounts (id, user_id, email, tier, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(account.id, account.userId, account.email, account.tier, now, now);
}

/**
 * Mint an opaque token exactly like SessionTokenService.mintToken and
 * persist its hash via the real D1 session repository. Returns the raw
 * token (the only place it exists in cleartext — same contract).
 */
export async function issueSessionToken(
  d1: D1DatabaseLike,
  accountId: number,
  ttlMs = 3_600_000,
): Promise<string> {
  const token = mintOpaqueToken();
  const repo = new D1SessionRepository(d1);
  await repo.create({
    tokenHash: await hashToken(token),
    accountId,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
}

/** Canonical seeded accounts used across the session parity tests. */
export function seedStandardAccounts(db: DatabaseSync): void {
  seedAccount(db, {
    id: 7,
    userId: 'user-7',
    email: 'user-7@example.invalid', // verified address
    tier: 'FREE',
  });
  seedAccount(db, {
    id: 9,
    userId: 'user-9',
    email: 'user-9@placeholder.local', // anonymous placeholder
    tier: 'FREE',
  });
  seedAccount(db, {
    id: 11,
    userId: 'user-11',
    email: 'user-11@example.invalid',
    tier: 'PREMIUM',
  });
}

export { openMigratedD1 };
