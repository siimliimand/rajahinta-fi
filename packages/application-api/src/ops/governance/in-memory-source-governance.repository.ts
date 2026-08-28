/**
 * InMemorySourceGovernanceRepository — application-api-owned backing for
 * the core-domain SOURCE_GOVERNANCE_REPOSITORY_PORT (task 12.1, change
 * technical-assessment-remediation).
 *
 * The data-platform schema has no governance table yet and the port carries
 * a null default in SourceGovernanceModule, so the operator console binds
 * its own repository here — the same Phase 1 pattern as
 * InMemoryCorrectionRepository / InMemoryRateReviewRepository. The
 * production swap is a Drizzle adapter behind the same port token once the
 * schema lands; every grant/revoke is additionally recorded durably in the
 * PostgreSQL audit store by OpsGovernanceService, so the compliance record
 * (operator, target, timestamp) survives restarts regardless.
 *
 * Scope note: this repository is bound ONLY inside the ops module scope.
 * The shared null-bound SourceGovernanceService singleton that the
 * scheduler and pipeline use stays fail-closed until the port is rebound
 * in their scope — permission is never overstated anywhere.
 *
 * @module InMemorySourceGovernanceRepository
 */

import { Injectable } from '@nestjs/common';
import type { ISourceGovernanceRepository } from '@rajahinta/core-domain';
import type {
  PermissionCheckResult,
  RegisterSourceInput,
  SourceGovernanceRecord,
} from '@rajahinta/core-domain';

/** Aggregation priority — first match wins (port contract). */
const STATUS_PRIORITY = ['GRANTED', 'PENDING', 'EXPIRED', 'REVOKED'] as const;

@Injectable()
export class InMemorySourceGovernanceRepository implements ISourceGovernanceRepository {
  private nextId = 1;
  private readonly records = new Map<number, SourceGovernanceRecord>();

  /** @inheritdoc */
  async create(input: RegisterSourceInput): Promise<SourceGovernanceRecord> {
    const now = new Date();
    const record: SourceGovernanceRecord = {
      id: this.nextId++,
      merchantId: input.merchantId,
      acquisitionMethod: input.acquisitionMethod,
      permissionStatus: input.permissionStatus,
      sourceUrl: input.sourceUrl,
      statusReason: input.statusReason ?? null,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return { ...record };
  }

  /** @inheritdoc */
  async updateStatus(
    id: number,
    status: SourceGovernanceRecord['permissionStatus'],
    reason?: string,
  ): Promise<SourceGovernanceRecord | null> {
    const existing = this.records.get(id);
    if (existing === undefined) return null;
    const updated: SourceGovernanceRecord = {
      ...existing,
      permissionStatus: status,
      statusReason: reason ?? existing.statusReason,
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    };
    this.records.set(id, updated);
    return { ...updated };
  }

  /** @inheritdoc */
  async revokeAllByMerchantId(merchantId: string, reason: string): Promise<number> {
    let count = 0;
    for (const [id, record] of this.records) {
      if (record.merchantId !== merchantId) continue;
      if (record.permissionStatus === 'REVOKED') continue;
      this.records.set(id, {
        ...record,
        permissionStatus: 'REVOKED',
        statusReason: reason,
        lastVerifiedAt: new Date(),
        updatedAt: new Date(),
      });
      count++;
    }
    return count;
  }

  /** @inheritdoc */
  async findByMerchantId(merchantId: string): Promise<SourceGovernanceRecord[]> {
    const results = [...this.records.values()]
      .filter((record) => record.merchantId === merchantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results.map((record) => ({ ...record }));
  }

  /** @inheritdoc */
  async findById(id: number): Promise<SourceGovernanceRecord | null> {
    const record = this.records.get(id);
    return record === undefined ? null : { ...record };
  }

  /** @inheritdoc */
  async checkPermission(merchantId: string): Promise<PermissionCheckResult> {
    const sources = await this.findByMerchantId(merchantId);
    const permissionStatus =
      STATUS_PRIORITY.find((status) =>
        sources.some((source) => source.permissionStatus === status),
      ) ?? 'PENDING';
    return {
      merchantId,
      permissionStatus,
      sources,
      hasWarnings: sources.some(
        (source) => source.permissionStatus === 'EXPIRED' || source.permissionStatus === 'REVOKED',
      ),
    };
  }
}
