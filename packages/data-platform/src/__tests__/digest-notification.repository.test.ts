/**
 * D1 digest-notification repository — real-SQLite tests (task 1.3,
 * change add-onboarding-preferences) on the node:sqlite harness with
 * the committed migrations applied. Covers the crash-safe intent-log
 * contract of design D5: the (account_id, digest_week) UNIQUE guard as
 * the idempotent-create / re-entry mechanism, the pending-only outcome
 * marking (pending → delivered | failed exactly once, attempt facts
 * immutable), the CHECK-constrained channel, and the account cascade
 * behind the GDPR erasure guarantee.
 *
 * @module D1DigestNotificationRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from '../repositories/d1/__tests__/d1-test-harness';
import {
  D1DigestNotificationRepository,
  DuplicateDigestIntentError,
} from '../repositories/d1/digest-notification.repository';

const { db, d1 } = openMigratedD1();
const digest = new D1DigestNotificationRepository(d1);

/** Fresh DB per test would be cleaner; ids stay unique per test instead. */
let accountIdSeq = 600;
function seedAccount(): number {
  const id = ++accountIdSeq;
  db.prepare(`INSERT INTO accounts (id, user_id, email) VALUES (?, ?, ?)`).run(
    id,
    `user-${id}@test.invalid`,
    `user-${id}@test.invalid`,
  );
  return id;
}

describe('D1DigestNotificationRepository.createIntent', () => {
  it('writes a pending intent row born at the instant of intent', async () => {
    const accountId = seedAccount();

    const row = await digest.createIntent({
      accountId,
      digestWeek: '2026-W41',
      channel: 'email',
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.accountId).toBe(accountId);
    expect(row.digestWeek).toBe('2026-W41');
    expect(row.channel).toBe('email');
    expect(row.deliveryStatus).toBe('pending');
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.markedAt).toBeNull();
  });

  it('rejects a duplicate (account, week) intent with the domain error and leaves the original row untouched', async () => {
    const accountId = seedAccount();
    const first = await digest.createIntent({
      accountId,
      digestWeek: '2026-W41',
      channel: 'email',
    });
    // The first run marked its outcome — the re-run must still hit the
    // UNIQUE guard, not resurrect a second intent (design D5 re-entry).
    await digest.markDelivered(first.id);

    await expect(
      digest.createIntent({ accountId, digestWeek: '2026-W41', channel: 'email' }),
    ).rejects.toThrowError(DuplicateDigestIntentError);

    const row = await digest.findByAccountAndWeek(accountId, '2026-W41');
    expect(row).not.toBeNull();
    expect(row!.id).toBe(first.id);
    expect(row!.deliveryStatus).toBe('delivered');
  });

  it('scopes intents per (account, week): other accounts and other weeks never collide', async () => {
    const accountId = seedAccount();
    const otherAccountId = seedAccount();
    await digest.createIntent({ accountId, digestWeek: '2026-W41', channel: 'email' });

    const otherAccount = await digest.createIntent({
      accountId: otherAccountId,
      digestWeek: '2026-W41',
      channel: 'email',
    });
    const otherWeek = await digest.createIntent({
      accountId,
      digestWeek: '2026-W42',
      channel: 'email',
    });

    expect(otherAccount.accountId).toBe(otherAccountId);
    expect(otherWeek.digestWeek).toBe('2026-W42');
    expect(otherWeek.accountId).toBe(accountId);
  });

  it('rejects a non-email channel on the schema CHECK — the intent log leaves the system by email only', () => {
    const accountId = seedAccount();

    expect(() =>
      db
        .prepare(
          `INSERT INTO digest_notifications (account_id, digest_week, channel)
           VALUES (?, ?, 'sms')`,
        )
        .run(accountId, '2026-W41'),
    ).toThrowError(/CHECK constraint failed/);
  });
});

describe('D1DigestNotificationRepository.findByAccountAndWeek', () => {
  it('returns null when no intent exists for the (account, week) pair', async () => {
    expect(await digest.findByAccountAndWeek(seedAccount(), '2026-W41')).toBeNull();
  });

  it('reads the exact pair — a row for another week or another account is invisible', async () => {
    const accountId = seedAccount();
    const otherAccountId = seedAccount();
    const created = await digest.createIntent({
      accountId,
      digestWeek: '2026-W41',
      channel: 'email',
    });
    await digest.createIntent({
      accountId: otherAccountId,
      digestWeek: '2026-W42',
      channel: 'email',
    });

    expect((await digest.findByAccountAndWeek(accountId, '2026-W41'))!.id).toBe(
      created.id,
    );
    expect(await digest.findByAccountAndWeek(accountId, '2026-W42')).toBeNull();
    expect(await digest.findByAccountAndWeek(otherAccountId, '2026-W41')).toBeNull();
  });
});

