/**
 * Audit entry types for the immutable audit log.
 *
 * Every change to tax-rule datasets, classification-rule sets, or ranking
 * logic is recorded here.  Entries are append-only: once written they are
 * never modified or deleted.
 *
 * @module AuditTypes
 */

// ---------------------------------------------------------------------------
// Audit action
// ---------------------------------------------------------------------------

/** Actions that can be recorded in the audit log. */
export type AuditAction = 'created' | 'updated' | 'deleted' | 'confirmed';

// ---------------------------------------------------------------------------
// Audit entry
// ---------------------------------------------------------------------------

/** A single immutable audit entry. */
export interface AuditEntry {
  /** Unique identifier (UUID). */
  readonly id: string;
  /** High-liability entity type (e.g. 'tax_rule', 'classification_rule', 'ranking_logic'). */
  readonly entityType: string;
  /** Entity-specific identifier (e.g. rule ID, version label). */
  readonly entityId: string;
  /** What happened. */
  readonly action: AuditAction;
  /** Who performed the change (user ID or system actor). */
  readonly author: string;
  /** Free-text reason for the change. */
  readonly reason: string;
  /** When the change occurred (ISO 8601). */
  readonly timestamp: string;
  /** Optional snapshot of the value before the change (JSON). */
  readonly previousValue?: unknown;
  /** Optional snapshot of the value after the change (JSON). */
  readonly newValue?: unknown;
}

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

/** Filters for querying the audit log. */
export interface AuditQuery {
  readonly entityType?: string;
  readonly entityId?: string;
  readonly action?: AuditAction;
  readonly author?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly limit?: number;
  readonly offset?: number;
}