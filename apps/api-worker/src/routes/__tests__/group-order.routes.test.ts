/**
 * Group order route tests (task 9.3, change product-roadmap-phases-1-4)
 * over the FULL app composition (createApp() + registerGroupOrderRoutes —
 * the exact composition index.ts wires, guards first) on the fake-D1
 * harness.
 *
 * Pinning here (beyond plain flows):
 * - the create-route guard ORDER sessionAuth → requireFeatureFlag →
 *   requireAccountRateLimit (alerts precedent: an anonymous caller gets
 *   the 401 envelope even with the flag off; flag state never leaks to
 *   unauthenticated callers on the authenticated route),
 * - the token routes' SPEC-mandated inverse: flag off → share-link
 *   access returns the feature-disabled error even for anonymous callers
 *   (the share token is the capability; there is no sessionAuth to hide
 *   the flag behind),
 * - expiry enforcement including the EXCLUSIVE edge (exactly at the
 *   expiry instant the token is already dead — pinned with faked clock
 *   time set precisely to the seeded edge),
 * - the accounting-only payment-field gate: real payment vocabulary in
 *   payloads is rejected with the NAMED-FIELD validation error, at any
 *   depth,
 * - the cheapest-VERIFIED-EUR-offer valuation rule and the EMPTY_SESSION
 *   / NO_ITEM_VALUE value states passing through as 200,
 * - the rate-limit profile split: create keyed per ACCOUNT (alerts
 *   precedent), token routes keyed per edge IP, ledger at the CALCULATOR
 *   limit.
 *
 * @module GroupOrderRoutesTest
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createApp,
  expectEnvelope,
  issueSessionToken,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedOffer,
  seedProduct,
} from './harness';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';
import type { DatabaseSync } from 'node:sqlite';
import { registerGroupOrderRoutes } from '../group-order.routes';
import {
  findPaymentInstrumentFields,
  isPaymentInstrumentFieldName,
} from '../group-order-dto';

/**
 * index.ts registers the group order handlers behind the guards (same
 * slot as the other route ports); the test composition mirrors that
 * exactly.
 */
function groupOrderApp(): ReturnType<typeof createApp> {
  const app = createApp();
  registerGroupOrderRoutes(app);
  return app;
}

function groupOrderEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, { ...overrides, FF_GROUP_ORDER_LEDGER: 'true' });
}

/** Canonical two-account fixture: 7 is the acting owner, 9 the foreigner. */
function seedAccounts(db: DatabaseSync): void {
  seedAccount(db, { id: 7, userId: 'user-7', email: 'user-7@example.invalid', tier: 'FREE' });
  seedAccount(db, { id: 9, userId: 'user-9', email: 'user-9@placeholder.local', tier: 'FREE' });
}

