/**
 * DrizzleAuditEventRepository — durable IAuditRepository adapter backed
 * by the append-only audit_events table (task 4.2, change
 * technical-assessment-remediation).
 *
 * Rows are written once and never mutated: the entry id (UUID) is the
 * primary key, and a duplicate id fails the insert loudly — matching
 * the in-memory repository's contract that tests rely on. The
 * in-memory implementation stays available for tests only.
 *
 * @module DrizzleAuditEventRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import type {
  AuditEntry,
  AuditQuery,
  IAuditRepository,
} from '@rajahinta/core-domain';
import { auditEvents } from '../schema';

@Injectable()
export class DrizzleAuditEventRepository implements IAuditRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {}

  async save(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditEvents).values({
      id: entry.id,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      author: entry.author,
      reason: entry.reason,
      // Domain carries ISO strings; the column is timestamptz.
      occurredAt: new Date(entry.timestamp),
      previousValue: entry.previousValue ?? null,
      newValue: entry.newValue ?? null,
    });
  }

  async query(params: AuditQuery): Promise<AuditEntry[]> {
    const filters: SQL[] = [];
    if (params.entityType !== undefined) {
      filters.push(eq(auditEvents.entityType, params.entityType));
    }
    if (params.entityId !== undefined) {
      filters.push(eq(auditEvents.entityId, params.entityId));
    }
    if (params.action !== undefined) {
      filters.push(eq(auditEvents.action, params.action));
    }
    if (params.author !== undefined) {
      filters.push(eq(auditEvents.author, params.author));
    }
    if (params.fromDate !== undefined) {
      filters.push(gte(auditEvents.occurredAt, new Date(params.fromDate)));
    }
    if (params.toDate !== undefined) {
      filters.push(lte(auditEvents.occurredAt, new Date(params.toDate)));
    }

    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(filters.length > 0 ? and(...filters) : undefined)
      // Most recent first — the in-memory contract consumers sort by.
      .orderBy(desc(auditEvents.occurredAt), asc(auditEvents.id))
      .limit(params.limit ?? Number.MAX_SAFE_INTEGER)
      .offset(params.offset ?? 0);

    return rows.map((row) => this.toEntry(row));
  }

  async getHistory(entityType: string, entityId: string): Promise<AuditEntry[]> {
    return this.query({ entityType, entityId });
  }

  /** Row → domain entry; timestamp round-trips as an ISO string. */
  private toEntry(row: typeof auditEvents.$inferSelect): AuditEntry {
    return {
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action as AuditEntry['action'],
      author: row.author,
      reason: row.reason,
      timestamp: row.occurredAt.toISOString(),
      ...(row.previousValue !== null
        ? { previousValue: row.previousValue }
        : {}),
      ...(row.newValue !== null ? { newValue: row.newValue } : {}),
    };
  }
}
