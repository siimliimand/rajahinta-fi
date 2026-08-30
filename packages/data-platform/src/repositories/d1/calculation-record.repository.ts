/**
 * D1 CalculationRecordRepository — the Cloudflare-side implementation of
 * the abstract {@link CalculationRecordRepository} contract (task 2.5,
 * change migrate-to-cloudflare). Write-once, read-many persistence for
 * calculation audit records; signatures and result shapes match the pg
 * DrizzleCalculationRecordRepository exactly.
 *
 * ## Application-side id assignment
 *
 * The composite primary key (id, calculated_at) — the former pg
 * partitioned-table PK — prevents `id` from being a rowid alias, so
 * SQLite does NOT auto-assign it (pg's serial did). `create` assigns
 * `MAX(id) + 1` application-side, exactly the gap the D1 schema comment
 * reserves for the ported insert path. D1 serializes writes (single
 * writer), which is the same concurrency envelope the summary upsert
 * path already relies on.
 *
 * ## jsonb containment translation
 *
 * `findCalculationRecordIdsByEntity('retailOffer', …)` used pg's
 * `retail_offer_ids @> '[id]'` jsonb containment; the D1 translation is
 * an EXISTS over SQLite's `json_each` table-valued function (JSON1 —
 * supported by D1), matching the containment semantics for numeric
 * array elements. NULL and non-array columns match nothing, like the pg
 * containment against NULL.
 *
 * @module D1CalculationRecordRepository
 */
import { Injectable } from '@nestjs/common';
import {
  CalculationRecordRepository,
  type CalculationHistoryEntry,
} from '../../abstracts';
import { calculationRecords } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

/** Contract row type (canonical pg shape — Date objects, parsed jsonb). */
type CalculationRecord = typeof calculationRecords.$inferSelect;

/** Raw D1 calculation_records row. */
interface D1CalculationRecordRow {
  readonly id: number;
  readonly product_master_id: number;
  readonly retail_offer_ids: string | null;
  readonly transport_offer_id: number | null;
  readonly excise_rule_version_id: number | null;
  readonly container_duty_rule_version_id: number | null;
  readonly total_cents: number;
  readonly breakdown: string;
  readonly confidence: string;
  readonly quantity: number;
  readonly destination: string;
  readonly disclaimer: string;
  readonly session_id: string | null;
  readonly calculated_at: string;
}

function toContractRecord(row: D1CalculationRecordRow): CalculationRecord {
  return {
    id: row.id,
    productMasterId: row.product_master_id,
    retailOfferIds:
      row.retail_offer_ids === null
        ? null
        : (JSON.parse(row.retail_offer_ids) as unknown),
    transportOfferId: row.transport_offer_id,
    exciseRuleVersionId: row.excise_rule_version_id,
    containerDutyRuleVersionId: row.container_duty_rule_version_id,
    totalCents: row.total_cents,
    breakdown: JSON.parse(row.breakdown) as unknown,
    confidence: row.confidence,
    quantity: row.quantity,
    destination: row.destination,
    disclaimer: row.disclaimer,
    sessionId: row.session_id,
    calculatedAt: new Date(row.calculated_at),
  };
}

const RECORD_COLUMNS = `
  id, product_master_id, retail_offer_ids, transport_offer_id,
  excise_rule_version_id, container_duty_rule_version_id, total_cents,
  breakdown, confidence, quantity, destination, disclaimer, session_id,
  calculated_at`;

/** Next id for the composite-PK table — no rowid alias to auto-assign. */
const NEXT_ID_SQL = `
  SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM calculation_records`;

const INSERT_COLUMNS = `(id, product_master_id, retail_offer_ids, transport_offer_id, excise_rule_version_id, container_duty_rule_version_id, total_cents, breakdown, confidence, quantity, destination, disclaimer, session_id, calculated_at)`;

const FIND_BY_ID_SQL = `
  SELECT ${RECORD_COLUMNS} FROM calculation_records
   WHERE id = ? ORDER BY calculated_at ASC LIMIT 1`;

const FIND_BY_SESSION_SQL = `
  SELECT ${RECORD_COLUMNS} FROM calculation_records
   WHERE session_id = ? ORDER BY calculated_at ASC`;

const LINK_SESSION_SQL = `
  UPDATE calculation_records SET session_id = ?
   WHERE id = ? AND session_id IS NULL
   RETURNING id`;

const HISTORY_ENTRIES_SQL = `
  SELECT c.id AS calculation_id, c.calculated_at, c.total_cents,
         c.quantity, p.name AS product_name
    FROM calculation_records c
   INNER JOIN product_master p ON c.product_master_id = p.id
   WHERE c.session_id = ?
   ORDER BY c.calculated_at ASC`;

