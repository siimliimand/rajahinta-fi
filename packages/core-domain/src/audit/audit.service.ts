/**
 * AuditService — immutable audit log for high-liability domain changes.
 *
 * Records every mutation to tax-rule datasets, classification-rule sets,
 * and ranking logic.  Entries are append-only: once persisted they are
 * never modified or deleted.
 *
 * ## High-liability entity types
 *
 * - `tax_rule` — excise duty rates, container duty rates, effective dates
 * - `classification_rule` — transaction classification rule sets
 * - `ranking_logic` — sort-order comparators and methodology
 *
 * @module AuditService
 */

import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuditEntry, AuditAction, AuditQuery } from './audit.types';
import { IAuditRepository, AUDIT_REPOSITORY_PORT } from './audit-repository.port';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AuditService {
  constructor(
    @Inject(AUDIT_REPOSITORY_PORT)
    private readonly repository: IAuditRepository,
  ) {}

  /**
   * Record a change in the audit log.
   *
   * Generates an id and timestamp automatically so callers only supply
   * the semantic fields.
   */
  async logChange(params: {
    entityType: string;
    entityId: string;
    action: AuditAction;
    author: string;
    reason: string;
    previousValue?: unknown;
    newValue?: unknown;
  }): Promise<void> {
    const entry: AuditEntry = {
      id: randomUUID(),
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      author: params.author,
      reason: params.reason,
      timestamp: new Date().toISOString(),
      previousValue: params.previousValue,
      newValue: params.newValue,
    };

    await this.repository.save(entry);
  }

  /**
   * Query audit entries with optional filters.
   *
   * Filters are AND-combined.  Omitted filters are not applied.
   * Results are ordered by timestamp descending (most recent first).
   */
  async queryChanges(params: AuditQuery): Promise<AuditEntry[]> {
    return this.repository.query(params);
  }

  /**
   * Return the full change history for a specific entity.
   */
  async getChangeHistory(
    entityType: string,
    entityId: string,
  ): Promise<AuditEntry[]> {
    return this.repository.getHistory(entityType, entityId);
  }
}