/**
 * OpsAuditTrailService — recent console audit entries (task 12.1, change
 * technical-assessment-remediation).
 *
 * Thin read over the durable AuditService so the console can surface the
 * audit trail next to every action (operator, action, target, timestamp).
 *
 * @module OpsAuditTrailService
 */

import { Injectable } from '@nestjs/common';
import { AuditService } from '@rajahinta/core-domain';
import type { OpsAuditListResponse } from '../ops.dto';

/** Hard cap on the requested trail length. */
const MAX_LIMIT = 100;
/** Default trail length. */
const DEFAULT_LIMIT = 25;

@Injectable()
export class OpsAuditTrailService {
  constructor(private readonly audit: AuditService) {}

  /** The most recent audit entries, newest first. */
  async recentEntries(rawLimit?: number): Promise<OpsAuditListResponse> {
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isInteger(rawLimit) ? (rawLimit as number) : DEFAULT_LIMIT),
    );
    const entries = await this.audit.queryChanges({ limit });
    return {
      items: entries.map((entry) => ({
        id: entry.id,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        author: entry.author,
        reason: entry.reason,
        timestamp: entry.timestamp,
      })),
      total: entries.length,
    };
  }
}
