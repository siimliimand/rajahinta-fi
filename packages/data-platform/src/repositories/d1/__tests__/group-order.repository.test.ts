/**
 * D1GroupOrderRepository — real-SQLite tests (task 9.1, change
 * product-roadmap-phases-1-4) on the node:sqlite harness with the
 * committed migrations applied. Covers: owner-bound session create with
 * the share token's uniqueness, the expiry-aware read semantics
 * (expired sessions are returned with an explicit `expired` flag —
 * enforcement is the API's concern; the edge instant is expired),
 * item add/list with the deterministic (addedAt, id) ledger order,
 * the per-participant rollup, cascade deletes (session → items,
 * account → sessions → items), and the design R12 structural
 * assertion: the tables' exact column sets contain no
 * payment-adjacent column — the accounting-only boundary is enforced
 * at the schema level.
 *
 * @module D1GroupOrderRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1GroupOrderRepository,
  type GroupOrderItemInsert,
  type GroupOrderSessionInsert,
} from '../group-order.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1GroupOrderRepository(d1);

const FUTURE = '2090-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const EDGE = '2035-06-01T12:00:00.000Z';

function seedAccount(id: number): void {
  db.prepare(
    `INSERT INTO accounts (id, user_id, email, tier) VALUES (?, ?, ?, 'FREE')`,
  ).run(id, `group-order-test-${id}`, `go-${id}@test.invalid`);
}

function seedProduct(id: number): void {
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
     VALUES (?, ?, 'Hartwall', 'Karhu', 'beer', 0.5, 'can', 'beer')`,
  ).run(id, `product-${id}`);
}

function session(overrides: Partial<GroupOrderSessionInsert> = {}): GroupOrderSessionInsert {
  return {
    ownerAccountId: 501,
    shareToken: 'tok-shared-default',
    expiresAt: FUTURE,
    ...overrides,
  };
}

function item(overrides: Partial<GroupOrderItemInsert> = {}): GroupOrderItemInsert {
  return {
    sessionId: 0, // every call site overrides — sessions are created per test
    participantNickname: 'Ada',
    productId: 301,
    quantity: 2,
    ...overrides,
  };
}

seedAccount(501);
seedAccount(502);
seedProduct(301);
seedProduct(302);
seedProduct(303);

describe('D1GroupOrderRepository — owner-bound session create', () => {
  it('creates a session for the owner and reads back the full record', async () => {
    const created = await repo.createSession(
      session({ shareToken: 'tok-create-1', ownerAccountId: 501 }),
    );

    expect(created.id).toBeGreaterThan(0);
    expect(created.ownerAccountId).toBe(501);
    expect(created.shareToken).toBe('tok-create-1');
    expect(created.expiresAt.toISOString()).toBe(FUTURE);
    expect(created.createdAt).toBeInstanceOf(Date);

    const view = await repo.findSessionById(created.id, new Date('2026-01-01T00:00:00.000Z'));
    expect(view).not.toBeNull();
    expect(view!.session.id).toBe(created.id);
    expect(view!.session.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a session whose owner account does not exist (the create path is owner-bound)', async () => {
    await expect(
      repo.createSession(session({ shareToken: 'tok-no-owner', ownerAccountId: 999_999 })),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rejects a duplicate share token — one token identifies exactly one session', async () => {
    await repo.createSession(session({ shareToken: 'tok-dup-unique' }));
    await expect(
      repo.createSession(session({ shareToken: 'tok-dup-unique', ownerAccountId: 502 })),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('a blank share token is unrepresentable at rest (credential-generation bug, not a session)', async () => {
    await expect(repo.createSession(session({ shareToken: '' }))).rejects.toThrow(
      /CHECK constraint failed/,
    );
  });
});

describe('D1GroupOrderRepository — expiry-aware reads (documented semantics)', () => {
  const LIVE_TOKEN = 'tok-expiry-live';
  const DEAD_TOKEN = 'tok-expiry-dead';
  const EDGE_TOKEN = 'tok-expiry-edge';

  it('creates the fixtures the expiry tests read', async () => {
    await repo.createSession(session({ shareToken: LIVE_TOKEN, expiresAt: FUTURE }));
    await repo.createSession(session({ shareToken: DEAD_TOKEN, expiresAt: PAST }));
    await repo.createSession(session({ shareToken: EDGE_TOKEN, expiresAt: EDGE }));
  });

  it('returns an unexpired session with expired=false — and an expired one STILL as a row with expired=true (honest read; rejection is the API layer 9.3)', async () => {
    await expect(
      repo.findByShareToken(LIVE_TOKEN, new Date('2026-01-01T00:00:00.000Z')),
    ).resolves.toMatchObject({ expired: false, session: { shareToken: LIVE_TOKEN } });

    const dead = await repo.findByShareToken(DEAD_TOKEN, new Date('2026-01-01T00:00:00.000Z'));
    expect(dead).not.toBeNull(); // the row is exposed, not hidden
    expect(dead!.expired).toBe(true);
    expect(dead!.session.expiresAt.toISOString()).toBe(PAST);
  });

  it('expiresAt is an exclusive edge — at exactly the expiry instant the session reads expired', async () => {
    const justBefore = await repo.findByShareToken(
      EDGE_TOKEN,
      new Date('2035-06-01T11:59:59.999Z'),
    );
    expect(justBefore!.expired).toBe(false);

    const atEdge = await repo.findByShareToken(EDGE_TOKEN, new Date(EDGE));
    expect(atEdge!.expired).toBe(true);

    const after = await repo.findByShareToken(EDGE_TOKEN, new Date('2035-06-01T12:00:00.001Z'));
    expect(after!.expired).toBe(true);
  });

  it('an unknown token is null — never a guessed session', async () => {
    await expect(repo.findByShareToken('tok-never-issued')).resolves.toBeNull();
  });

  it('findSessionById follows the same expiry semantics', async () => {
    const created = await repo.createSession(session({ shareToken: 'tok-expiry-byid', expiresAt: PAST }));
    const view = await repo.findSessionById(created.id, new Date('2026-01-01T00:00:00.000Z'));
    expect(view!.expired).toBe(true);
    await expect(repo.findSessionById(999_999)).resolves.toBeNull();
  });

  it('defaults now to the current instant — a past expiry reads expired without an explicit now', async () => {
    const view = await repo.findByShareToken(DEAD_TOKEN);
    expect(view!.expired).toBe(true);
  });
});

describe('D1GroupOrderRepository — item lines', () => {
  it('adds a participant line and reads it back with the auto instant', async () => {
    const host = await repo.createSession(session({ shareToken: 'tok-items-1' }));
    const line = await repo.addItem(
      item({ sessionId: host.id, participantNickname: 'Bert', productId: 302, quantity: 3 }),
    );

    expect(line.id).toBeGreaterThan(0);
    expect(line.sessionId).toBe(host.id);
    expect(line.participantNickname).toBe('Bert');
    expect(line.productId).toBe(302);
    expect(line.quantity).toBe(3);
    expect(line.addedAt).toBeInstanceOf(Date);
  });

  it('rejects a line for an unknown session or unknown product (FK)', async () => {
    const host = await repo.createSession(session({ shareToken: 'tok-items-fk' }));
    await expect(repo.addItem(item({ sessionId: host.id, productId: 999_999 }))).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
    await expect(repo.addItem(item({ sessionId: 999_999 }))).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('a zero or negative quantity is unrepresentable at rest', async () => {
    const host = await repo.createSession(session({ shareToken: 'tok-items-check' }));
    await expect(repo.addItem(item({ sessionId: host.id, quantity: 0 }))).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(repo.addItem(item({ sessionId: host.id, quantity: -1 }))).rejects.toThrow(
      /CHECK constraint failed/,
    );
  });

  it('the write path is deliberately NOT expiry-aware — adding to an expired session lands; the API gates that via the token read (task 9.3)', async () => {
    const host = await repo.createSession(session({ shareToken: 'tok-expired-write', expiresAt: PAST }));
    const read = await repo.findByShareToken('tok-expired-write', new Date('2026-01-01T00:00:00.000Z'));
    expect(read!.expired).toBe(true); // the API would refuse here

    const line = await repo.addItem(item({ sessionId: host.id }));
    expect(line.id).toBeGreaterThan(0); // repository stays single-purpose and honest
  });

  it('listItems orders by addedAt then id — deterministic even for same-millisecond ties', async () => {
    const host = await repo.createSession(session({ shareToken: 'tok-items-order' }));
    // Direct inserts control the instants exactly (repo adds use the wall clock).
    const insert = db.prepare(
      `INSERT INTO group_order_items (session_id, participant_nickname, product_id, quantity, added_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run(host.id, 'Ada', 301, 2, '2091-01-01T00:00:00.000Z'); // id N — same instant as next
    insert.run(host.id, 'Bill', 302, 1, '2091-01-01T00:00:00.000Z'); // id N+1 — id breaks the tie
    insert.run(host.id, 'Ciss', 303, 4, '2090-12-31T00:00:00.000Z'); // earlier instant, inserted last

    const lines = await repo.listItems(host.id);
    expect(lines.map((l) => l.participantNickname)).toEqual(['Ciss', 'Ada', 'Bill']);
    expect(lines[0].addedAt.toISOString()).toBe('2090-12-31T00:00:00.000Z');
  });

  it('listParticipants rolls up per nickname in join order with a deterministic tiebreak', async () => {
    const host = await repo.createSession(session({ shareToken: 'tok-participants' }));
    const insert = db.prepare(
      `INSERT INTO group_order_items (session_id, participant_nickname, product_id, quantity, added_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run(host.id, 'Zack', 301, 1, '2092-01-01T00:00:00.000Z'); // joined last
    insert.run(host.id, 'Bill', 302, 2, '2091-01-01T00:00:00.000Z'); // tie with Ada...
    insert.run(host.id, 'Ada', 303, 3, '2091-01-01T00:00:00.000Z'); // ...nickname ASC wins
    insert.run(host.id, 'Ada', 301, 1, '2091-06-01T00:00:00.000Z'); // Ada's second line

    const participants = await repo.listParticipants(host.id);
    expect(participants.map((p) => p.participantNickname)).toEqual(['Ada', 'Bill', 'Zack']);
    expect(participants[0].itemCount).toBe(2);
    expect(participants[0].firstAddedAt.toISOString()).toBe('2091-01-01T00:00:00.000Z');
    expect(participants[0].lastAddedAt.toISOString()).toBe('2091-06-01T00:00:00.000Z');
    expect(participants[1].itemCount).toBe(1);
    expect(participants[2].itemCount).toBe(1);
  });

  it('listItems/listParticipants of an unknown session return empty — never throw', async () => {
    await expect(repo.listItems(999_999)).resolves.toEqual([]);
    await expect(repo.listParticipants(999_999)).resolves.toEqual([]);
  });
});

describe('D1GroupOrderRepository — cascade deletes', () => {
  it('deleting the session removes its item lines — rows cannot be orphaned', async () => {
    const host = await repo.createSession(session({ shareToken: 'tok-cascade-session' }));
    await repo.addItem(item({ sessionId: host.id, participantNickname: 'Ada' }));
    await repo.addItem(item({ sessionId: host.id, participantNickname: 'Bert', quantity: 1 }));

    db.prepare('DELETE FROM group_order_sessions WHERE id = ?').run(host.id);

    const remaining = db
      .prepare('SELECT COUNT(*) AS n FROM group_order_items WHERE session_id = ?')
      .get(host.id) as { n: number };
    expect(remaining.n).toBe(0);
    await expect(repo.listItems(host.id)).resolves.toEqual([]);
  });

  it('deleting the owner account cascades through sessions to items (GDPR erasure path)', async () => {
    seedAccount(503);
    const host = await repo.createSession(
      session({ shareToken: 'tok-cascade-account', ownerAccountId: 503 }),
    );
    await repo.addItem(item({ sessionId: host.id }));

    db.prepare('DELETE FROM accounts WHERE id = ?').run(503);

    await expect(repo.findSessionById(host.id)).resolves.toBeNull();
    const sessions = db
      .prepare('SELECT COUNT(*) AS n FROM group_order_sessions WHERE owner_account_id = ?')
      .get(503) as { n: number };
    expect(sessions.n).toBe(0);
    await expect(repo.listItems(host.id)).resolves.toEqual([]);
  });
});

describe('D1GroupOrderRepository — schema contract (design R12 accounting-only boundary)', () => {
  // The R12 scenario "No payment fields exist" is structural: the exact
  // column sets leave no column a payment amount, instrument, or
  // settlement state could live in.
  it('group_order_sessions carries exactly the five declared columns', () => {
    const columns = (
      db.prepare('PRAGMA table_info(group_order_sessions)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns).toEqual(['id', 'owner_account_id', 'share_token', 'expires_at', 'created_at']);
  });

  it('group_order_items carries exactly the six declared columns', () => {
    const columns = (
      db.prepare('PRAGMA table_info(group_order_items)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns).toEqual([
      'id',
      'session_id',
      'participant_nickname',
      'product_id',
      'quantity',
      'added_at',
    ]);
  });

  it('no column name matches payment-adjacent vocabulary — on either table', () => {
    const PAYMENT_ADJACENT =
      /amount|currency|price|cents|payment|payout|settle|settlement|transaction|instrument|iban|card|fee|total|cost|value/i;
    for (const table of ['group_order_sessions', 'group_order_items']) {
      const columns = (
        db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).map((c) => c.name);
      for (const column of columns) {
        expect(`${table}.${column}`).not.toMatch(PAYMENT_ADJACENT);
      }
    }
  });
});
