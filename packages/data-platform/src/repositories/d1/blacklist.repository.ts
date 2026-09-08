/**
 * D1 BlacklistRepository — the published merchant warnings (task 1.3,
 * change trust-and-reach-roadmap), backed by the `blacklist_entries`
 * table (migration 0015). Implements the abstract contract from
 * abstracts.ts.
 *
 * Lifecycle at the SQL level — every transition is a guarded UPDATE
 * (`WHERE ... AND status = <expected>`), so an attempt from the wrong
 * state matches no row and returns null instead of coercing:
 *
 * - rows are created PUBLISHED by the explicit operator publish action
 *   (an entry exists only through publication — no automatic path), the
 *   published standard itself evaluated in core-domain against the
 *   reports;
 * - PUBLISHED → REOPENED stamps the appeal fields and hides the entry
 *   from public display immediately (public reads filter to exactly
 *   PUBLISHED);
 * - REOPENED → PUBLISHED (appeal denied) or REOPENED → REJECTED
 *   (appeal upheld, terminal).
 *
 * Entries are governance records and are never deleted (the audit_events
 * posture) — this class has deliberately no delete method, which is also
 * why `shop_reports.linked_entry_id` needs no cascade. Decisions append
 * to the audit trail at the console layer; the row carries only the
 * appeal facts themselves.
 *
 * @module D1BlacklistRepository
 */
import { Injectable } from '@nestjs/common';
import type { BlacklistEntryStatus, MerchantIdentity } from '@rajahinta/core-domain';
import type { D1DatabaseLike } from '../../d1/executor';
import {
  BlacklistRepository,
  type BlacklistEntryAppealInput,
  type BlacklistEntryPublishInput,
  type BlacklistEntryRecord,
} from '../../abstracts';

const ENTRY_STATUSES: readonly BlacklistEntryStatus[] = [
  'PUBLISHED',
  'REOPENED',
  'REJECTED',
];

/** Raw D1 blacklist_entries row. */
interface D1BlacklistEntryRow {
  readonly id: number;
  readonly merchant_domain: string;
  readonly merchant_name_normalized: string;
  readonly standard_met: string;
  readonly published_at: string;
  readonly published_by: string;
  readonly status: string;
  readonly appealed_at: string | null;
  readonly appeal_reason: string | null;
}

/** Narrow the varchar column onto the lifecycle union — defense in depth. */
function toStatus(value: string): BlacklistEntryStatus {
  if (!ENTRY_STATUSES.includes(value as BlacklistEntryStatus)) {
    throw new Error(
      `blacklist_entries.status "${value}" is not a known blacklist-entry lifecycle state`,
    );
  }
  return value as BlacklistEntryStatus;
}

function toContractEntry(row: D1BlacklistEntryRow): BlacklistEntryRecord {
  return {
    id: row.id,
    merchantDomain: row.merchant_domain,
    merchantNameNormalized: row.merchant_name_normalized,
    standardMet: row.standard_met,
    publishedAt: new Date(row.published_at),
    publishedBy: row.published_by,
    status: toStatus(row.status),
    appealedAt: row.appealed_at === null ? null : new Date(row.appealed_at),
    appealReason: row.appeal_reason,
  };
}

const ENTRY_COLUMNS = `
  id, merchant_domain, merchant_name_normalized, standard_met, published_at,
  published_by, status, appealed_at, appeal_reason`;

const INSERT_SQL = `
  INSERT INTO blacklist_entries (
    merchant_domain, merchant_name_normalized, standard_met, published_at,
    published_by, status
  ) VALUES (?, ?, ?, ?, ?, 'PUBLISHED')
  RETURNING ${ENTRY_COLUMNS}`;

const FIND_BY_ID_SQL = `
  SELECT ${ENTRY_COLUMNS} FROM blacklist_entries WHERE id = ?`;

/** The display join: exactly-PUBLISHED rows for one merchant identity. */
const FIND_PUBLISHED_BY_IDENTITY_SQL = `
  SELECT ${ENTRY_COLUMNS} FROM blacklist_entries
   WHERE merchant_domain = ? AND merchant_name_normalized = ?
     AND status = 'PUBLISHED'
   ORDER BY id ASC`;

const LIST_SQL = `
  SELECT ${ENTRY_COLUMNS} FROM blacklist_entries ORDER BY id ASC`;

/** Guarded transitions — only a matching current state can move. */
const APPEAL_SQL = `
  UPDATE blacklist_entries
     SET status = 'REOPENED', appealed_at = ?, appeal_reason = ?
   WHERE id = ? AND status = 'PUBLISHED'
  RETURNING ${ENTRY_COLUMNS}`;

const REPUBLISH_SQL = `
  UPDATE blacklist_entries SET status = 'PUBLISHED'
   WHERE id = ? AND status = 'REOPENED'
  RETURNING ${ENTRY_COLUMNS}`;

const REJECT_SQL = `
  UPDATE blacklist_entries SET status = 'REJECTED'
   WHERE id = ? AND status = 'REOPENED'
  RETURNING ${ENTRY_COLUMNS}`;

@Injectable()
export class D1BlacklistRepository extends BlacklistRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async publish(input: BlacklistEntryPublishInput): Promise<BlacklistEntryRecord> {
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        input.merchantIdentity.domain,
        input.merchantIdentity.name,
        input.standardMet,
        new Date().toISOString(),
        input.publishedBy,
      )
      .first<D1BlacklistEntryRow>();
    if (!row) {
      throw new Error(
        'blacklist_entries INSERT .. RETURNING returned no row',
      );
    }
    return toContractEntry(row);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<BlacklistEntryRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1BlacklistEntryRow>();
    return row ? toContractEntry(row) : null;
  }

  /** @inheritdoc */
  async findPublishedByIdentity(
    identity: MerchantIdentity,
  ): Promise<BlacklistEntryRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_PUBLISHED_BY_IDENTITY_SQL)
        .bind(identity.domain, identity.name)
        .all<D1BlacklistEntryRow>()
    ).results;
    return rows.map(toContractEntry);
  }

  /** @inheritdoc */
  async list(): Promise<BlacklistEntryRecord[]> {
    const rows = (
      await this.d1.prepare(LIST_SQL).all<D1BlacklistEntryRow>()
    ).results;
    return rows.map(toContractEntry);
  }

  /** @inheritdoc */
  async appeal(
    id: number,
    input: BlacklistEntryAppealInput,
  ): Promise<BlacklistEntryRecord | null> {
    const row = await this.d1
      .prepare(APPEAL_SQL)
      .bind(input.appealedAt.toISOString(), input.appealReason, id)
      .first<D1BlacklistEntryRow>();
    return row ? toContractEntry(row) : null;
  }

  /** @inheritdoc */
  async resolveRepublish(id: number): Promise<BlacklistEntryRecord | null> {
    const row = await this.d1
      .prepare(REPUBLISH_SQL)
      .bind(id)
      .first<D1BlacklistEntryRow>();
    return row ? toContractEntry(row) : null;
  }

  /** @inheritdoc */
  async resolveReject(id: number): Promise<BlacklistEntryRecord | null> {
    const row = await this.d1
      .prepare(REJECT_SQL)
      .bind(id)
      .first<D1BlacklistEntryRow>();
    return row ? toContractEntry(row) : null;
  }
}