describe('D1DigestNotificationRepository.markDelivered (pending-only, design D5)', () => {
  it('marks a pending row delivered once, stamping marked_at exactly once', async () => {
    const accountId = seedAccount();
    const intent = await digest.createIntent({
      accountId,
      digestWeek: '2026-W41',
      channel: 'email',
    });

    const marked = await digest.markDelivered(intent.id);

    expect(marked).not.toBeNull();
    expect(marked!.deliveryStatus).toBe('delivered');
    expect(marked!.markedAt).toBeInstanceOf(Date);
    // Attempt facts are immutable — only the outcome transition happened.
    expect(marked!.accountId).toBe(intent.accountId);
    expect(marked!.digestWeek).toBe(intent.digestWeek);
    expect(marked!.channel).toBe(intent.channel);

    // One-shot: the repeat marking matches no pending row and returns
    // null instead of restamping marked_at.
    const repeated = await digest.markDelivered(intent.id);
    expect(repeated).toBeNull();

    const row = await digest.findByAccountAndWeek(accountId, '2026-W41');
    expect(row!.deliveryStatus).toBe('delivered');
    expect(row!.markedAt!.getTime()).toBe(marked!.markedAt!.getTime());
  });

  it('never flips a delivered row to failed — the failed marking on a delivered row is a no-op', async () => {
    const accountId = seedAccount();
    const intent = await digest.createIntent({
      accountId,
      digestWeek: '2026-W41',
      channel: 'email',
    });
    const marked = await digest.markDelivered(intent.id);

    expect(await digest.markFailed(intent.id)).toBeNull();

    const row = await digest.findByAccountAndWeek(accountId, '2026-W41');
    expect(row!.deliveryStatus).toBe('delivered');
    expect(row!.markedAt!.getTime()).toBe(marked!.markedAt!.getTime());
  });

  it('returns null for a nonexistent notification id', async () => {
    expect(await digest.markDelivered(987654)).toBeNull();
  });
});

describe('D1DigestNotificationRepository.markFailed (pending-only, design D5)', () => {
  it('marks a pending row failed once — and a failed row never resurrects to delivered', async () => {
    const accountId = seedAccount();
    const intent = await digest.createIntent({
      accountId,
      digestWeek: '2026-W41',
      channel: 'email',
    });

    const marked = await digest.markFailed(intent.id);
    expect(marked).not.toBeNull();
    expect(marked!.deliveryStatus).toBe('failed');
    expect(marked!.markedAt).toBeInstanceOf(Date);

    expect(await digest.markDelivered(intent.id)).toBeNull();
    expect(await digest.markFailed(intent.id)).toBeNull();

    const row = await digest.findByAccountAndWeek(accountId, '2026-W41');
    expect(row!.deliveryStatus).toBe('failed');
  });

  it('returns null for a nonexistent notification id', async () => {
    expect(await digest.markFailed(987654)).toBeNull();
  });
});

describe('D1DigestNotificationRepository cascade (GDPR erasure)', () => {
  it('deletes the account’s digest intents with the account — the erasure path cannot orphan an intent', async () => {
    const accountId = seedAccount();
    await digest.createIntent({ accountId, digestWeek: '2026-W41', channel: 'email' });
    await digest.createIntent({ accountId, digestWeek: '2026-W42', channel: 'email' });
    const survivorAccountId = seedAccount();
    const survivor = await digest.createIntent({
      accountId: survivorAccountId,
      digestWeek: '2026-W41',
      channel: 'email',
    });

    db.prepare(`DELETE FROM accounts WHERE id = ?`).run(accountId);

    expect(await digest.findByAccountAndWeek(accountId, '2026-W41')).toBeNull();
    expect(await digest.findByAccountAndWeek(accountId, '2026-W42')).toBeNull();
    // Other accounts' intents are untouched by the erasure.
    expect(
      (await digest.findByAccountAndWeek(survivorAccountId, '2026-W41'))!.id,
    ).toBe(survivor.id);
  });
});
