/**
 * InMemoryAuditRepository tests — immutable audit log operations.
 *
 * Covers:
 * - Save (insert + duplicate-id rejection)
 * - Query with individual and combined filters
 * - getHistory convenience wrapper
 * - Offset/limit pagination
 *
 * @module InMemoryAuditRepositoryTest
 */

import { describe, it, expect } from 'vitest';
import { InMemoryAuditRepository } from '../in-memory-audit.repository';
import type { AuditEntry } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic entry factory — each call returns a fresh clone. */
function entry(overrides: Partial<AuditEntry> & { id: string }): AuditEntry {
  return {
    entityType: 'tax_rule',
    entityId: 'rule-1',
    action: 'created',
    author: 'admin',
    reason: 'Initial setup',
    timestamp: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

/** Seed the repository with a standard set of entries for query tests. */
async function seedStandard(repo: InMemoryAuditRepository): Promise<void> {
  const entries: AuditEntry[] = [
    entry({ id: 'a1', entityType: 'tax_rule', entityId: 'rule-1', action: 'created', author: 'admin', timestamp: '2026-01-15T10:00:00.000Z' }),
    entry({ id: 'a2', entityType: 'tax_rule', entityId: 'rule-1', action: 'updated', author: 'admin', timestamp: '2026-01-20T10:00:00.000Z', reason: 'Rate adjustment', previousValue: { rate: '0.5' }, newValue: { rate: '0.55' } }),
    entry({ id: 'a3', entityType: 'classification_rule', entityId: 'class-a', action: 'created', author: 'operator', timestamp: '2026-02-01T08:00:00.000Z', reason: 'New classification' }),
    entry({ id: 'a4', entityType: 'tax_rule', entityId: 'rule-2', action: 'created', author: 'admin', timestamp: '2026-02-10T12:00:00.000Z' }),
    entry({ id: 'a5', entityType: 'tax_rule', entityId: 'rule-1', action: 'deleted', author: 'admin', timestamp: '2026-03-01T09:00:00.000Z', reason: 'Superseded by rule-3' }),
    entry({ id: 'a6', entityType: 'ranking_logic', entityId: 'rank-alpha', action: 'updated', author: 'operator', timestamp: '2026-03-15T14:00:00.000Z', reason: 'Weight recalibration' }),
  ];
  for (const e of entries) {
    await repo.save(e);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InMemoryAuditRepository', () => {
  // -----------------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------------

  describe('save', () => {
    it('persists an entry and makes it queryable', async () => {
      const repo = new InMemoryAuditRepository();
      const e = entry({ id: 'test-1' });
      await repo.save(e);

      const results = await repo.query({ entityType: 'tax_rule' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('test-1');
    });

    it('stores a clone — mutations to the original do not affect stored entry', async () => {
      const repo = new InMemoryAuditRepository();
      const original = entry({ id: 'clone-test' });
      await repo.save(original);

      // Mutate the original reference
      (original as any).reason = 'Hacked';

      const results = await repo.query({});
      expect(results[0].reason).toBe('Initial setup');
    });

    it('returns cloned entries on query — mutations to results do not affect store', async () => {
      const repo = new InMemoryAuditRepository();
      await repo.save(entry({ id: 'mut-test' }));

      const first = await repo.query({});
      (first[0] as any).reason = 'Mutated';

      const second = await repo.query({});
      expect(second[0].reason).toBe('Initial setup');
    });

    it('throws when an entry with the same id already exists', async () => {
      const repo = new InMemoryAuditRepository();
      const e = entry({ id: 'dup-1' });
      await repo.save(e);

      await expect(repo.save(e)).rejects.toThrow(
        'Audit entry with id "dup-1" already exists',
      );
    });

    it('throws on duplicate even when all other fields differ', async () => {
      const repo = new InMemoryAuditRepository();
      await repo.save(entry({ id: 'dup-id' }));
      await expect(
        repo.save(entry({ id: 'dup-id', entityType: 'ranking_logic', action: 'updated' })),
      ).rejects.toThrow('Audit entry with id "dup-id" already exists');
    });
  });

  // -----------------------------------------------------------------------
  // Query — individual filters
  // -----------------------------------------------------------------------

  describe('query by single filter', () => {
    it('returns all entries when query params are empty', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({});
      expect(results).toHaveLength(6);
    });

    it('filters by entityType', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ entityType: 'tax_rule' });
      expect(results).toHaveLength(4);
      expect(results.every((e) => e.entityType === 'tax_rule')).toBe(true);
    });

    it('filters by entityId', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ entityId: 'rule-1' });
      expect(results).toHaveLength(3);
      expect(results.every((e) => e.entityId === 'rule-1')).toBe(true);
    });

    it('filters by action', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ action: 'created' });
      expect(results).toHaveLength(3);
      expect(results.every((e) => e.action === 'created')).toBe(true);
    });

    it('filters by author', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ author: 'operator' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.author === 'operator')).toBe(true);
    });

    it('filters by fromDate (inclusive)', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ fromDate: '2026-02-01T00:00:00.000Z' });
      expect(results).toHaveLength(4); // a3, a4, a5, a6 — all from feb onward
      expect(results.every((e) => e.timestamp >= '2026-02-01T00:00:00.000Z')).toBe(true);
    });

    it('filters by toDate (inclusive)', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ toDate: '2026-01-31T23:59:59.999Z' });
      expect(results).toHaveLength(2); // a1, a2
      expect(results.every((e) => e.timestamp <= '2026-01-31T23:59:59.999Z')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Query — combined filters
  // -----------------------------------------------------------------------

  describe('query with combined filters', () => {
    it('filters by entityType + entityId', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ entityType: 'tax_rule', entityId: 'rule-1' });
      expect(results).toHaveLength(3);
    });

    it('filters by entityType + action + author', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ entityType: 'tax_rule', action: 'created', author: 'admin' });
      expect(results).toHaveLength(2); // a1, a4
    });

    it('filters by author + date range', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({
        author: 'admin',
        fromDate: '2026-02-01T00:00:00.000Z',
      });
      expect(results).toHaveLength(2); // a4, a5
    });

    it('returns empty array when no entries match', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ entityType: 'non_existent' });
      expect(results).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // getHistory
  // -----------------------------------------------------------------------

  describe('getHistory', () => {
    it('returns all entries for the given entityType + entityId', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.getHistory('tax_rule', 'rule-1');
      expect(results).toHaveLength(3);
      expect(results.every((e) => e.entityType === 'tax_rule' && e.entityId === 'rule-1')).toBe(true);
    });

    it('returns empty array when entity has no history', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.getHistory('tax_rule', 'non-existent-entity');
      expect(results).toHaveLength(0);
    });

    it('results are sorted most-recent-first', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.getHistory('tax_rule', 'rule-1');
      expect(results[0].timestamp).toBe('2026-03-01T09:00:00.000Z'); // deleted — most recent
      expect(results[1].timestamp).toBe('2026-01-20T10:00:00.000Z'); // updated
      expect(results[2].timestamp).toBe('2026-01-15T10:00:00.000Z'); // created — oldest
    });
  });

  // -----------------------------------------------------------------------
  // Sorting
  // -----------------------------------------------------------------------

  describe('sorting', () => {
    it('returns results in descending timestamp order by default', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({});
      for (let i = 1; i < results.length; i++) {
        expect(
          new Date(results[i - 1].timestamp).getTime() >=
            new Date(results[i].timestamp).getTime(),
        ).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Offset/limit pagination
  // -----------------------------------------------------------------------

  describe('pagination (offset / limit)', () => {
    it('returns limited number of results when limit is set', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('skips offset results when offset is set', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      // All 6 sorted desc: a6, a5, a4, a3, a2, a1
      const all = await repo.query({});
      const offset2 = await repo.query({ offset: 2 });
      expect(offset2).toHaveLength(4);
      expect(offset2[0].id).toBe(all[2].id);
    });

    it('combines offset and limit', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ offset: 1, limit: 2 });
      expect(results).toHaveLength(2);
      // Should be entries at index 1 and 2 of the full sorted list
      const all = await repo.query({});
      expect(results[0].id).toBe(all[1].id);
      expect(results[1].id).toBe(all[2].id);
    });

    it('returns fewer items when offset+limit exceeds available results', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ offset: 4, limit: 100 });
      expect(results).toHaveLength(2); // items at index 4,5
    });

    it('returns empty array when offset exceeds total count', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ offset: 100 });
      expect(results).toHaveLength(0);
    });

    it('defaults offset to 0 and limit to total count when not provided', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({});
      expect(results).toHaveLength(6);
    });

    it('pagination respects applied filters', async () => {
      const repo = new InMemoryAuditRepository();
      await seedStandard(repo);

      const results = await repo.query({ entityType: 'tax_rule', limit: 2 });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.entityType === 'tax_rule')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Empty repository
  // -----------------------------------------------------------------------

  describe('empty repository', () => {
    it('query returns empty array', async () => {
      const repo = new InMemoryAuditRepository();
      const results = await repo.query({});
      expect(results).toHaveLength(0);
    });

    it('getHistory returns empty array', async () => {
      const repo = new InMemoryAuditRepository();
      const results = await repo.getHistory('tax_rule', 'rule-1');
      expect(results).toHaveLength(0);
    });
  });
});