/**
 * Drizzle CalculationRecordRepository — concrete implementation of the abstract
 * CalculationRecordRepository class.
 *
 * Write-once, read-many persistence for calculation audit records.
 *
 * @module DrizzleCalculationRecordRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  CalculationRecordRepository,
  type CalculationHistoryEntry,
} from '../abstracts';
import {
  calculationRecords,
  productMaster,
} from '../schema';

@Injectable()
export class DrizzleCalculationRecordRepository extends CalculationRecordRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async create(
    record: typeof calculationRecords.$inferInsert,
  ): Promise<typeof calculationRecords.$inferSelect> {
    const [row] = await this.db
      .insert(calculationRecords)
      .values(record)
      .returning();
    return row;
  }

  /** @inheritdoc */
  async findById(
    id: number,
  ): Promise<typeof calculationRecords.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(calculationRecords)
      .where(eq(calculationRecords.id, id))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async findBySession(
    sessionId: string,
  ): Promise<typeof calculationRecords.$inferSelect[]> {
    return this.db
      .select()
      .from(calculationRecords)
      .where(eq(calculationRecords.sessionId, sessionId))
      .orderBy(calculationRecords.calculatedAt);
  }

  /** @inheritdoc */
  async linkSession(recordId: number, sessionId: string): Promise<boolean> {
    const rows = await this.db
      .update(calculationRecords)
      .set({ sessionId })
      .where(
        and(
          eq(calculationRecords.id, recordId),
          isNull(calculationRecords.sessionId),
        ),
      )
      .returning({ id: calculationRecords.id });
    return rows.length > 0;
  }

  /** @inheritdoc */
  async findHistoryEntriesBySession(
    sessionId: string,
  ): Promise<CalculationHistoryEntry[]> {
    return this.db
      .select({
        calculationId: calculationRecords.id,
        calculatedAt: calculationRecords.calculatedAt,
        totalCents: calculationRecords.totalCents,
        quantity: calculationRecords.quantity,
        productName: productMaster.name,
      })
      .from(calculationRecords)
      .innerJoin(
        productMaster,
        eq(calculationRecords.productMasterId, productMaster.id),
      )
      .where(eq(calculationRecords.sessionId, sessionId))
      .orderBy(calculationRecords.calculatedAt);
  }

  /** @inheritdoc */
  async findCalculationRecordIdsByEntity(
    entityType: string,
    entityId: number,
  ): Promise<number[]> {
    let whereClause: SQL;

    switch (entityType) {
      case 'product':
        whereClause = eq(calculationRecords.productMasterId, entityId);
        break;
      case 'retailOffer':
        whereClause = sql`${calculationRecords.retailOfferIds} @> ${JSON.stringify([entityId])}::jsonb`;
        break;
      case 'transportOffer':
        whereClause = eq(calculationRecords.transportOfferId, entityId);
        break;
      case 'taxRule':
        whereClause = or(
          eq(calculationRecords.exciseRuleVersionId, entityId),
          eq(calculationRecords.containerDutyRuleVersionId, entityId),
        )!;
        break;
      default:
        return [];
    }

    const rows = await this.db
      .select({ id: calculationRecords.id })
      .from(calculationRecords)
      .where(whereClause);

    return rows.map((r) => r.id);
  }
}