/**
 * Port interface for the immutable audit log repository.
 *
 * Core Domain owns this port so AuditService depends on an abstraction,
 * not on a concrete store.  The adapter lives in the composition root
 * (ApplicationApi) and wires the actual persistence behind this contract.
 *
 * @module AuditRepositoryPort
 */

import type { AuditEntry, AuditQuery } from './audit.types';

// ---------------------------------------------------------------------------
// Injection token
// ---------------------------------------------------------------------------

/** Injection token for the audit repository. */
export const AUDIT_REPOSITORY_PORT = 'AUDIT_REPOSITORY_PORT';

// ---------------------------------------------------------------------------
// Repository contract
// ---------------------------------------------------------------------------

/**
 * Repository contract for the immutable audit log.
 *
 * Entries are append-only — once written they must never be modified or
 * deleted.  Implementations must enforce this invariant at the storage layer.
 */
export interface IAuditRepository {
  /**
   * Persist an audit entry.
   *
   * Implementations MUST NOT modify or delete entries after they are written.
   *
   * @throws {Error} When an entry with the same id already exists (idempotency guard).
   */
  save(entry: AuditEntry): Promise<void>;

  /**
   * Query audit entries with optional filters.
   *
   * Results are ordered by timestamp descending (most recent first).
   */
  query(params: AuditQuery): Promise<AuditEntry[]>;

  /**
   * Return the full change history for a specific entity.
   *
   * Convenience wrapper around query() filtered by entityType + entityId.
   */
  getHistory(entityType: string, entityId: string): Promise<AuditEntry[]>;
}