/**
 * D1 SourceGovernanceRepository — the durable implementation of the
 * core-domain `ISourceGovernanceRepository` port (task 1.2, change
 * durable-source-governance-store), backed by the `source_governance`
 * table landed in task 1.1 (migration 0021).
 *
 * Semantics are ported exactly from the reference
 * InMemorySourceGovernanceRepository
 * (packages/application-api/src/ops/governance/
 * in-memory-source-governance.repository.ts): a status update without a
 * reason keeps the existing statusReason, bulk revocation skips rows
 * already REVOKED, and `checkPermission` aggregates with a
 * first-match-wins priority (no records at all → PENDING, fail-closed;
 * hasWarnings when at least one source is EXPIRED or REVOKED).
 *
 * ISO-8601 TEXT instants convert to Date at the repository boundary
 * (design D2), mirroring D1MerchantRegistryRepository.
 *
 * @module D1SourceGovernanceRepository
 */
import { Injectable } from '@nestjs/common';
import type {
  ISourceGovernanceRepository,
  PermissionCheckResult,
  RegisterSourceInput,
  SourceGovernanceRecord,
} from '@rajahinta/core-domain';
import type { D1DatabaseLike } from '../../d1/executor';

/** Aggregation priority — first match wins (port contract; reference constant). */
const STATUS_PRIORITY = ['GRANTED', 'PENDING', 'EXPIRED', 'REVOKED'] as const;

/** Raw D1 source_governance row (snake_case columns). */
interface D1SourceGovernanceRow {
  readonly id: number;
  readonly merchant_id: string;
  readonly acquisition_method: string;
  readonly permission_status: string;
  readonly source_url: string;
  readonly status_reason: string | null;
  readonly last_verified_at: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/** The one mapping point: snake_case TEXT row → contract record (ISO → Date). */
function toContractSourceGovernance(
  row: D1SourceGovernanceRow,
): SourceGovernanceRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    // The migration's CHECK constraints pin both value sets to the
    // core-domain unions, so the boundary cast is exhaustive.
    acquisitionMethod: row.acquisition_method as SourceGovernanceRecord['acquisitionMethod'],
    permissionStatus: row.permission_status as SourceGovernanceRecord['permissionStatus'],
    sourceUrl: row.source_url,
    statusReason: row.status_reason,
    lastVerifiedAt: new Date(row.last_verified_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const GOVERNANCE_COLUMNS = `
  id, merchant_id, acquisition_method, permission_status, source_url,
  status_reason, last_verified_at, created_at, updated_at`;

const FIND_BY_ID_SQL = `
  SELECT ${GOVERNANCE_COLUMNS} FROM source_governance WHERE id = ?`;

// created_at DESC mirrors the reference's most-recent-first sort; id ASC
// is the tiebreak a same-instant pair gets there (stable insertion order).
const FIND_BY_MERCHANT_ID_SQL = `
  SELECT ${GOVERNANCE_COLUMNS} FROM source_governance
  WHERE merchant_id = ?
  ORDER BY created_at DESC, id ASC`;

const INSERT_SQL = `
  INSERT INTO source_governance (
    merchant_id, acquisition_method, permission_status, source_url,
    status_reason, last_verified_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING ${GOVERNANCE_COLUMNS}`;

// COALESCE(?, status_reason) reproduces the reference's
// `reason ?? existing.statusReason`: an omitted reason keeps the old one.
const UPDATE_STATUS_SQL = `
  UPDATE source_governance SET
    permission_status = ?,
    status_reason = COALESCE(?, status_reason),
    last_verified_at = ?,
    updated_at = ?
  WHERE id = ?
  RETURNING ${GOVERNANCE_COLUMNS}`;

// The reference skips rows already REVOKED — the WHERE clause narrows the
// update to the same set, so meta.changes is the count of updated records.
const REVOKE_ALL_SQL = `
  UPDATE source_governance SET
    permission_status = 'REVOKED',
    status_reason = ?,
    last_verified_at = ?,
    updated_at = ?
  WHERE merchant_id = ? AND permission_status <> 'REVOKED'`;

@Injectable()
export class D1SourceGovernanceRepository implements ISourceGovernanceRepository {
  constructor(private readonly d1: D1DatabaseLike) {}

  /** @inheritdoc */
  async create(input: RegisterSourceInput): Promise<SourceGovernanceRecord> {
    const now = new Date().toISOString();
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        input.merchantId,
        input.acquisitionMethod,
        input.permissionStatus,
        input.sourceUrl,
        input.statusReason ?? null,
        now,
        now,
        now,
      )
      .first<D1SourceGovernanceRow>();
    if (!row) {
      throw new Error('source_governance INSERT .. RETURNING returned no row');
    }
    return toContractSourceGovernance(row);
  }

  /** @inheritdoc */
  async updateStatus(
    id: number,
    status: SourceGovernanceRecord['permissionStatus'],
    reason?: string,
  ): Promise<SourceGovernanceRecord | null> {
    const now = new Date().toISOString();
    const row = await this.d1
      .prepare(UPDATE_STATUS_SQL)
      .bind(status, reason ?? null, now, now, id)
      .first<D1SourceGovernanceRow>();
    return row ? toContractSourceGovernance(row) : null;
  }

  /** @inheritdoc */
  async revokeAllByMerchantId(
    merchantId: string,
    reason: string,
  ): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.d1
      .prepare(REVOKE_ALL_SQL)
      .bind(reason, now, now, merchantId)
      .run();
    return Number(result.meta.changes ?? 0);
  }

  /** @inheritdoc */
  async findByMerchantId(merchantId: string): Promise<SourceGovernanceRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_BY_MERCHANT_ID_SQL)
        .bind(merchantId)
        .all<D1SourceGovernanceRow>()
    ).results;
    return rows.map(toContractSourceGovernance);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<SourceGovernanceRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1SourceGovernanceRow>();
    return row ? toContractSourceGovernance(row) : null;
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
        (source) =>
          source.permissionStatus === 'EXPIRED' || source.permissionStatus === 'REVOKED',
      ),
    };
  }
}