const cookieOf = (token: string): string => `rajahinta_session=${token}`;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Direct session insert — expiry control the API's fixed TTL denies. */
function seedSession(
  db: DatabaseSync,
  session: { id: number; ownerAccountId: number; shareToken: string; expiresAt: string },
): void {
  db.prepare(
    `INSERT INTO group_order_sessions (id, owner_account_id, share_token, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(session.id, session.ownerAccountId, session.shareToken, session.expiresAt);
}

async function createSession(
  app: ReturnType<typeof createApp>,
  env: Env,
  token: string,
  body: unknown = {},
): Promise<Response> {
  return request(app, env, '/api/v1/group-orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieOf(token) },
    body: JSON.stringify(body),
  });
}

function tokenPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const TOKEN_PATHS = (t: string): readonly string[] => [
  `/api/v1/group-orders/${t}/join`,
  `/api/v1/group-orders/${t}/items`,
  `/api/v1/group-orders/${t}/ledger`,
];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface SessionJson {
  id: number;
  shareToken: string;
  createdAt: string;
  expiresAt: string;
}

interface ItemJson {
  id: number;
  participantNickname: string;
  productId: number;
  quantity: number;
  addedAt: string;
}

interface Setup {
  db: DatabaseSync;
  d1: D1DatabaseLike;
  app: ReturnType<typeof groupOrderApp>;
  env: Env;
  token7: string;
}

async function setup(flagOn: boolean): Promise<Setup> {
  const { db, d1 } = openMigratedD1();
  seedAccounts(db);
  return {
    db,
    d1,
    app: groupOrderApp(),
    env: flagOn ? groupOrderEnv(d1) : lockedEnv(d1),
    token7: await issueSessionToken(d1, 7),
  };
}

/** Live session (future expiry) seeded directly, bypassing the fixed TTL. */
async function setupWithLiveSession(): Promise<Setup & { shareToken: string }> {
  const s = await setup(true);
  const shareToken = '11111111-2222-4333-8444-555555555555';
  seedSession(s.db, {
    id: 1,
    ownerAccountId: 7,
    shareToken,
    expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
  });
  return { ...s, shareToken };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Guard chain: session before flag (create route, alerts order pinned)
// ---------------------------------------------------------------------------

describe('create guard chain — session before flag', () => {
  it('rejects an anonymous caller with the 401 envelope even with the flag on', async () => {
    const { app, env } = await setup(true);
    const res = await request(app, env, '/api/v1/group-orders', { method: 'POST' });
    await expectEnvelope(res, 401, { error: 'SessionRequired' });
  });

  it('rejects an anonymous caller with the 401 envelope even with the flag OFF', async () => {
    const { app, env } = await setup(false);
    const res = await request(app, env, '/api/v1/group-orders', { method: 'POST' });
    await expectEnvelope(res, 401, { error: 'SessionRequired' });
  });

  it('rejects an authenticated caller with 403 while GROUP_ORDER_LEDGER is off', async () => {
    const { app, env, token7 } = await setup(false);
    const res = await createSession(app, env, token7);
    await expectEnvelope(res, 403, {
      message: 'Feature "GROUP_ORDER_LEDGER" is not enabled',
    });
  });
});

// ---------------------------------------------------------------------------
// Token routes — spec: flag off → share-link access returns the
// feature-disabled error (anonymous callers included)
// ---------------------------------------------------------------------------

describe('token routes flag gate', () => {
  it('returns the feature-disabled error on every share-link route while the flag is off', async () => {
    const { app, env } = await setup(false);
    for (const path of TOKEN_PATHS('11111111-2222-4333-8444-555555555555')) {
      const res = await request(app, env, path, tokenPost({}));
      await expectEnvelope(res, 403, {
        message: 'Feature "GROUP_ORDER_LEDGER" is not enabled',
      });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/group-orders — session create
// ---------------------------------------------------------------------------

describe('POST /api/v1/group-orders', () => {
  it('creates a session with a UUIDv4 share token and the fixed 7-day TTL', async () => {
    const { db, app, env, token7 } = await setup(true);
    const before = Date.now();
    const res = await createSession(app, env, token7);
    expect(res.status).toBe(201);
    const body = (await res.json()) as SessionJson;
    expect(body.shareToken).toMatch(UUID_V4);
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);

    const expected = before + 7 * DAY_MS;
    expect(Math.abs(new Date(body.expiresAt).getTime() - expected)).toBeLessThan(5000);

    // Owner-bound: the session row carries the creating account.
    const row = db
      .prepare('SELECT owner_account_id FROM group_order_sessions WHERE id = ?')
      .get(body.id) as { owner_account_id: number };
    expect(row.owner_account_id).toBe(7);
  });

  it('generates a distinct token per session', async () => {
    const { app, env, token7 } = await setup(true);
    const a = (await (await createSession(app, env, token7)).json()) as SessionJson;
    const b = (await (await createSession(app, env, token7)).json()) as SessionJson;
    expect(a.shareToken).not.toBe(b.shareToken);
    expect(a.id).not.toBe(b.id);
  });

  it('accepts an empty body (no fields — owner and TTL are server-derived)', async () => {
    const { app, env, token7 } = await setup(true);
    const res = await request(app, env, '/api/v1/group-orders', {
      method: 'POST',
      headers: { cookie: cookieOf(token7) },
    });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Token scope — unknown 404, expired 410, exclusive expiry edge
// ---------------------------------------------------------------------------

describe('token scope and expiry enforcement', () => {
  it('reports an unknown share token as 404 on every token route', async () => {
    const { app, env } = await setup(true);
    for (const path of TOKEN_PATHS('99999999-9999-4999-8999-999999999999')) {
      const res = await request(app, env, path, tokenPost({}));
      await expectEnvelope(res, 404, { error: 'ShareTokenNotFound' });
    }
  });

  it('rejects an expired token with 410 Gone on every token route', async () => {
    const { db, app, env } = await setup(true);
    seedSession(db, {
      id: 1,
      ownerAccountId: 7,
      shareToken: 'expired-token',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    for (const path of TOKEN_PATHS('expired-token')) {
      const res = await request(app, env, path, tokenPost({}));
      await expectEnvelope(res, 410, { error: 'SessionExpired' });
    }
  });

  it('rejects a token read EXACTLY at its expiry instant (exclusive edge)', async () => {
    const { db, app, env } = await setup(true);
    const edge = new Date(Date.now() + DAY_MS);
    seedSession(db, {
      id: 1,
      ownerAccountId: 7,
      shareToken: 'edge-token',
      expiresAt: edge.toISOString(),
    });
    // Freeze the clock TO the seeded edge: expiresAt <= now must already
    // be expired (the 9.1 boundary, enforced by the route → 410).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(edge.getTime());
    try {
      const res = await request(
        app,
        env,
        `/api/v1/group-orders/edge-token/join`,
        tokenPost({ nickname: 'A' }),
      );
      await expectEnvelope(res, 410, { error: 'SessionExpired' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('still admits the token one millisecond BEFORE the edge', async () => {
    const { db, app, env } = await setup(true);
    const edge = new Date(Date.now() + DAY_MS);
    seedSession(db, {
      id: 1,
      ownerAccountId: 7,
      shareToken: 'edge-token',
      expiresAt: edge.toISOString(),
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(edge.getTime() - 1);
    try {
      const res = await request(
        app,
        env,
        `/api/v1/group-orders/edge-token/join`,
        tokenPost({ nickname: 'A' }),
      );
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('grants a token access only to its own session', async () => {
    const s = await setup(true);
    const first = (await (await createSession(s.app, s.env, s.token7)).json()) as SessionJson;
    const second = (await (await createSession(s.app, s.env, s.token7)).json()) as SessionJson;
    seedProduct(s.db, { id: 1 });
    await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${first.shareToken}/items`,
      tokenPost({ nickname: 'A', productId: 1, quantity: 2 }),
    );

    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${second.shareToken}/join`,
      tokenPost({ nickname: 'B' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { id: number }; items: unknown[] };
    expect(body.session.id).toBe(second.id);
    expect(body.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Join and add-item
// ---------------------------------------------------------------------------

describe('POST /api/v1/group-orders/:shareToken/join', () => {
  it('returns the session state under a nickname, persisting nothing for the join itself', async () => {
    const s = await setupWithLiveSession();
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/join`,
      tokenPost({ nickname: 'Velho' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { id: number; expiresAt: string };
      joinedAs: string;
      participants: unknown[];
      items: unknown[];
    };
    expect(body.session.id).toBe(1);
    expect(body.joinedAs).toBe('Velho');
    expect(body.participants).toEqual([]);
    expect(body.items).toEqual([]);

    const rows = s.db.prepare('SELECT COUNT(*) AS n FROM group_order_items').get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
  });
});

