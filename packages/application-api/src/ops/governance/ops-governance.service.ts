/**
 * OpsGovernanceService — console workflow for source-governance permission
 * grants and revocations per merchant (task 12.1, change
 * technical-assessment-remediation).
 *
 * Grants and revocations go through the core-domain
 * SourceGovernanceService bound to the ops module's repository
 * (SOURCE_GOVERNANCE_REPOSITORY_PORT) — the same permission state the
 * ingestion governance gate reads. EVERY mutating action writes a durable
 * audit event (entityType `source_governance`) carrying the operator
 * identity, target merchant, and timestamp.
 *
 * @module OpsGovernanceService
 */

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditService,
  SOURCE_GOVERNANCE_REPOSITORY_PORT,
  SourceGovernanceService,
  type ISourceGovernanceRepository,
  type SourceGovernanceRecord,
} from '@rajahinta/core-domain';
import { MerchantRegistryRepository } from '@rajahinta/data-platform';
import type {
  GrantGovernanceDto,
  OpsGovernanceListResponse,
  OpsGovernanceMerchant,
  OpsGovernanceMutationResponse,
  RevokeGovernanceDto,
} from '../ops.dto';

@Injectable()
export class OpsGovernanceService {
  private readonly logger = new Logger(OpsGovernanceService.name);

  constructor(
    private readonly registry: MerchantRegistryRepository,
    private readonly governance: SourceGovernanceService,
    private readonly audit: AuditService,
    @Inject(SOURCE_GOVERNANCE_REPOSITORY_PORT)
    private readonly governanceRepo: ISourceGovernanceRepository,
  ) {}

  /**
   * Registry merchants joined with their aggregated governance state —
   * the console's grant/revoke worklist. Merchants without governance
   * records surface as PENDING (never overstated).
   */
  async listMerchantGovernance(): Promise<OpsGovernanceListResponse> {
    const merchants = await this.registry.list();

    const items: OpsGovernanceMerchant[] = [];
    for (const merchant of merchants) {
      const check = await this.governance.checkPermission(merchant.merchantId);
      items.push({
        merchantId: merchant.merchantId,
        name: merchant.name,
        country: merchant.country,
        feedUrl: merchant.feedUrl,
        permissionStatus: check.permissionStatus,
        sourceCount: check.sources.length,
        hasWarnings: check.hasWarnings,
      });
    }

    return { items, total: items.length };
  }

  /**
   * Grant ingestion permission for a merchant source.
   *
   * A PENDING or EXPIRED record transitions to GRANTED; a merchant with no
   * records gets a new GRANTED source; an already-fully-granted merchant is
   * a no-op (returns `changed: false`, nothing audited). Under the
   * governance gate, ingestion for the merchant proceeds once its check
   * aggregates to GRANTED.
   */
  async grantPermission(
    merchantId: string,
    dto: GrantGovernanceDto,
  ): Promise<OpsGovernanceMutationResponse> {
    const merchant = await this.registry.findByMerchantId(merchantId);
    if (merchant === null) {
      throw new NotFoundException(`Merchant "${merchantId}" is not in the registry`);
    }

    const records = await this.governance.listMerchantSources(merchantId);
    let updated: SourceGovernanceRecord;

    const transitionable = records.find(
      (record) => record.permissionStatus === 'PENDING' || record.permissionStatus === 'EXPIRED',
    );
    if (transitionable !== undefined) {
      updated = await this.grantRecord(transitionable.id, dto, 'updated');
    } else if (records.length === 0) {
      updated = await this.governance.registerSource(
        merchantId,
        dto.acquisitionMethod,
        'GRANTED',
        dto.sourceUrl,
      );
      await this.auditGrant(dto, merchantId, 'created', updated);
    } else {
      // Every source already GRANTED — the requested state already holds.
      return this.noOpResponse(merchantId, records);
    }

    const check = await this.governance.checkPermission(merchantId);
    return {
      merchantId,
      permissionStatus: check.permissionStatus,
      updatedSources: 1,
      changed: true,
    };
  }

