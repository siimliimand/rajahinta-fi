/**
 * D1 BasketCalculationRecordRepository — the Cloudflare-side
 * implementation of the abstract {@link BasketCalculationRecordRepository}
 * contract (task 2.5, change migrate-to-cloudflare). Write-once,
 * read-many persistence for basket-optimization audit records;
 * signatures and result shapes match the pg
 * DrizzleBasketCalculationRecordRepository exactly.
 *
 * As with calculationRecords, the composite PK (id, created_at) keeps
 * `id` from being a rowid alias — the id is assigned application-side
 * (MAX(id) + 1) when the caller omits it.
 *
 * @module D1BasketCalculationRecordRepository
 */
import { Injectable } from '@nestjs/common';
import {
  BasketCalculationRecordRepository,
  type BasketCalculationRecord,
} from '../../abstracts';
// Contract insert type from the canonical schema table (pure schema
// definitions — no driver dependency).
import { basketCalculationRecords } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

/** Raw D1 basket_calculation_records row. */
interface D1BasketCalculationRecordRow {
  readonly id: number;
  readonly session_id: string | null;
  readonly destination: string;
  readonly transport_arrangement: string;
  readonly input_basket: string;
  readonly shipment_breakdown: string;
  readonly total_cents: number;
  readonly confidence: string;
  readonly disclaimer: string;
  readonly created_at: string;
}

function toContractRecord(row: D1BasketCalculationRecordRow): BasketCalculationRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    destination: row.destination,
    transportArrangement: row.transport_arrangement,
    inputBasket: JSON.parse(row.input_basket) as unknown,
    shipmentBreakdown: JSON.parse(row.shipment_breakdown) as unknown,
    totalCents: row.total_cents,
    confidence: row.confidence,
    disclaimer: row.disclaimer,
    createdAt: new Date(row.created_at),
  };
}

const RECORD_COLUMNS = `
  id, session_id, destination, transport_arrangement, input_basket,
  shipment_breakdown, total_cents, confidence, disclaimer, created_at`;

const NEXT_ID_SQL = `
  SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM basket_calculation_records`;

const FIND_BY_ID_SQL = `
  SELECT ${RECORD_COLUMNS} FROM basket_calculation_records
   WHERE id = ? ORDER BY created_at ASC LIMIT 1`;

const INSERT_SQL = `
  INSERT INTO basket_calculation_records (
    id, session_id, destination, transport_arrangement, input_basket,
    shipment_breakdown, total_cents, confidence, disclaimer, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING ${RECORD_COLUMNS}`;

@Injectable()
export class D1BasketCalculationRecordRepository extends BasketCalculationRecordRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(
    record: typeof basketCalculationRecords.$inferInsert,
  ): Promise<BasketCalculationRecord> {
    const id =
      record.id ??
      (
        await this.d1.prepare(NEXT_ID_SQL).first<{ next_id: number }>()
      )?.next_id;
    if (id === undefined) {
      throw new Error('basket_calculation_records id assignment returned no row');
    }

    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        id,
        record.sessionId ?? null,
        record.destination,
        record.transportArrangement,
        JSON.stringify(record.inputBasket),
        JSON.stringify(record.shipmentBreakdown),
        record.totalCents,
        record.confidence,
        record.disclaimer,
        record.createdAt?.toISOString() ?? new Date().toISOString(),
      )
      .first<D1BasketCalculationRecordRow>();
    if (!row) {
      throw new Error(
        'basket_calculation_records INSERT .. RETURNING returned no row',
      );
    }
    return toContractRecord(row);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<BasketCalculationRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1BasketCalculationRecordRow>();
    return row ? toContractRecord(row) : null;
  }
}
