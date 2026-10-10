/**
 * Account-preferences route tests (task 2.1, change
 * add-onboarding-preferences) over the FULL app composition (createApp()
 * + registerPreferencesRoutes — the exact composition index.ts wires,
 * guards first) on the fake-D1 harness, mirroring
 * favorites.routes.test.ts.
 *
 * Pinning here (beyond plain CRUD): the middleware ORDER of the chain
 * sessionAuth → requireAccountRateLimit — an anonymous caller gets the
 * 401 envelope; the PUT contract matrix per design D2/D6/D7/D8 (sparse
 * patch retains unspecified fields, empty tags valid, channel null
 * clears, onboarded:true sets onboardedAt and never unsets, invalid
 * tag/channel answer the shared 400 ValidationError envelope); the
 * response shape (channel/tags/consent/onboardedAt, accountId never
 * serialized, ISO instants); and DELETE as the row-preserving reset
 * (design D2's UPDATE, never DELETE).
 *
 * @module PreferencesRoutesTest
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
} from './harness';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';
import { registerPreferencesRoutes } from '../preferences.routes';

/**
 * index.ts registers the preferences handlers behind the guards (same
 * slot as the other account route ports); the test composition mirrors
 * that exactly.
 */
function preferencesApp(): ReturnType<typeof createApp> {
  const app = createApp();
  registerPreferencesRoutes(app);
  return app;
}

function preferencesEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
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
  d1: D1DatabaseLike;
  app: ReturnType<typeof preferencesApp>;
  env: Env;
  token7: string;
  token9: string;
}

async function setup(): Promise<Setup> {
  const { db, d1 } = openMigratedD1();
  seedAccounts(db);
  return {
    db,
    d1,
    app: preferencesApp(),
    env: preferencesEnv(d1),
    token7: await issueSessionToken(d1, 7),
    token9: await issueSessionToken(d1, 9),
  };
}

/** The wire shape — exactly the four contract fields, instants as ISO. */
interface PreferencesJson {
  channel: 'TRAVEL' | 'DELIVERY' | 'BOTH' | null;
  categoryTags: string[];
  digestEnabled: boolean;
  onboardedAt: string | null;
}

function jsonInit(method: string, token: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', cookie: cookieOf(token) },
    body: JSON.stringify(body),
  };
}

const getPreferences = (
  s: Pick<Setup, 'app' | 'env'>,
  token: string,
): Promise<Response> =>
  request(s.app, s.env, '/api/v1/account/preferences', {
    headers: { cookie: cookieOf(token) },
  });

const putPreferences = (
  s: Pick<Setup, 'app' | 'env'>,
  token: string,
  body: unknown,
): Promise<Response> =>
  request(s.app, s.env, '/api/v1/account/preferences', jsonInit('PUT', token, body));

// ---------------------------------------------------------------------------
// Guard chain: session first
// ---------------------------------------------------------------------------

describe('preferences guard chain — session required', () => {
  it('rejects all three methods without a session with the standard 401 envelope', async () => {
    const { app, env } = await setup();
    for (const [method, body] of [
      ['GET', undefined],
      ['PUT', {}],
      ['DELETE', undefined],
    ] as const) {
      const res = await request(app, env, '/api/v1/account/preferences', {
        method,
        ...(body === undefined ? {} : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      });
      await expectEnvelope(res, 401, { error: 'SessionRequired' });
    }
  });
});

// ---------------------------------------------------------------------------
// GET — the stored row or the unanswered shape
// ---------------------------------------------------------------------------

describe('GET /api/v1/account/preferences', () => {
  it('answers the unanswered shape for an account that never wrote one', async () => {
    const s = await setup();
    const res = await getPreferences(s, s.token7);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      channel: null,
      categoryTags: [],
      digestEnabled: false,
      onboardedAt: null,
    });
  });

  it('answers the stored row; accountId is never serialized and instants are ISO', async () => {
    const s = await setup();
    await putPreferences(s, s.token7, {
      channel: 'BOTH',
      categoryTags: ['beer', 'spirits'],
      digestEnabled: true,
      onboarded: true,
    });

    const res = await getPreferences(s, s.token7);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreferencesJson;
    expect(body.channel).toBe('BOTH');
    expect(body.categoryTags).toEqual(['beer', 'spirits']);
    expect(body.digestEnabled).toBe(true);
    expect(new Date(body.onboardedAt!).toISOString()).toBe(body.onboardedAt);
    // accountId is caller-scoped and never serialized (alerts convention).
    expect(body).not.toHaveProperty('accountId');
  });
});

// ---------------------------------------------------------------------------
// PUT — the sparse patch contract matrix (design D2/D6/D7/D8)
// ---------------------------------------------------------------------------

