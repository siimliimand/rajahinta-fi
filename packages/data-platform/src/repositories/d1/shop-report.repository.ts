/**
 * D1 ShopReportRepository — user-reported non-delivery/counterfeit
 * evidence against foreign merchants (task 1.3, change
 * trust-and-reach-roadmap), backed by the `shop_reports` table
 * (migration 0015). Implements the abstract contract from abstracts.ts.
 *
 * Merchant identity is the pair (normalized domain, normalized name) —
 * derived in core-domain ({@link MerchantIdentity}); this layer stores
 * and matches the already-normalized values verbatim and never
 * normalizes itself, so writes and lookups cannot disagree about the
 * key.
 *
 * State machine at the SQL level: every transition is a guarded UPDATE
 * (`WHERE id = ? AND status = 'OPEN'`), so an attempted transition from
 * the wrong state matches no row and returns null instead of coercing:
 *
 * - OPEN → LINKED (backs a published entry; `linked_entry_id` stamped
 *   atomically by the same statement — terminal, a report links to at
 *   most one entry ever),
 * - OPEN → REJECTED (evidence did not survive moderation; terminal).
 *
 * A submitted report always lands OPEN (the schema default; the
 * repository states it explicitly so the row's initial state does not
 * depend on the column default).
 *
 * @module D1ShopReportRepository
 */
import { Injectable } from '@nestjs/common';
import type { MerchantIdentity } from '@rajahinta/core-domain';
import type { D1DatabaseLike } from '../../d1/executor';
import {
  ShopReportRepository,
  type ShopReportCreateInput,
  type ShopReportRecord,
  type ShopReportStatus,
} from '../../abstracts';

const SHOP_REPORT_STATUSES: readonly ShopReportStatus[] = [
  'OPEN',
  'LINKED',
  'REJECTED',
];

/** Raw D1 shop_reports row. */
interface D1ShopReportRow {
  readonly id: number;
  readonly merchant_domain: string;
  readonly merchant_name_normalized: string;
  readonly order_reference: string;
  readonly correspondence_summary: string;
  readonly reporter_account_id: number;
  readonly status: string;
  readonly linked_entry_id: number | null;
  readonly created_at: string;
}

/** Narrow the varchar column onto the status union — defense in depth. */
function toStatus(value: string): ShopReportStatus {
  if (!SHOP_REPORT_STATUSES.includes(value as ShopReportStatus)) {
    throw new Error(
      `shop_reports.status "${value}" is not a known shop-report moderation state`,
    );
  }
  return value as ShopReportStatus;
}

function toContractReport(row: D1ShopReportRow): ShopReportRecord {
  return {
    id: row.id,
    merchantDomain: row.merchant_domain,
    merchantNameNormalized: row.merchant_name_normalized,
    orderReference: row.order_reference,
    correspondenceSummary: row.correspondence_summary,
    reporterAccountId: row.reporter_account_id,
    status: toStatus(row.status),
    linkedEntryId: row.linked_entry_id,
    createdAt: new Date(row.created_at),
  };
}

const REPORT_COLUMNS = `
  id, merchant_domain, merchant_name_normalized, order_reference,
  correspondence_summary, reporter_account_id, status, linked_entry_id,
  created_at`;

const INSERT_SQL = `
  INSERT INTO shop_reports (
    merchant_domain, merchant_name_normalized, order_reference,
    correspondence_summary, reporter_account_id, status
  ) VALUES (?, ?, ?, ?, ?, 'OPEN')
  RETURNING ${REPORT_COLUMNS}`;

const FIND_BY_ID_SQL = `
  SELECT ${REPORT_COLUMNS} FROM shop_reports WHERE id = ?`;

const FIND_BY_MERCHANT_SQL = `
  SELECT ${REPORT_COLUMNS} FROM shop_reports
   WHERE merchant_domain = ? AND merchant_name_normalized = ?
   ORDER BY id ASC`;

const FIND_BY_REPORTER_SQL = `
  SELECT ${REPORT_COLUMNS} FROM shop_reports
   WHERE reporter_account_id = ?
   ORDER BY id ASC`;

const FIND_OPEN_SQL = `
  SELECT ${REPORT_COLUMNS} FROM shop_reports
   WHERE status = 'OPEN'
   ORDER BY created_at ASC, id ASC`;

/** Guarded transitions — only a matching current state can move. */
const REJECT_SQL = `
  UPDATE shop_reports SET status = 'REJECTED'
   WHERE id = ? AND status = 'OPEN'
  RETURNING ${REPORT_COLUMNS}`;

const LINK_SQL = `
  UPDATE shop_reports SET status = 'LINKED', linked_entry_id = ?
   WHERE id = ? AND status = 'OPEN'
  RETURNING ${REPORT_COLUMNS}`;

@Injectable()
export class D1ShopReportRepository extends ShopReportRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(input: ShopReportCreateInput): Promise<ShopReportRecord> {
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        input.merchantDomain,
        input.merchantNameNormalized,
        input.orderReference,
        input.correspondenceSummary,
        input.reporterAccountId,
      )
      .first<D1ShopReportRow>();
    if (!row) {
      throw new Error('shop_reports INSERT .. RETURNING returned no row');
    }
    return toContractReport(row);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<ShopReportRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1ShopReportRow>();
    return row ? toContractReport(row) : null;
  }

  /** @inheritdoc */
  async findByMerchantIdentity(
    identity: MerchantIdentity,
  ): Promise<ShopReportRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_BY_MERCHANT_SQL)
        .bind(identity.domain, identity.name)
        .all<D1ShopReportRow>()
    ).results;
    return rows.map(toContractReport);
  }

  /** @inheritdoc */
  async findByReporterAccountId(accountId: number): Promise<ShopReportRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_BY_REPORTER_SQL)
        .bind(accountId)
        .all<D1ShopReportRow>()
    ).results;
    return rows.map(toContractReport);
  }

  /** @inheritdoc */
  async findOpen(): Promise<ShopReportRecord[]> {
    const rows = (
      await this.d1.prepare(FIND_OPEN_SQL).all<D1ShopReportRow>()
    ).results;
    return rows.map(toContractReport);
  }

  /** @inheritdoc */
  async reject(id: number): Promise<ShopReportRecord | null> {
    const row = await this.d1
      .prepare(REJECT_SQL)
      .bind(id)
      .first<D1ShopReportRow>();
    return row ? toContractReport(row) : null;
  }

  /** @inheritdoc */
  async linkToEntry(
    id: number,
    entryId: number,
  ): Promise<ShopReportRecord | null> {
    const row = await this.d1
      .prepare(LINK_SQL)
      .bind(entryId, id)
      .first<D1ShopReportRow>();
    return row ? toContractReport(row) : null;
  }
}
