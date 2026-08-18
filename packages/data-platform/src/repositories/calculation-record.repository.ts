/**
 * Drizzle CalculationRecordRepository — concrete implementation of the abstract
 * CalculationRecordRepository class.
 *
 * Write-once, read-many persistence for calculation audit records.
 *
 * @module DrizzleCalculationRecordRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  CalculationRecordRepository,
} from '../abstracts';
import {
  calculationRecords,
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
}