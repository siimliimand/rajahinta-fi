/**
 * D1AuditEventRepository — durable IAuditRepository adapter backed by the
 * append-only `audit_events` table (task 2.5, change
 * migrate-to-cloudflare). Rows are written once and never mutated: the
 * entry id (UUID) is the primary key, and a duplicate id fails the
 * insert loudly — matching the in-memory repository's contract that
 * tests rely on. Signatures and result shapes match the pg
 * DrizzleAuditEventRepository exactly.
 *
 * Boundary translation (design D2): the domain carries an ISO-8601
 * `timestamp` string and pg stored a timestamptz; D1 stores the canonical
 * ISO TEXT directly — normalized through `new Date(...).toISOString()`
 * so offset-bearing domain timestamps land in the same comparable shape.
 * The jsonb snapshot columns round-trip through JSON TEXT.
 *
 * @module D1AuditEventRepository
 */
import { Injectable } from '@nestjs/common';
import type {
  AuditEntry,
  AuditQuery,
  IAuditRepository,
} from '@rajahinta/core-domain';
import type { D1DatabaseLike } from '../../d1/executor';

/** Raw D1 audit_events row. */
interface D1AuditEventRow {
  readonly id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly action: string;
  readonly author: string;
  readonly reason: string;
  readonly occurred_at: string;
  readonly previous_value: string | null;
  readonly new_value: string | null;
}

const INSERT_SQL = `
  INSERT INTO audit_events (
    id, entity_type, entity_id, action, author, reason, occurred_at,
    previous_value, new_value
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

@Injectable()
export class D1AuditEventRepository implements IAuditRepository {
  constructor(private readonly d1: D1DatabaseLike) {}

  async save(entry: AuditEntry): Promise<void> {
    await this.d1
      .prepare(INSERT_SQL)
      .bind(
        entry.id,
        entry.entityType,
        entry.entityId,
        entry.action,
        entry.author,
        entry.reason,
        // Domain carries ISO strings; the column is a canonical TEXT instant.
        new Date(entry.timestamp).toISOString(),
        entry.previousValue === undefined
          ? null
          : JSON.stringify(entry.previousValue),
        entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
      )
      .run();
  }

  async query(params: AuditQuery): Promise<AuditEntry[]> {
    // Dynamic filter conjunction — every present parameter narrows the
    // read; absent parameters contribute no clause (pg's conditional
    // filters array, translated to raw SQL).
    const conditions: string[] = [];
    const filterParams: unknown[] = [];
    if (params.entityType !== undefined) {
      conditions.push('entity_type = ?');
      filterParams.push(params.entityType);
    }
    if (params.entityId !== undefined) {
      conditions.push('entity_id = ?');
      filterParams.push(params.entityId);
    }
    if (params.action !== undefined) {
      conditions.push('action = ?');
      filterParams.push(params.action);
    }
    if (params.author !== undefined) {
      conditions.push('author = ?');
      filterParams.push(params.author);
    }
    if (params.fromDate !== undefined) {
      conditions.push('occurred_at >= ?');
      filterParams.push(new Date(params.fromDate).toISOString());
    }
    if (params.toDate !== undefined) {
      conditions.push('occurred_at <= ?');
      filterParams.push(new Date(params.toDate).toISOString());
    }

    const whereClause =
      conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT id, entity_type, entity_id, action, author, reason, occurred_at,
             previous_value, new_value
        FROM audit_events${whereClause}
       ORDER BY occurred_at DESC, id ASC
       LIMIT ? OFFSET ?`;

    const rows = (
      await this.d1
        .prepare(sql)
        .bind(
          ...filterParams,
          params.limit ?? Number.MAX_SAFE_INTEGER,
          params.offset ?? 0,
        )
        .all<D1AuditEventRow>()
    ).results;

    return rows.map((row) => this.toEntry(row));
  }

  async getHistory(entityType: string, entityId: string): Promise<AuditEntry[]> {
    return this.query({ entityType, entityId });
  }

  /** Row → domain entry; timestamp round-trips as an ISO string. */
  private toEntry(row: D1AuditEventRow): AuditEntry {
    return {
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action as AuditEntry['action'],
      author: row.author,
      reason: row.reason,
      // Stored canonical ISO-8601 TEXT — the pg toISOString() output.
      timestamp: row.occurred_at,
      ...(row.previous_value !== null
        ? { previousValue: JSON.parse(row.previous_value) }
        : {}),
      ...(row.new_value !== null ? { newValue: JSON.parse(row.new_value) } : {}),
    };
  }
}