  /**
   * Revoke every governance source for a merchant — the primary
   * revocation path (the domain service's revokePermission). Requires a
   * reason; unknown merchants and merchants without records 404.
   */
  async revokePermission(
    merchantId: string,
    dto: RevokeGovernanceDto,
  ): Promise<OpsGovernanceMutationResponse> {
    const merchant = await this.registry.findByMerchantId(merchantId);
    if (merchant === null) {
      throw new NotFoundException(`Merchant "${merchantId}" is not in the registry`);
    }

    const records = await this.governance.listMerchantSources(merchantId);
    if (records.length === 0) {
      throw new NotFoundException(
        `Merchant "${merchantId}" has no governance records to revoke`,
      );
    }

    const revokedCount = await this.governance.revokePermission(merchantId, dto.reason);

    await this.audit.logChange({
      entityType: 'source_governance',
      entityId: merchantId,
      action: 'updated',
      author: dto.operator,
      reason: dto.reason,
      previousValue: { permissionStatus: this.aggregateStatus(records) },
      newValue: { permissionStatus: 'REVOKED', revokedSources: revokedCount },
    });

    this.logger.warn(
      `Governance permission revoked for merchant "${merchantId}" by operator ` +
        `"${dto.operator}" (${revokedCount} source(s)): ${dto.reason}`,
    );

    return {
      merchantId,
      permissionStatus: 'REVOKED',
      updatedSources: revokedCount,
      changed: revokedCount > 0,
    };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /** Transition one record to GRANTED and audit the status change. */
  private async grantRecord(
    recordId: number,
    dto: GrantGovernanceDto,
    action: 'created' | 'updated',
  ): Promise<SourceGovernanceRecord> {
    const updated = await this.governanceRepo.updateStatus(recordId, 'GRANTED', dto.note);
    if (updated === null) {
      throw new NotFoundException(`Governance record ${recordId} disappeared mid-grant`);
    }
    await this.auditGrant(dto, updated.merchantId, action, updated);
    return updated;
  }

  /** Durable audit write for a grant (register or transition). */
  private async auditGrant(
    dto: GrantGovernanceDto,
    merchantId: string,
    action: 'created' | 'updated',
    record: SourceGovernanceRecord,
  ): Promise<void> {
    await this.audit.logChange({
      entityType: 'source_governance',
      entityId: merchantId,
      action,
      author: dto.operator,
      reason: dto.note?.trim() || 'Governance permission granted via operator console',
      previousValue:
        action === 'updated' ? { permissionStatus: 'PENDING' } : undefined,
      newValue: {
        permissionStatus: 'GRANTED',
        acquisitionMethod: record.acquisitionMethod,
        sourceUrl: record.sourceUrl,
      },
    });
    this.logger.log(
      `Governance permission granted for merchant "${merchantId}" by operator "${dto.operator}"`,
    );
  }

  /** Response for a grant that changed nothing. */
  private async noOpResponse(
    merchantId: string,
    records: readonly SourceGovernanceRecord[],
  ): Promise<OpsGovernanceMutationResponse> {
    return {
      merchantId,
      permissionStatus: this.aggregateStatus(records),
      updatedSources: 0,
      changed: false,
    };
  }

  /** Aggregate statuses with the port's priority, for snapshots. */
  private aggregateStatus(
    records: readonly SourceGovernanceRecord[],
  ): SourceGovernanceRecord['permissionStatus'] {
    const priority = ['GRANTED', 'PENDING', 'EXPIRED', 'REVOKED'] as const;
    const status = priority.find((candidate) =>
      records.some((record) => record.permissionStatus === candidate),
    );
    // Records is non-empty on every call path, so the find always matches.
    return status ?? 'PENDING';
  }
}
