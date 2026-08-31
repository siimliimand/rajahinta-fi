/**
 * D1AuditEventRepository — real-SQLite tests (task 2.5): append-only
 * writes keyed by the domain UUID, filter/pagination semantics of the
 * query API, JSON snapshot round-trips, and the most-recent-first
 * ordering contract.
 *
 * @module D1AuditEventRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1AuditEventRepository } from '../audit-event.repository';
import type { AuditEntry } from '@rajahinta/core-domain';

const { d1 } = openMigratedD1();
const repo = new D1AuditEventRepository(d1);

function entry(overrides: Partial<AuditEntry> & { id: string }): AuditEntry {
  return {
    entityType: 'fx_rate_dataset',
    entityId: 'ecb-2026-08-01.1',
    action: 'confirmed',
    author: 'ops@example.invalid',
    reason: 'ECB reference rates reviewed',
    timestamp: '2026-08-28T09:00:00.000Z',
    ...overrides,
  };
}

describe('D1AuditEventRepository', () => {
  it('saves an entry with snapshots and reads it back as the domain shape', async () => {
    const e = entry({ id: 'audit-1', previousValue: { status: 'PENDING_CONFIRMATION' }, newValue: { status: 'PUBLISHED' } });
    await repo.save(e);

    const history = await repo.getHistory('fx_rate_dataset', 'ecb-2026-08-01.1');
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(e);
  });

  it('persists entries without snapshots (append-only, never mutated)', async () => {
    await repo.save(entry({ id: 'audit-2', action: 'created' }));

    const history = await repo.getHistory('fx_rate_dataset', 'ecb-2026-08-01.1');
    const row = history.find((h) => h.id === 'audit-2')!;
    expect(row.previousValue).toBeUndefined();
    expect(row.newValue).toBeUndefined();
    // The timestamp round-trips as the canonical ISO string.
    expect(row.timestamp).toBe('2026-08-28T09:00:00.000Z');
  });

  it('fails loudly on a duplicate id — append-only, no upsert', async () => {
    await repo.save(entry({ id: 'audit-dup' }));
    await expect(repo.save(entry({ id: 'audit-dup' }))).rejects.toThrow();
  });

  it('applies every filter, sorts most-recent-first, and paginates', async () => {
    for (const [id, ts, action, author] of [
      ['audit-q1', '2026-08-01T00:00:00.000Z', 'created', 'system'],
      ['audit-q2', '2026-08-02T00:00:00.000Z', 'updated', 'ops@example.invalid'],
      ['audit-q3', '2026-08-03T00:00:00.000Z', 'updated', 'ops@example.invalid'],
      ['audit-q4', '2026-08-04T00:00:00.000Z', 'updated', 'ops@example.invalid'],
    ] as const) {
      await repo.save(
        entry({
          id,
          timestamp: ts,
          action,
          author,
          entityType: 'tax_rule',
          entityId: '42',
        }),
      );
    }

    const page = await repo.query({
      entityType: 'tax_rule',
      entityId: '42',
      action: 'updated',
      author: 'ops@example.invalid',
      fromDate: '2026-08-02T00:00:00.000Z',
      toDate: '2026-08-04T00:00:00.000Z',
      limit: 2,
      offset: 1,
    });

    // Most recent first within the filtered set, second page.
    expect(page.map((e) => e.id)).toEqual(['audit-q3', 'audit-q2']);
  });

  it('runs unfiltered reads without a WHERE clause', async () => {
    const all = await repo.query({});
    expect(all.length).toBeGreaterThanOrEqual(7);
  });

  it('getHistory queries by entity type and id', async () => {
    await repo.save(
      entry({ id: 'audit-h1', entityType: 'account', entityId: 'user-123', action: 'updated' }),
    );
    const history = await repo.getHistory('account', 'user-123');
    expect(history.map((e) => e.id)).toEqual(['audit-h1']);
  });
});
