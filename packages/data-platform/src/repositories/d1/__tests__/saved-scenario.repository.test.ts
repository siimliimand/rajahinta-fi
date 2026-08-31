/**
 * D1SavedScenarioRepository — real-SQLite tests (task 2.5): upsert by
 * name replaces exactly inputs+updatedAt, listing by account and by
 * external user id, account-scoped delete (never cross-account).
 *
 * @module D1SavedScenarioRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1SavedScenarioRepository } from '../saved-scenario.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1SavedScenarioRepository(d1);

let accountSeq = 300;
async function seedAccount(): Promise<{ id: number; userId: string }> {
  const id = ++accountSeq;
  const userId = `scenario-user-${id}`;
  db.prepare('INSERT INTO accounts (id, user_id, email) VALUES (?, ?, ?)').run(
    id,
    userId,
    `${userId}@test.invalid`,
  );
  return { id, userId };
}

describe('D1SavedScenarioRepository', () => {
  it('upserts a new scenario and reads it back with parsed inputs', async () => {
    const account = await seedAccount();
    const inputs = { productId: 7, quantity: 6, destination: 'FI' };
    const row = await repo.upsert({ accountId: account.id, name: 'party-beer', inputs });

    expect(row.accountId).toBe(account.id);
    expect(row.inputs).toEqual(inputs);
    expect(row.createdAt).toBeInstanceOf(Date);

    expect(await repo.findByAccountId(account.id)).toEqual([row]);
  });

  it('re-saving under an existing name replaces exactly inputs and updatedAt', async () => {
    const account = await seedAccount();
    const original = await repo.upsert({
      accountId: account.id,
      name: 'weekly',
      inputs: { productId: 1, quantity: 12, destination: 'FI' },
    });

    const replaced = await repo.upsert({
      accountId: account.id,
      name: 'weekly',
      inputs: { productId: 2, quantity: 6, destination: 'SE', transportMethod: 'posti' },
    });

    // Identity columns are stable — only inputs and updatedAt refresh.
    expect(replaced.id).toBe(original.id);
    expect(replaced.createdAt).toEqual(original.createdAt);
    expect(replaced.inputs).toEqual({ productId: 2, quantity: 6, destination: 'SE', transportMethod: 'posti' });
    expect(replaced.updatedAt.getTime()).toBeGreaterThanOrEqual(original.updatedAt.getTime());

    const all = await repo.findByAccountId(account.id);
    expect(all).toHaveLength(1);
  });

  it('lists by the external user id through the accounts join', async () => {
    const account = await seedAccount();
    await repo.upsert({
      accountId: account.id,
      name: 'by-user',
      inputs: { productId: 3, quantity: 1, destination: 'FI' },
    });

    const byUser = await repo.findByUserId(account.userId);
    expect(byUser.map((s) => s.name)).toEqual(['by-user']);
    // Flat projection — raw record shape, not the nested join shape.
    expect(byUser[0]).toMatchObject({ accountId: account.id });
  });

  it('deletes only within the owning account — a cross-account id matches no row', async () => {
    const owner = await seedAccount();
    const other = await seedAccount();
    const victim = await repo.upsert({
      accountId: owner.id,
      name: 'mine',
      inputs: { productId: 5, quantity: 2, destination: 'FI' },
    });
    const foreign = await repo.upsert({
      accountId: other.id,
      name: 'theirs',
      inputs: { productId: 6, quantity: 3, destination: 'FI' },
    });

    // Deleting the foreign scenario id scoped to the owner's account: no-op.
    await expect(repo.delete(owner.id, foreign.id)).resolves.toBeUndefined();
    expect(await repo.findByAccountId(other.id)).toHaveLength(1);

    await repo.delete(owner.id, victim.id);
    expect(await repo.findByAccountId(owner.id)).toEqual([]);
  });
});
