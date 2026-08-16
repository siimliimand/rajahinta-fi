/**
 * Null audit repository — silently discards all entries.
 *
 * Useful as a dependency-injection default in tests where the audit log is
 * not the concern under test.  All methods are no-ops that return empty
 * results — no entries are ever persisted.
 *
 * @module NullAuditRepository
 */

import type { AuditEntry, AuditQuery } from './audit.types';
import type { IAuditRepository } from './audit-repository.port';

export class NullAuditRepository implements IAuditRepository {
  async save(_entry: AuditEntry): Promise<void> {
    /* silently discard */
  }

  async query(_params: AuditQuery): Promise<AuditEntry[]> {
    return [];
  }

  async getHistory(_entityType: string, _entityId: string): Promise<AuditEntry[]> {
    return [];
  }
}