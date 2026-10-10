/**
 * Product favorites CRUD route tests (task 2.1, change
 * add-product-favorites) over the FULL app composition (createApp() +
 * registerFavoritesRoutes — the exact composition index.ts wires, guards
 * first) on the fake-D1 harness, mirroring alerts.routes.test.ts.
 *
 * Pinning here (beyond plain CRUD): the middleware ORDER of the chain
 * sessionAuth → requireAccountRateLimit — an anonymous caller gets the
 * 401 envelope; the POST contract matrix per design D5 (201 created row
 * with read-model fields, 409 duplicate, 400 over-cap NAMING the cap and
 * winning over the duplicate, 404 unknown product); account-scoped
 * ownership on DELETE; and the list rows' nullable current/delta
 * semantics (design D4 — Δ only when both prices exist).
 *
 * @module FavoritesRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  createApp,
  expectEnvelope,
  issueSessionToken,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedProduct,
} from './harness';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';
import { registerFavoritesRoutes } from '../favorites.routes';
import { FAVORITES_CAP } from '../../../../../packages/data-platform/src/repositories/d1/account-favorite.repository';

/**
 * index.ts registers the favorites handlers behind the guards (same slot
 * as the other route ports); the test composition mirrors that exactly.
 */
function favoritesApp(): ReturnType<typeof createApp> {
  const app = createApp();
  registerFavoritesRoutes(app);
  return app;
}

function favoritesEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, overrides);
}

/** Canonical two-account fixture: 7 is the acting owner, 9 the foreigner. */
function seedAccounts(db: ReturnType<typeof openMigratedD1>['db']): void {
  seedAccount(db, { id: 7, userId: 'user-7', email: 'user-7@example.invalid', tier: 'FREE' });
  seedAccount(db, { id: 9, userId: 'user-9', email: 'user-9@example.invalid', tier: 'FREE' });
}

const cookieOf = (token: string): string => `rajahinta_session=${token}`;

interface Setup {
  db: ReturnType<typeof openMigratedD1>['db'];
  app: ReturnType<typeof favoritesApp>;
  env: Env;
  token7: string;
  token9: string;
}

async function setup(): Promise<Setup> {
  const { db, d1 } = openMigratedD1();
  seedAccounts(db);
  return {
    db,
    app: favoritesApp(),
    env: favoritesEnv(d1),
    token7: await issueSessionToken(d1, 7),
    token9: await issueSessionToken(d1, 9),
  };
}

interface FavoriteJson {
  id: number;
  productId: number;
  savedPriceCents: number | null;
  currentPriceCents: number | null;
  deltaCents: number | null;
  createdAt: string;
}

function jsonInit(method: string, token: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', cookie: cookieOf(token) },
    body: JSON.stringify(body),
  };
}

async function createFavorite(
  app: Setup['app'],
  env: Env,
  token: string,
  productId: number,
): Promise<Response> {
  return request(app, env, '/api/v1/account/favorites', jsonInit('POST', token, { productId }));
}

/**
 * One product-wide daily summary bucket (merchant NULL) — the only
 * bucket shape the freshness read may see. Mirrors the repository
 * suite's seeder (package-internal test surface, not importable here).
 */
function seedDailyClose(
  db: Setup['db'],
  productId: number,
  periodStart: string,
  priceCloseCents: number,
): void {
  db.prepare(
    `INSERT INTO price_history_summaries (
        granularity, period_start, product_id, merchant,
        price_open_cents, price_close_cents, price_min_cents, price_max_cents, price_avg_cents,
        landed_cost_open_cents, landed_cost_close_cents, landed_cost_min_cents,
        landed_cost_max_cents, landed_cost_avg_cents,
        observation_count, strictest_reliability
      ) VALUES ('daily', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ESTIMATED')`,
  ).run(
    periodStart,
    productId,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
    priceCloseCents,
  );
}