describe('POST /api/v1/group-orders/:shareToken/items', () => {
  it('adds an item under the nickname and lists it on join', async () => {
    const s = await setupWithLiveSession();
    seedProduct(s.db, { id: 1 });
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/items`,
      tokenPost({ nickname: 'A', productId: 1, quantity: 2 }),
    );
    expect(res.status).toBe(201);
    const item = (await res.json()) as ItemJson;
    expect(item.participantNickname).toBe('A');
    expect(item.productId).toBe(1);
    expect(item.quantity).toBe(2);

    const joined = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/join`,
      tokenPost({ nickname: 'B' }),
    );
    const body = (await joined.json()) as { items: ItemJson[]; participants: { nickname: string; itemCount: number }[] };
    expect(body.items).toHaveLength(1);
    expect(body.participants).toEqual([
      { nickname: 'A', itemCount: 1, firstAddedAt: expect.any(String), lastAddedAt: expect.any(String) },
    ]);
  });

  it('rejects an unknown product with 404 before any insert', async () => {
    const s = await setupWithLiveSession();
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/items`,
      tokenPost({ nickname: 'A', productId: 999_999, quantity: 1 }),
    );
    await expectEnvelope(res, 404, { error: 'ProductNotFound' });
    const rows = s.db.prepare('SELECT COUNT(*) AS n FROM group_order_items').get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
  });

  it('rejects an invalid nickname or quantity with 400', async () => {
    const s = await setupWithLiveSession();
    seedProduct(s.db, { id: 1 });
    for (const body of [
      { nickname: '', productId: 1, quantity: 1 },
      { nickname: 'x'.repeat(65), productId: 1, quantity: 1 },
      { nickname: 'A', productId: 1, quantity: 0 },
      { nickname: 'A', productId: 1, quantity: 1000 },
      { nickname: 'A', productId: 1, quantity: 1.5 },
      { nickname: 'A', productId: 1 },
    ]) {
      const res = await request(
        s.app,
        s.env,
        `/api/v1/group-orders/${s.shareToken}/items`,
        tokenPost(body),
      );
      await expectEnvelope(res, 400, { error: 'ValidationError' });
    }
  });
});

// ---------------------------------------------------------------------------
// Payment-instrument field gate — the named-field rejection
// ---------------------------------------------------------------------------

describe('payment-instrument field rejection (accounting-only boundary)', () => {
  const cases: readonly { label: string; key: string }[] = [
    { label: 'cardNumber', key: 'cardNumber' },
    { label: 'card_number', key: 'card_number' },
    { label: 'CARD-NUMBER', key: 'CARD-NUMBER' },
    { label: 'iban', key: 'IBAN' },
    { label: 'paymentMethod', key: 'paymentMethod' },
    { label: 'payment_method', key: 'payment_method' },
    { label: 'amountPaid', key: 'amountPaid' },
    { label: 'cvv', key: 'cvv' },
    { label: 'paypal', key: 'paypal' },
    { label: 'totalPaid', key: 'totalPaid' },
  ];

  it.each(cases)('names the offending field for $label on join', async ({ key }) => {
    const s = await setupWithLiveSession();
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/join`,
      tokenPost({ nickname: 'A', [key]: '4111111111111111' }),
    );
    const body = await expectEnvelope(res, 400, { error: 'ValidationError' });
    expect(body.message).toContain(`field '${key}' is not accepted`);
  });

  it('names a NESTED payment field with its full path', async () => {
    const s = await setupWithLiveSession();
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/ledger`,
      tokenPost({
        sharedCosts: [
          { label: 'shipping', cents: 100, frontedByParticipantId: 'A', paymentMethod: 'sepa' },
        ],
      }),
    );
    const body = await expectEnvelope(res, 400, { error: 'ValidationError' });
    expect(body.message).toContain("field 'sharedCosts[0].paymentMethod' is not accepted");
  });

  it('rejects a payment field on the authenticated create route with the same named error', async () => {
    const s = await setup(true);
    const res = await createSession(s.app, s.env, s.token7, { paypal: 'me@example.invalid' });
    const body = await expectEnvelope(res, 400, { error: 'ValidationError' });
    expect(body.message).toContain("field 'paypal' is not accepted");
  });

  it('rejects a non-payment unknown key via the strict schema (no field named)', async () => {
    const s = await setupWithLiveSession();
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/join`,
      tokenPost({ nickname: 'A', foo: 1 }),
    );
    const body = await expectEnvelope(res, 400, { error: 'ValidationError' });
    expect(body.message).toContain('foo');
    expect(body.message).not.toContain('is not accepted');
  });

  it('screens key NAMES, never values — a payment-sounding nickname is data', async () => {
    const s = await setupWithLiveSession();
    seedProduct(s.db, { id: 1 });
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/items`,
      tokenPost({ nickname: 'PaypalPete', productId: 1, quantity: 1 }),
    );
    expect(res.status).toBe(201);
  });

  it('unit: the vocabulary matcher and deep-walk paths are pinned', () => {
    for (const key of [
      'cardNumber', 'card_number', 'cvv', 'CVC', 'iban', 'IBAN', 'bic',
      'paymentMethod', 'payment_intent', 'amountPaid', 'amount-paid',
      'totalPaid', 'paypal', 'stripe', 'routingNumber', 'billingAddress',
    ]) {
      expect(isPaymentInstrumentFieldName(key), key).toBe(true);
    }
    for (const key of [
      'nickname', 'productId', 'quantity', 'shareToken', 'sharedCosts',
      'label', 'cents', 'frontedByParticipantId', 'createdAt', 'expiresAt',
    ]) {
      expect(isPaymentInstrumentFieldName(key), key).toBe(false);
    }
    expect(findPaymentInstrumentFields({ a: { b: [{ iban: 'X' }] } })).toEqual(['a.b[0].iban']);
    expect(findPaymentInstrumentFields({ nickname: 'A' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ledger compute — valuation rule, allocation, value states
// ---------------------------------------------------------------------------

interface LedgerResponse {
  session: { id: number };
  valuationRule: string;
  itemValuations: {
    productId: number;
    quantity: number;
    unitValueCents: number | null;
    itemValueCents: number;
  }[];
  ledger: {
    status: string;
    totalItemValueCents: number;
    totalSharedCostCents: number;
    sharedCosts: {
      label: string;
      sharedCostCents: number;
      frontedByParticipantId: string;
      perParticipant: { participantId: string; allocatedCents: number }[];
    }[];
    participants: {
      participantId: string;
      itemValueCents: number;
      frontedSharedCostCents: number;
      netBalanceCents: number;
    }[];
    transfers: { fromParticipantId: string; toParticipantId: string; cents: number }[];
    note: { text: string };
  };
}

async function addItem(
  s: Setup,
  shareToken: string,
  nickname: string,
  productId: number,
  quantity: number,
): Promise<void> {
  const res = await request(
    s.app,
    s.env,
    `/api/v1/group-orders/${shareToken}/items`,
    tokenPost({ nickname, productId, quantity }),
  );
  expect(res.status).toBe(201);
}

describe('POST /api/v1/group-orders/:shareToken/ledger', () => {
  it('computes the proportional split and minimal transfers from cheapest-VERIFIED values', async () => {
    const s = await setupWithLiveSession();
    seedProduct(s.db, { id: 1 });
    // Cheapest VERIFIED EUR offer wins: 280, regardless of the cheaper
    // ESTIMATED 250, and the cheaper VERIFIED but non-EUR (SEK) 200 —
    // this layer never invents an FX conversion (documented rule).
    seedOffer(s.db, { id: 11, productId: 1, priceCents: 250, reliabilityStatus: 'ESTIMATED' });
    seedOffer(s.db, { id: 12, productId: 1, priceCents: 300, reliabilityStatus: 'VERIFIED' });
    seedOffer(s.db, { id: 13, productId: 1, priceCents: 280, reliabilityStatus: 'VERIFIED' });
    s.db.prepare(
      `INSERT INTO retail_offers (
         id, merchant, country, product_id, price_cents, currency,
         availability, source_url, observed_at, reliability_status
       ) VALUES (14, 'systembolaget', 'SE', 1, 200, 'SEK', 'in_stock',
                 'https://example.invalid/offer', ?, 'VERIFIED')`,
    ).run(new Date().toISOString());
    // ^ the harness seedOffer pins currency 'EUR'; the SEK row is raw.
    await addItem(s, s.shareToken, 'A', 1, 2); // 2 × 280 = 560
    await addItem(s, s.shareToken, 'B', 1, 1); // 1 × 280 = 280

    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/ledger`,
      tokenPost({
        sharedCosts: [{ label: 'shipping', cents: 100, frontedByParticipantId: 'A' }],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as LedgerResponse;
    expect(body.valuationRule).toBe('CHEAPEST_VERIFIED_EUR_OFFER');
    expect(body.itemValuations).toEqual([
      { productId: 1, quantity: 2, unitValueCents: 280, itemValueCents: 560 },
      { productId: 1, quantity: 1, unitValueCents: 280, itemValueCents: 280 },
    ]);

    // V = 840; A: 100·560/840 = 66.67 → 66 + remainder cent (frac 56000 mod
    // 840 = 560 > B's 280) = 67; B: 33. Balances: A +33, B −33 → one
    // transfer B → A of 33 cents.
    expect(body.ledger.status).toBe('COMPUTED');
    expect(body.ledger.totalItemValueCents).toBe(840);
    expect(body.ledger.totalSharedCostCents).toBe(100);
    expect(body.ledger.participants).toEqual([
      expect.objectContaining({ participantId: 'A', netBalanceCents: 33 }),
      expect.objectContaining({ participantId: 'B', netBalanceCents: -33 }),
    ]);
    expect(body.ledger.transfers).toEqual([
      { fromParticipantId: 'B', toParticipantId: 'A', cents: 33 },
    ]);
    // Structural settlement-boundary note travels with the result.
    expect(body.ledger.note.text.length).toBeGreaterThan(0);
  });

  it('reports an unvalued product as a stated null gap while valued items allocate', async () => {
    const s = await setupWithLiveSession();
    seedProduct(s.db, { id: 1 });
    seedProduct(s.db, { id: 2, name: 'No-offer cider' });
    seedOffer(s.db, { id: 11, productId: 1, priceCents: 350, reliabilityStatus: 'VERIFIED' });
    await addItem(s, s.shareToken, 'A', 1, 1); // 350
    await addItem(s, s.shareToken, 'B', 2, 1); // no VERIFIED EUR offer → 0

    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/ledger`,
      tokenPost({
        sharedCosts: [{ label: 'duty', cents: 70, frontedByParticipantId: 'A' }],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as LedgerResponse;
    expect(body.itemValuations[1]).toEqual({
      productId: 2,
      quantity: 1,
      unitValueCents: null,
      itemValueCents: 0,
    });
    expect(body.ledger.status).toBe('COMPUTED');
    expect(body.ledger.totalItemValueCents).toBe(350);
  });

  it('passes EMPTY_SESSION through as a 200 value state', async () => {
    const s = await setupWithLiveSession();
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/ledger`,
      tokenPost({}),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as LedgerResponse;
    expect(body.ledger.status).toBe('EMPTY_SESSION');
    expect(body.ledger.transfers).toEqual([]);
  });

  it('passes NO_ITEM_VALUE through as a 200 value state when nothing has a resolvable value', async () => {
    const s = await setupWithLiveSession();
    seedProduct(s.db, { id: 1 }); // exists, but no offers at all
    await addItem(s, s.shareToken, 'A', 1, 2);
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/ledger`,
      tokenPost({
        sharedCosts: [{ label: 'shipping', cents: 100, frontedByParticipantId: 'A' }],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as LedgerResponse;
    expect(body.ledger.status).toBe('NO_ITEM_VALUE');
    expect(body.ledger.transfers).toEqual([]);
    expect(body.ledger.totalSharedCostCents).toBe(100);
  });

  it('rejects shared costs on a session with no participants (400 — nothing to attribute to)', async () => {
    const s = await setupWithLiveSession();
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/ledger`,
      tokenPost({
        sharedCosts: [{ label: 'shipping', cents: 100, frontedByParticipantId: 'A' }],
      }),
    );
    const body = await expectEnvelope(res, 400, { error: 'ValidationError' });
    // The fronting pre-check fires first — there is no participant "A" to
    // attribute the line to (the module's SHARED_COST_WITHOUT_PARTICIPANTS
    // stays as unreachable defense in depth behind it).
    expect(body.message).toContain('frontedByParticipantId "A"');
  });

  it('rejects an unknown fronting participant with a clean 400 naming the value', async () => {
    const s = await setupWithLiveSession();
    seedProduct(s.db, { id: 1 });
    await addItem(s, s.shareToken, 'A', 1, 1);
    const res = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/ledger`,
      tokenPost({
        sharedCosts: [{ label: 'shipping', cents: 100, frontedByParticipantId: 'Mystery' }],
      }),
    );
    const body = await expectEnvelope(res, 400, { error: 'ValidationError' });
    expect(body.message).toContain('frontedByParticipantId "Mystery"');
  });

  it('rejects invalid shared-cost lines with 400', async () => {
    const s = await setupWithLiveSession();
    seedProduct(s.db, { id: 1 });
    await addItem(s, s.shareToken, 'A', 1, 1);
    for (const sharedCosts of [
      [{ label: '', cents: 100, frontedByParticipantId: 'A' }],
      [{ label: 'x', cents: -1, frontedByParticipantId: 'A' }],
      [{ label: 'x', cents: 1.5, frontedByParticipantId: 'A' }],
      [{ label: 'x', cents: 100_000_001, frontedByParticipantId: 'A' }],
      [{ label: 'x', cents: 100, frontedByParticipantId: '' }],
    ]) {
      const res = await request(
        s.app,
        s.env,
        `/api/v1/group-orders/${s.shareToken}/ledger`,
        tokenPost({ sharedCosts }),
      );
      await expectEnvelope(res, 400, { error: 'ValidationError' });
    }
  });
});

// ---------------------------------------------------------------------------
// Rate limits — create per ACCOUNT, token routes per IP, ledger CALCULATOR
// ---------------------------------------------------------------------------

describe('group order rate limits', () => {
  it('create: admits 60/min per account, 429s the 61st, leaves another account unaffected', async () => {
    const { app, env, token7, d1 } = await setup(true);
    for (let i = 0; i < 60; i++) {
      const res = await createSession(app, env, token7);
      expect(res.status, `request #${String(i + 1)}`).toBe(201);
    }
    const rejected = await createSession(app, env, token7);
    await expectEnvelope(rejected, 429, { error: 'TooManyRequests' });
    expect(rejected.headers.get('Retry-After')).not.toBeNull();

    // The create bucket key is the account, not the (shared) edge IP —
    // account 9 has its own window.
    const token9 = await issueSessionToken(d1, 9);
    const other = await createSession(app, env, token9);
    expect(other.status).toBe(201);
  });

  it('token routes: DEFAULT profile keyed per edge IP; the account-keyed create bucket is separate', async () => {
    const s = await setupWithLiveSession();
    for (let i = 0; i < 60; i++) {
      const res = await request(
        s.app,
        s.env,
        `/api/v1/group-orders/${s.shareToken}/join`,
        tokenPost({ nickname: 'A' }),
      );
      expect(res.status, `request #${String(i + 1)}`).toBe(200);
    }
    const rejected = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/join`,
      tokenPost({ nickname: 'A' }),
    );
    await expectEnvelope(rejected, 429, { error: 'TooManyRequests' });

    // The create route buckets per ACCOUNT, not per IP — unaffected by the
    // exhausted edge-IP window above.
    const own = await createSession(s.app, s.env, s.token7);
    expect(own.status).toBe(201);
  });

  it('ledger: CALCULATOR profile admits 10/min and 429s the 11th', async () => {
    const s = await setupWithLiveSession();
    for (let i = 0; i < 10; i++) {
      const res = await request(
        s.app,
        s.env,
        `/api/v1/group-orders/${s.shareToken}/ledger`,
        tokenPost({}),
      );
      expect(res.status, `request #${String(i + 1)}`).toBe(200);
    }
    const rejected = await request(
      s.app,
      s.env,
      `/api/v1/group-orders/${s.shareToken}/ledger`,
      tokenPost({}),
    );
    await expectEnvelope(rejected, 429, { error: 'TooManyRequests' });
  });
});
