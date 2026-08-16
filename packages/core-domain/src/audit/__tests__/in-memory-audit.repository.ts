/**
 * In-memory audit repository for testing.
 *
 * @module InMemoryAuditRepository
 */

import type { AuditEntry, AuditQuery } from '../../audit/audit.types';
import type { IAuditRepository } from '../../audit/audit-repository.port';

export class InMemoryAuditRepository implements IAuditRepository {
  private readonly entries: Map<string, AuditEntry> = new Map();

  async save(entry: AuditEntry): Promise<void> {
    if (this.entries.has(entry.id)) {
      throw new Error(`Audit entry with id "${entry.id}" already exists`);
    }
    this.entries.set(entry.id, entry);
  }

  async query(params: AuditQuery): Promise<AuditEntry[]> {
    let results = Array.from(this.entries.values());

    if (params.entityType !== undefined) {
      results = results.filter((e) => e.entityType === params.entityType);
    }
    if (params.entityId !== undefined) {
      results = results.filter((e) => e.entityId === params.entityId);
    }
    if (params.action !== undefined) {
      results = results.filter((e) => e.action === params.action);
    }
    if (params.author !== undefined) {
      results = results.filter((e) => e.author === params.author);
    }
    if (params.fromDate !== undefined) {
      results = results.filter((e) => e.timestamp >= params.fromDate!);
    }
    if (params.toDate !== undefined) {
      results = results.filter((e) => e.timestamp <= params.toDate!);
    }

    // Order by timestamp descending
    results.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    // Pagination
    const offset = params.offset ?? 0;
    const limit = params.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  async getHistory(entityType: string, entityId: string): Promise<AuditEntry[]> {
    return this.query({ entityType, entityId });
  }

  /** Expose the entry count for test assertions. */
  get size(): number {
    return this.entries.size;
  }
}