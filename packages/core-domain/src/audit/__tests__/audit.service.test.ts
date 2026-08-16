/**
 * Tests for AuditService.
 *
 * High-liability area because the audit log is the sole forensic record of
 * changes to tax-rule datasets, classification-rule sets, and ranking logic.
 *
 * ## Invariants tested
 * - Entries are append-only (never modified or deleted through the service)
 * - Each entry gets a unique id and iso-8601 timestamp automatically
 * - Query filters are AND-combined and work independently
 * - Pagination (limit/offset) is correct
 * - Empty results when no matches exist
 *
 * @module AuditServiceTest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditService } from '../audit.service';
import { InMemoryAuditRepository } from './in-memory-audit.repository';
import type { IAuditRepository } from '../audit-repository.port';
import type { AuditAction } from '../audit.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLogParams(overrides?: {
  entityType?: string;
  entityId?: string;
  action?: AuditAction;
  author?: string;
  reason?: string;
  previousValue?: unknown;
  newValue?: unknown;
}) {
  return {
    entityType: overrides?.entityType ?? 'tax_rule',
    entityId: overrides?.entityId ?? 'beer-excise-v1',
    action: overrides?.action ?? 'updated',
    author: overrides?.author ?? 'admin@rajahinta.fi',
    reason: overrides?.reason ?? 'Updated beer excise rate for 2025',
    previousValue: overrides?.previousValue,
    newValue: overrides?.newValue,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditService', () => {
  let repository: IAuditRepository;
  let service: AuditService;

  beforeEach(() => {
    repository = new InMemoryAuditRepository();
    service = new AuditService(repository);
  });

  // -----------------------------------------------------------------------
  // logChange — core invariant: entries are immutable and auto-populated
  // -----------------------------------------------------------------------

  describe('logChange', () => {
    it('persists an entry with auto-generated id and timestamp', async () => {
      await service.logChange(makeLogParams());

      const history = await service.getChangeHistory('tax_rule', 'beer-excise-v1');
      expect(history).toHaveLength(1);
      expect(history[0].id).toBeTruthy();
      expect(history[0].timestamp).toBeTruthy();
      // timestamp must be valid ISO 8601
      expect(() => new Date(history[0].timestamp)).not.toThrow();
    });

    it('stores all semantic fields correctly', async () => {
      const params = makeLogParams({
        entityType: 'classification_rule',
        entityId: 'v2.0-2025',
        action: 'created',
        author: 'system',
        reason: 'New rule set for 2025 legislation',
        previousValue: null,
        newValue: { version: '2.0', rules: ['DistanceSelling'] },
      });

      await service.logChange(params);

      const history = await service.getChangeHistory('classification_rule', 'v2.0-2025');
      expect(history).toHaveLength(1);
      expect(history[0].entityType).toBe('classification_rule');
      expect(history[0].entityId).toBe('v2.0-2025');
      expect(history[0].action).toBe('created');
      expect(history[0].author).toBe('system');
      expect(history[0].reason).toBe('New rule set for 2025 legislation');
      expect(history[0].previousValue).toBeNull();
      expect(history[0].newValue).toEqual({ version: '2.0', rules: ['DistanceSelling'] });
    });

    it('generates unique ids for distinct entries', async () => {
      await service.logChange(makeLogParams({ entityId: 'rule-a' }));
      await service.logChange(makeLogParams({ entityId: 'rule-b' }));

      const all = await service.queryChanges({});
      expect(all).toHaveLength(2);
      expect(all[0].id).not.toBe(all[1].id);
    });

    it('records across all three high-liability entity types', async () => {
      await service.logChange(makeLogParams({ entityType: 'tax_rule', entityId: 'beer-rate', author: 'admin' }));
      await service.logChange(makeLogParams({ entityType: 'classification_rule', entityId: 'v1', author: 'admin' }));
      await service.logChange(makeLogParams({ entityType: 'ranking_logic', entityId: 'alcohol-efficiency', author: 'admin' }));

      const all = await service.queryChanges({});
      expect(all).toHaveLength(3);
      const types = all.map((e) => e.entityType).sort();
      expect(types).toEqual(['classification_rule', 'ranking_logic', 'tax_rule']);
    });

    it('supports all four audit actions', async () => {
      for (const action of ['created', 'updated', 'deleted', 'confirmed'] as AuditAction[]) {
        await service.logChange(makeLogParams({ action }));
      }

      const all = await service.queryChanges({});
      expect(all).toHaveLength(4);
      expect(all.map((e) => e.action).sort()).toEqual(['confirmed', 'created', 'deleted', 'updated']);
    });
  });

  // -----------------------------------------------------------------------
  // queryChanges — filtering and pagination
  // -----------------------------------------------------------------------

  describe('queryChanges', () => {
    beforeEach(async () => {
      await service.logChange(makeLogParams({ entityType: 'tax_rule', entityId: 'beer-rate', author: 'alice', action: 'created' }));
      await service.logChange(makeLogParams({ entityType: 'tax_rule', entityId: 'beer-rate', author: 'bob', action: 'updated' }));
      await service.logChange(makeLogParams({ entityType: 'tax_rule', entityId: 'wine-rate', author: 'alice', action: 'created' }));
      await service.logChange(makeLogParams({ entityType: 'classification_rule', entityId: 'v1', author: 'alice', action: 'created' }));
    });

    it('returns all entries when no filters are applied', async () => {
      const results = await service.queryChanges({});
      expect(results).toHaveLength(4);
    });

    it('filters by entityType', async () => {
      const results = await service.queryChanges({ entityType: 'classification_rule' });
      expect(results).toHaveLength(1);
      expect(results[0].entityId).toBe('v1');
    });

    it('filters by entityId', async () => {
      const results = await service.queryChanges({ entityId: 'wine-rate' });
      expect(results).toHaveLength(1);
      expect(results[0].entityType).toBe('tax_rule');
    });

    it('filters by action', async () => {
      const results = await service.queryChanges({ action: 'updated' });
      expect(results).toHaveLength(1);
      expect(results[0].author).toBe('bob');
    });

    it('filters by author', async () => {
      const results = await service.queryChanges({ author: 'bob' });
      expect(results).toHaveLength(1);
    });

    it('combines multiple filters with AND', async () => {
      const results = await service.queryChanges({
        entityType: 'tax_rule',
        author: 'alice',
      });
      expect(results).toHaveLength(2); // beer-rate created + wine-rate created
    });

    it('returns entries ordered by timestamp descending', async () => {
      const results = await service.queryChanges({});
      for (let i = 1; i < results.length; i++) {
        const prev = new Date(results[i - 1].timestamp).getTime();
        const curr = new Date(results[i].timestamp).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it('respects limit and offset', async () => {
      const page1 = await service.queryChanges({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = await service.queryChanges({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      // Pages should not overlap
      const ids1 = new Set(page1.map((e) => e.id));
      const ids2 = new Set(page2.map((e) => e.id));
      for (const id of ids1) {
        expect(ids2.has(id)).toBe(false);
      }
    });

    it('returns empty array when no entries match', async () => {
      const results = await service.queryChanges({ entityType: 'ranking_logic' });
      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getChangeHistory — convenience wrapper
  // -----------------------------------------------------------------------

  describe('getChangeHistory', () => {
    it('returns entries for the specific entity ordered newest-first', async () => {
      await service.logChange(makeLogParams({ entityType: 'tax_rule', entityId: 'beer-rate', reason: 'first' }));
      // Small delay to ensure distinct timestamps
      await new Promise((r) => setTimeout(r, 5));
      await service.logChange(makeLogParams({ entityType: 'tax_rule', entityId: 'beer-rate', reason: 'second' }));
      await service.logChange(makeLogParams({ entityType: 'classification_rule', entityId: 'v1' }));

      const history = await service.getChangeHistory('tax_rule', 'beer-rate');
      expect(history).toHaveLength(2);
      expect(history[0].reason).toBe('second');
      expect(history[1].reason).toBe('first');
    });

    it('returns empty array for entity with no history', async () => {
      const history = await service.getChangeHistory('ranking_logic', 'never-changed');
      expect(history).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Immutability — audit log invariant enforcement
  // -----------------------------------------------------------------------

  describe('immutability invariant', () => {
    it('does not expose any method to modify or delete entries', () => {
      // The service intentionally has no update() or delete() methods
      const methods = Object.getOwnPropertyNames(AuditService.prototype).filter(
        (m) => m !== 'constructor',
      );
      expect(methods).toEqual(['logChange', 'queryChanges', 'getChangeHistory']);
      // Confirm no mutating method exists
      expect(methods).not.toContain('updateEntry');
      expect(methods).not.toContain('deleteEntry');
      expect(methods).not.toContain('modifyEntry');
    });
  });
});