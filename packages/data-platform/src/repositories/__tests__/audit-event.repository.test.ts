import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import type { AuditEntry } from '@rajahinta/core-domain';
import { DrizzleAuditEventRepository } from '../audit-event.repository';

// ---------------------------------------------------------------------------
// Test harness — package convention: no-DB unit tests via recorded builder
// calls replayed against a never-connected drizzle instance.
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

function createRecordingDb(rows: () => unknown): {
  db: DrizzleDatabase;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const stub: unknown = new Proxy(
    {},
    {
      get(_target, prop, _receiver) {
        if (prop === 'then') {
          return (resolve: unknown, reject: unknown) =>
            Promise.resolve()
              .then(rows)
              .then(resolve as never, reject as never);
        }
        if (typeof prop !== 'string') return undefined;
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return stub;
        };
      },
    },
  );
  return { db: stub as DrizzleDatabase, calls };
}

const renderPool = new Pool({
  connectionString: 'postgres://rajahinta:rajahinta@127.0.0.1:5432/rajahinta_test',
});
const renderDb = drizzle(renderPool);

function renderSql(calls: RecordedCall[]): { sql: string; params: unknown[] } {
  let builder: Record<string, unknown> = renderDb as unknown as Record<string, unknown>;
  for (const { method, args } of calls) {
    const fn = builder[method] as (...a: unknown[]) => unknown;
    builder = fn.apply(builder, args) as Record<string, unknown>;
  }
  return (builder as unknown as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
}

function lastRootSql(calls: RecordedCall[]) {
  for (let i = calls.length - 1; i >= 0; i--) {
    const m = calls[i].method;
    if (m === 'select' || m === 'insert' || m === 'update' || m === 'delete') {
      return renderSql(calls.slice(i));
    }
  }
  throw new Error('no query root recorded');
}

afterAll(async () => {
  await renderPool.end();
});

// ---------------------------------------------------------------------------

const ENTRY: AuditEntry = {
  id: 'b7d6f2a1-1111-4222-8333-444455556666',
  entityType: 'fx_rate_dataset',
  entityId: 'ecb-2026-08-01.1',
  action: 'confirmed',
  author: 'ops@example.invalid',
  reason: 'ECB reference rates reviewed',
  timestamp: '2026-08-28T09:00:00.000Z',
  previousValue: { status: 'PENDING_CONFIRMATION' },
  newValue: { status: 'PUBLISHED' },
};

describe('DrizzleAuditEventRepository', () => {
  describe('save', () => {
    it('inserts the domain id as primary key with ISO timestamp as date', async () => {
      const { db, calls } = createRecordingDb(() => [{}]);
      const repo = new DrizzleAuditEventRepository(db);
      await repo.save(ENTRY);
      const { sql, params } = lastRootSql(calls);
      expect(sql).toContain('insert into "audit_events"');
      expect(params).toContain(ENTRY.id);
      expect(params).toContain('fx_rate_dataset');
      // Timestamp crosses the boundary as a driver-mapped instant of the
      // domain ISO timestamp (drizzle renders Date params as strings).
      const tsParams = params.filter(
        (p) => typeof p === 'string' && p.startsWith('2026-08-28'),
      );
      expect(tsParams).toHaveLength(1);
    });
  });

  describe('query', () => {
    it('applies every filter, sorts most-recent-first, and paginates', async () => {
      const { db, calls } = createRecordingDb(() => []);
      const repo = new DrizzleAuditEventRepository(db);
      await repo.query({
        entityType: 'tax_rule',
        entityId: '42',
        action: 'updated',
        author: 'ops@example.invalid',
        fromDate: '2026-08-01T00:00:00.000Z',
        toDate: '2026-08-31T00:00:00.000Z',
        limit: 10,
        offset: 20,
      });
      const { sql, params } = lastRootSql(calls);
      expect(sql).toContain('from "audit_events"');
      expect(sql).toContain('"entity_type" = $');
      expect(sql).toContain('"entity_id" = $');
      expect(sql).toContain('"action" = $');
      expect(sql).toContain('"author" = $');
      expect(sql).toContain('"occurred_at" >= $');
      expect(sql).toContain('"occurred_at" <= $');
      expect(sql).toContain('order by "audit_events"."occurred_at" desc');
      expect(params).toContain('tax_rule');
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('runs unfiltered reads without a WHERE clause', async () => {
      const { db, calls } = createRecordingDb(() => []);
      const repo = new DrizzleAuditEventRepository(db);
      await repo.query({});
      const { sql } = lastRootSql(calls);
      expect(sql).not.toContain('where');
    });
  });

  describe('getHistory', () => {
    it('queries by entity type and id', async () => {
      const { db, calls } = createRecordingDb(() => []);
      const repo = new DrizzleAuditEventRepository(db);
      await repo.getHistory('account', 'user-123');
      const { sql, params } = lastRootSql(calls);
      expect(sql).toContain('"entity_type" = $');
      expect(sql).toContain('"entity_id" = $');
      expect(params).toContain('account');
      expect(params).toContain('user-123');
    });
  });
});
