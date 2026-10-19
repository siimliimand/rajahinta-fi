/**
 * D1CorrectionRepository — real-SQLite tests (task 1.2, change
 * durable-corrections-store), pinning the semantics ported from the
 * reference InMemoryCorrectionRepository: CRUD (repository-assigned id,
 * ISO timestamps, open defaults), newest-first findAll over open AND
 * resolved rows, resolve persistence, unknown-id null, and idempotent
 * re-resolve.
 *
 * @module D1CorrectionRepositoryTest
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1CorrectionRepository } from '../corrections.repository';

/**
 * A fresh store per test: the exact-list assertions (findAll newest-first)
 * assume an empty table, so a shared database would leak rows between tests.
 */
let repo: D1CorrectionRepository;

beforeEach(() => {
  const { d1 } = openMigratedD1();
  repo = new D1CorrectionRepository(d1);
});

/**
 * Timestamps carry millisecond precision; back-to-back creates can land
 * in the same millisecond, so ordering/refresh assertions pause briefly.
 */
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 5));

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const BASE_INPUT = {
  targetType: 'calculation',
  targetId: 42,
  reason: 'price looks stale',
} as const;

describe('D1CorrectionRepository — CRUD', () => {
  it('creates a flag with a repository-assigned id, ISO timestamps, and open defaults', async () => {
    const created = await repo.create({
      ...BASE_INPUT,
      targetType: 'data_point',
      reason: 'unit mismatch',
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.targetType).toBe('data_point');
    expect(created.targetId).toBe(42);
    expect(created.reason).toBe('unit mismatch');
    expect(created.status).toBe('open');
    expect(created.createdAt).toMatch(ISO_8601);
    expect(created.resolvedAt).toBeNull();
    expect(created.resolution).toBeNull();
  });

  it('persists distinct reasons and target ids per flag', async () => {
    const a = await repo.create({ ...BASE_INPUT, targetId: 1, reason: 'first' });
    const b = await repo.create({
      targetType: 'data_point',
      targetId: 2,
      reason: 'second',
    });
    expect(a.id).not.toBe(b.id);
    expect(a.reason).toBe('first');
    expect(b.reason).toBe('second');
  });
});

describe('D1CorrectionRepository — findAll', () => {
  it('lists every flag newest first, open AND resolved together', async () => {
    const first = await repo.create({ ...BASE_INPUT, targetId: 11, reason: 'oldest' });
    await tick();
    const second = await repo.create({ ...BASE_INPUT, targetId: 12, reason: 'middle' });
    await tick();
    const third = await repo.create({ ...BASE_INPUT, targetId: 13, reason: 'newest' });

    // Resolve the oldest — it must stay in the listing, still newest-first.
    await repo.resolve(first.id, 'fixed the price');

    const rows = await repo.findAll();
    expect(rows.map((r) => r.id)).toEqual([third.id, second.id, first.id]);
    expect(rows.map((r) => r.status)).toEqual(['open', 'open', 'resolved']);
    expect(rows[2]!.resolution).toBe('fixed the price');
  });
});

describe('D1CorrectionRepository — resolve', () => {
  it('sets status, resolution, and resolvedAt in one transition, keeping createdAt', async () => {
    const created = await repo.create({ ...BASE_INPUT, targetId: 21, reason: 'wrong tax' });
    await tick();

    const resolved = await repo.resolve(created.id, 'rate corrected');
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(created.id);
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.resolution).toBe('rate corrected');
    expect(resolved!.resolvedAt).toMatch(ISO_8601);
    expect(new Date(resolved!.resolvedAt!).getTime()).toBeGreaterThan(
      new Date(created.createdAt).getTime(),
    );
    expect(resolved!.createdAt).toBe(created.createdAt);
    expect(resolved!.reason).toBe('wrong tax');
  });

  it('returns null for an unknown id', async () => {
    await expect(repo.resolve(999_999, 'nobody home')).resolves.toBeNull();
  });

  it('re-resolving an already-resolved row is idempotent — same status, fresh note, row returned', async () => {
    const created = await repo.create({ ...BASE_INPUT, targetId: 31, reason: 'dup flag' });
    const first = await repo.resolve(created.id, 'closed once');
    await tick();

    const second = await repo.resolve(created.id, 'closed twice');
    expect(second).not.toBeNull();
    expect(second!.id).toBe(created.id);
    expect(second!.status).toBe('resolved');
    expect(second!.resolution).toBe('closed twice');
    expect(new Date(second!.resolvedAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(first!.resolvedAt!).getTime(),
    );

    // Exactly one row — the rewrite happened in place.
    const all = await repo.findAll();
    expect(all.filter((r) => r.id === created.id)).toHaveLength(1);
  });
});