/** json_each translation of the pg jsonb @> containment for retail_offer_ids. */
const FIND_IDS_BY_OFFER_SQL = `
  SELECT id FROM calculation_records
   WHERE retail_offer_ids IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM json_each(calculation_records.retail_offer_ids)
        WHERE json_each.value = ?
     )`;

const FIND_IDS_BY_PRODUCT_SQL = `
  SELECT id FROM calculation_records WHERE product_master_id = ?`;

const FIND_IDS_BY_TRANSPORT_SQL = `
  SELECT id FROM calculation_records WHERE transport_offer_id = ?`;

const FIND_IDS_BY_TAX_RULE_SQL = `
  SELECT id FROM calculation_records
   WHERE excise_rule_version_id = ? OR container_duty_rule_version_id = ?`;

@Injectable()
export class D1CalculationRecordRepository extends CalculationRecordRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(
    record: typeof calculationRecords.$inferInsert,
  ): Promise<CalculationRecord> {
    // Composite PK: assign the id application-side when the caller did not.
    const id =
      record.id ??
      (
        await this.d1.prepare(NEXT_ID_SQL).first<{ next_id: number }>()
      )?.next_id;
    if (id === undefined) {
      throw new Error('calculation_records id assignment returned no row');
    }

    const calculatedAt =
      record.calculatedAt?.toISOString() ?? new Date().toISOString();
    const row = await this.d1
      .prepare(
        `INSERT INTO calculation_records ${INSERT_COLUMNS}
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${RECORD_COLUMNS}`,
      )
      .bind(
        id,
        record.productMasterId,
        record.retailOfferIds == null
          ? null
          : JSON.stringify(record.retailOfferIds),
        record.transportOfferId ?? null,
        record.exciseRuleVersionId ?? null,
        record.containerDutyRuleVersionId ?? null,
        record.totalCents,
        JSON.stringify(record.breakdown),
        record.confidence,
        record.quantity,
        record.destination,
        record.disclaimer,
        record.sessionId ?? null,
        calculatedAt,
      )
      .first<D1CalculationRecordRow>();
    if (!row) {
      throw new Error('calculation_records INSERT .. RETURNING returned no row');
    }
    return toContractRecord(row);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<CalculationRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1CalculationRecordRow>();
    return row ? toContractRecord(row) : null;
  }

  /** @inheritdoc */
  async findBySession(sessionId: string): Promise<CalculationRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_BY_SESSION_SQL)
        .bind(sessionId)
        .all<D1CalculationRecordRow>()
    ).results;
    return rows.map(toContractRecord);
  }

  /**
   * Claim an anonymous record for a session account: first claim wins.
   * The UPDATE's `session_id IS NULL` guard makes the claim atomic — a
   * concurrent second claim matches no row and returns false.
   */
  async linkSession(recordId: number, sessionId: string): Promise<boolean> {
    const result = await this.d1
      .prepare(LINK_SESSION_SQL)
      .bind(sessionId, recordId)
      .run();
    return Number(result.meta.changes ?? 0) > 0;
  }

  /** @inheritdoc */
  async findHistoryEntriesBySession(
    sessionId: string,
  ): Promise<CalculationHistoryEntry[]> {
    const rows = (
      await this.d1
        .prepare(HISTORY_ENTRIES_SQL)
        .bind(sessionId)
        .all<{
          calculation_id: number;
          calculated_at: string;
          total_cents: number;
          quantity: number;
          product_name: string;
        }>()
    ).results;
    return rows.map((row) => ({
      calculationId: row.calculation_id,
      calculatedAt: new Date(row.calculated_at),
      totalCents: row.total_cents,
      quantity: row.quantity,
      productName: row.product_name,
    }));
  }

  /** @inheritdoc */
  async findCalculationRecordIdsByEntity(
    entityType: string,
    entityId: number,
  ): Promise<number[]> {
    let statement;
    switch (entityType) {
      case 'product':
        statement = this.d1.prepare(FIND_IDS_BY_PRODUCT_SQL).bind(entityId);
        break;
      case 'retailOffer':
        statement = this.d1.prepare(FIND_IDS_BY_OFFER_SQL).bind(entityId);
        break;
      case 'transportOffer':
        statement = this.d1.prepare(FIND_IDS_BY_TRANSPORT_SQL).bind(entityId);
        break;
      case 'taxRule':
        statement = this.d1.prepare(FIND_IDS_BY_TAX_RULE_SQL).bind(entityId, entityId);
        break;
      default:
        return [];
    }
    const rows = (await statement.all<{ id: number }>()).results;
    return rows.map((r) => r.id);
  }
}