describe('PUT /api/v1/account/preferences', () => {
  it('stores a full answer and reports the merged row', async () => {
    const s = await setup();
    const res = await putPreferences(s, s.token7, {
      channel: 'TRAVEL',
      categoryTags: ['wine_still'],
      digestEnabled: true,
      onboarded: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreferencesJson;
    expect(body).toEqual({
      channel: 'TRAVEL',
      categoryTags: ['wine_still'],
      digestEnabled: true,
      onboardedAt: expect.any(String),
    });
  });

  it('retains channel/tags when the patch carries only digestEnabled (design D2)', async () => {
    const s = await setup();
    await putPreferences(s, s.token7, {
      channel: 'DELIVERY',
      categoryTags: ['beer'],
      digestEnabled: false,
    });

    const sparse = await putPreferences(s, s.token7, { digestEnabled: true });
    expect(sparse.status).toBe(200);
    const body = (await sparse.json()) as PreferencesJson;
    expect(body.channel).toBe('DELIVERY');
    expect(body.categoryTags).toEqual(['beer']);
    expect(body.digestEnabled).toBe(true);
  });

  it('accepts the empty categoryTags array — "follows no category" is valid (design D7)', async () => {
    const s = await setup();
    const res = await putPreferences(s, s.token7, {
      categoryTags: [],
      digestEnabled: true,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PreferencesJson).categoryTags).toEqual([]);
  });

  it('clears the channel answer with channel: null (design D8)', async () => {
    const s = await setup();
    await putPreferences(s, s.token7, { channel: 'TRAVEL' });
    const cleared = await putPreferences(s, s.token7, { channel: null });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as PreferencesJson).channel).toBeNull();
  });

  it('translates onboarded: true into onboardedAt; false and absence never unset (design D6)', async () => {
    const s = await setup();
    const completed = await putPreferences(s, s.token7, { onboarded: true });
    const completedBody = (await completed.json()) as PreferencesJson;
    expect(completedBody.onboardedAt).not.toBeNull();

    // A later skip-flavoured write must not unset the recorded completion.
    const later = await putPreferences(s, s.token7, {
      onboarded: false,
      digestEnabled: true,
    });
    const laterBody = (await later.json()) as PreferencesJson;
    expect(laterBody.onboardedAt).toBe(completedBody.onboardedAt);
  });

  it('accepts an empty patch — the sparse contract (design D2)', async () => {
    const s = await setup();
    const res = await putPreferences(s, s.token7, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      channel: null,
      categoryTags: [],
      digestEnabled: false,
      onboardedAt: null,
    });
  });

  it('scopes the row to the session account — another account stays unanswered', async () => {
    const s = await setup();
    await putPreferences(s, s.token7, { channel: 'BOTH', categoryTags: ['beer'] });

    const foreign = await getPreferences(s, s.token9);
    expect(await foreign.json()).toEqual({
      channel: null,
      categoryTags: [],
      digestEnabled: false,
      onboardedAt: null,
    });
  });

  it.each([
    ['an unknown category tag', { categoryTags: ['beer', 'vodka'] }],
    ['a non-array categoryTags', { categoryTags: 'beer' }],
    ['an invalid channel', { channel: 'TELEPORTATION' }],
    ['a null categoryTags', { categoryTags: null }],
    ['a non-boolean digestEnabled', { digestEnabled: 'yes' }],
    ['a non-boolean onboarded', { onboarded: 'yes' }],
  ])('rejects %s with the shared 400 ValidationError envelope', async (_label, body) => {
    const s = await setup();
    const res = await putPreferences(s, s.token7, body);
    await expectEnvelope(res, 400, { error: 'ValidationError' });
  });

  it('rejects a non-JSON body with 400', async () => {
    const s = await setup();
    const res = await request(s.app, s.env, '/api/v1/account/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: cookieOf(s.token7) },
      body: 'not-json',
    });
    await expectEnvelope(res, 400, { error: 'Bad Request' });
  });
});

// ---------------------------------------------------------------------------
// DELETE — the row-preserving reset (design D2: UPDATE, never DELETE)
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/account/preferences', () => {
  it('resets the answers, returns the reset shape, and keeps the row', async () => {
    const s = await setup();
    await putPreferences(s, s.token7, {
      channel: 'TRAVEL',
      categoryTags: ['beer', 'spirits'],
      digestEnabled: true,
      onboarded: true,
    });

    const res = await request(s.app, s.env, '/api/v1/account/preferences', {
      method: 'DELETE',
      headers: { cookie: cookieOf(s.token7) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      channel: null,
      categoryTags: [],
      digestEnabled: false,
      onboardedAt: null,
    });

    // Row semantics: the answers cleared, the row itself survives
    // (id/created_at preserved — the repository's UPDATE, never DELETE).
    const rows = s.db
      .prepare(
        `SELECT id, created_at FROM account_preferences WHERE account_id = 7`,
      )
      .all() as unknown as Array<{ id: number; created_at: string }>;
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.created_at).toISOString()).toBe(rows[0]!.created_at);

    const read = await getPreferences(s, s.token7);
    expect(await read.json()).toEqual({
      channel: null,
      categoryTags: [],
      digestEnabled: false,
      onboardedAt: null,
    });
  });

  it('is idempotent for an account without a row — unanswered shape, no row created', async () => {
    const s = await setup();
    const res = await request(s.app, s.env, '/api/v1/account/preferences', {
      method: 'DELETE',
      headers: { cookie: cookieOf(s.token7) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      channel: null,
      categoryTags: [],
      digestEnabled: false,
      onboardedAt: null,
    });
    // Data minimization: no row materialized by a write-less reset.
    const rows = s.db
      .prepare(`SELECT id FROM account_preferences WHERE account_id = 7`)
      .all();
    expect(rows).toHaveLength(0);
  });

  it('scopes the reset to the session account', async () => {
    const s = await setup();
    await putPreferences(s, s.token7, { channel: 'BOTH', categoryTags: ['beer'] });
    await putPreferences(s, s.token9, { channel: 'DELIVERY', digestEnabled: true });

    await request(s.app, s.env, '/api/v1/account/preferences', {
      method: 'DELETE',
      headers: { cookie: cookieOf(s.token7) },
    });

    const foreign = await getPreferences(s, s.token9);
    const body = (await foreign.json()) as PreferencesJson;
    expect(body.channel).toBe('DELIVERY');
    expect(body.digestEnabled).toBe(true);
  });
});