/** UTC day anchor offset from today — matches the repository's window arithmetic. */
function dayFromToday(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** Direct-row seed — the cap test needs 100 rows without 100 captures. */
function seedFavoriteRow(db: Setup['db'], accountId: number, productId: number): void {
  db.prepare(
    `INSERT INTO account_favorites (account_id, product_id) VALUES (?, ?)`,
  ).run(accountId, productId);
}

// ---------------------------------------------------------------------------
// Guard chain: session first
// ---------------------------------------------------------------------------

describe('favorites guard chain — session required', () => {
  it('rejects all three methods without a session with the standard 401 envelope', async () => {
    const { app, env } = await setup();
    for (const [method, path] of [
      ['GET', '/api/v1/account/favorites'],
      ['POST', '/api/v1/account/favorites'],
      ['DELETE', '/api/v1/account/favorites/1'],
    ] as const) {
      const res = await request(app, env, path, { method });
      await expectEnvelope(res, 401, { error: 'SessionRequired' });
    }
  });
});

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------

describe('POST /api/v1/account/favorites', () => {
  it('creates the favorite bound to the session account and returns the read-model row', async () => {
    const { db, app, env, token7 } = await setup();
    seedProduct(db, { id: 1 });
    seedDailyClose(db, 1, dayFromToday(-1), 1199);

    const res = await createFavorite(app, env, token7, 1);
    expect(res.status).toBe(201);
    const body = (await res.json()) as FavoriteJson;
    expect(body.id).toBeGreaterThan(0);
    expect(body.productId).toBe(1);
    // The 201 body is the row WITH the read-model fields (design D5):
    // the fresh close was both captured and is the current price.
    expect(body.savedPriceCents).toBe(1199);
    expect(body.currentPriceCents).toBe(1199);
    expect(body.deltaCents).toBe(0);
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
    // accountId is caller-scoped and never serialized (alerts convention).
    expect(body).not.toHaveProperty('accountId');
  });

  it('stores null prices when the product has no fresh summary — the row still creates', async () => {
    const { db, app, env, token7 } = await setup();
    seedProduct(db, { id: 1 });

    const res = await createFavorite(app, env, token7, 1);
    expect(res.status).toBe(201);
    const body = (await res.json()) as FavoriteJson;
    expect(body.savedPriceCents).toBeNull();
    expect(body.currentPriceCents).toBeNull();
    expect(body.deltaCents).toBeNull();
  });

  it.each([undefined, 0, -1, 2.5, 'abc'])('rejects productId %s with 400', async (productId) => {
    const { db, app, env, token7 } = await setup();
    seedProduct(db, { id: 1 });
    const res = await request(app, env, '/api/v1/account/favorites', jsonInit('POST', token7, { productId }));
    await expectEnvelope(res, 400, { error: 'ValidationError' });
  });

  it('rejects an unknown product with 404', async () => {
    const { app, env, token7 } = await setup();
    const res = await createFavorite(app, env, token7, 999_999);
    await expectEnvelope(res, 404, { error: 'ProductNotFound' });
  });

  it('rejects a duplicate (account, product) with 409', async () => {
    const { db, app, env, token7 } = await setup();
    seedProduct(db, { id: 1 });
    await createFavorite(app, env, token7, 1);
    const again = await createFavorite(app, env, token7, 1);
    await expectEnvelope(again, 409, { error: 'FavoriteAlreadyExists' });
  });

  it('scopes the uniqueness to the account: another account may favorite the same product', async () => {
    const { db, app, env, token7, token9 } = await setup();
    seedProduct(db, { id: 1 });
    await createFavorite(app, env, token7, 1);
    const res = await createFavorite(app, env, token9, 1);
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// POST — cap (design D3): 400 naming the cap, winning over the duplicate
// ---------------------------------------------------------------------------

describe('POST /api/v1/account/favorites — cap', () => {
  function seedFullAccount(db: Setup['db']): void {
    for (let id = 1; id <= FAVORITES_CAP; id++) {
      seedProduct(db, { id });
      seedFavoriteRow(db, 7, id);
    }
  }

  it('rejects an over-cap account with a 400 naming the cap (100)', async () => {
    const { db, app, env, token7 } = await setup();
    seedFullAccount(db);
    seedProduct(db, { id: FAVORITES_CAP + 1 }); // fresh, not yet favorited

    const res = await createFavorite(app, env, token7, FAVORITES_CAP + 1);
    const body = await expectEnvelope(res, 400, { error: 'ValidationError' });
    expect(body.message).toContain(String(FAVORITES_CAP));
  });

  it('answers the cap 400 even for an already-favorited product — over-cap never 409s', async () => {
    const { db, app, env, token7 } = await setup();
    seedFullAccount(db);

    // Product 1 is a duplicate-in-waiting; the repository checks the cap
    // before any duplicate lookup (the change's risk note), so the route
    // must surface the cap message, not FavoriteAlreadyExists.
    const duplicate = await createFavorite(app, env, token7, 1);
    const body = await expectEnvelope(duplicate, 400, { error: 'ValidationError' });
    expect(body.message).toContain(String(FAVORITES_CAP));
    expect(body.message).not.toContain('already in your favorites');
  });

  it('counts only the acting account toward the cap — another account still saves', async () => {
    const { db, app, env, token7, token9 } = await setup();
    seedFullAccount(db);
    seedProduct(db, { id: FAVORITES_CAP + 1 });

    // Account 7 is at cap; account 9 is untouched by its count.
    const res = await createFavorite(app, env, token9, FAVORITES_CAP + 1);
    expect(res.status).toBe(201);
    void token7;
  });
});

// ---------------------------------------------------------------------------
// GET — list (design D4 read model)
// ---------------------------------------------------------------------------

describe('GET /api/v1/account/favorites', () => {
  it('lists only the session account’s own favorites with nullable current/delta semantics', async () => {
    const { db, app, env, token7, token9 } = await setup();
    seedProduct(db, { id: 1 });
    seedProduct(db, { id: 2 });
    seedProduct(db, { id: 3 });

    // Saved at 1149, price since rose to 1199 → Δ +50.
    seedDailyClose(db, 1, dayFromToday(-2), 1149);
    await createFavorite(app, env, token7, 1);
    seedDailyClose(db, 1, dayFromToday(-1), 1199);

    // No summary at save time (null saved), but a fresh price exists now
    // → current without Δ.
    await createFavorite(app, env, token7, 2);
    seedDailyClose(db, 2, dayFromToday(-1), 900);

    // Never priced → all three price fields null.
    await createFavorite(app, env, token7, 3);

    // A foreign row that must not leak into account 7's list.
    await createFavorite(app, env, token9, 1);

    const res = await request(app, env, '/api/v1/account/favorites', {
      headers: { cookie: cookieOf(token7) },
    });
    expect(res.status).toBe(200);
    const favorites = (await res.json()) as FavoriteJson[];
    expect(favorites.map((f) => f.productId).sort()).toEqual([1, 2, 3]);

    const drifted = favorites.find((f) => f.productId === 1)!;
    expect(drifted.savedPriceCents).toBe(1149);
    expect(drifted.currentPriceCents).toBe(1199);
    expect(drifted.deltaCents).toBe(50);

    const unsaved = favorites.find((f) => f.productId === 2)!;
    expect(unsaved.savedPriceCents).toBeNull();
    expect(unsaved.currentPriceCents).toBe(900);
    expect(unsaved.deltaCents).toBeNull();

    const neverPriced = favorites.find((f) => f.productId === 3)!;
    expect(neverPriced.savedPriceCents).toBeNull();
    expect(neverPriced.currentPriceCents).toBeNull();
    expect(neverPriced.deltaCents).toBeNull();
  });

  it('returns an empty array for an account without favorites', async () => {
    const { app, env, token7 } = await setup();
    const res = await request(app, env, '/api/v1/account/favorites', {
      headers: { cookie: cookieOf(token7) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/account/favorites/:productId', () => {
  it('removes the owned favorite with 204; a repeat reports 404', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    await createFavorite(s.app, s.env, s.token7, 1);

    const removed = await request(s.app, s.env, '/api/v1/account/favorites/1', { method: 'DELETE', headers: { cookie: cookieOf(s.token7) } });
    expect(removed.status).toBe(204);

    const listed = await request(s.app, s.env, '/api/v1/account/favorites', {
      headers: { cookie: cookieOf(s.token7) },
    });
    expect(await listed.json()).toEqual([]);

    const again = await request(s.app, s.env, '/api/v1/account/favorites/1', { method: 'DELETE', headers: { cookie: cookieOf(s.token7) } });
    await expectEnvelope(again, 404, { error: 'FavoriteNotFound' });
  });

  it('reports a foreign favorite as 404 and leaves it for its owner', async () => {
    const s = await setup();
    seedProduct(s.db, { id: 1 });
    await createFavorite(s.app, s.env, s.token7, 1);

    const foreign = await request(s.app, s.env, '/api/v1/account/favorites/1', { method: 'DELETE', headers: { cookie: cookieOf(s.token9) } });
    await expectEnvelope(foreign, 404, { error: 'FavoriteNotFound' });

    const owner = await request(s.app, s.env, '/api/v1/account/favorites', {
      headers: { cookie: cookieOf(s.token7) },
    });
    expect(((await owner.json()) as FavoriteJson[])).toHaveLength(1);
  });

  it('rejects a non-numeric productId with the ParseIntPipe 400', async () => {
    const s = await setup();
    const res = await request(s.app, s.env, '/api/v1/account/favorites/abc', { method: 'DELETE', headers: { cookie: cookieOf(s.token7) } });
    await expectEnvelope(res, 400, {
      message: 'Validation failed (numeric string is expected)',
    });
  });
});
