/**
 * Worker audit service — the AuditService surface the ops console consumes
 * (task 3.8), re-hosted over the D1 `audit_events` repository from task
 * 2.5 (append-only writes; newest-first queries).
 *
 * Re-implemented rather than imported because the core-domain service
 * generates entry ids with `node:crypto.randomUUID()` — a Node built-in
 * the Worker bundle does not carry (no `nodejs_compat`). The Workers-global
 * `crypto.randomUUID()` produces the same UUIDv4; persistence and query
 * semantics live in D1AuditEventRepository and are untouched.
 *
 * @module AuditAdapter
 */

import type { AuditEntry, AuditQuery } from '@rajahinta/core-domain';
import { D1AuditEventRepository } from '../../../../packages/data-platform/src/repositories/d1/audit-event.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';

/** Audit action vocabulary (AuditAction parity). */
type AuditAction = 'created' | 'updated' | 'deleted' | 'confirmed';

export class WorkerAuditService {
  private readonly repo: D1AuditEventRepository;

  constructor(d1: D1DatabaseLike) {
    this.repo = new D1AuditEventRepository(d1);
  }

  /**
   * Record a change — generates the id and timestamp so callers supply
   * only the semantic fields (AuditService.logChange parity).
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
      id: crypto.randomUUID(),
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      author: params.author,
      reason: params.reason,
      timestamp: new Date().toISOString(),
      ...(params.previousValue !== undefined
        ? { previousValue: params.previousValue }
        : {}),
      ...(params.newValue !== undefined ? { newValue: params.newValue } : {}),
    };
    await this.repo.save(entry);
  }

  /** Filtered query, newest first (AuditService.queryChanges parity). */
  async queryChanges(params: AuditQuery): Promise<AuditEntry[]> {
    return this.repo.query(params);
  }
}
