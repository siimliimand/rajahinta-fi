/**
 * Drizzle BasketCalculationRecordRepository — concrete implementation of the
 * abstract BasketCalculationRecordRepository class backed by the
 * basket_calculation_records table.
 *
 * Write-once, read-many persistence for basket optimization audit records.
 *
 * @module DrizzleBasketCalculationRecordRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  BasketCalculationRecordRepository,
} from '../abstracts';
import {
  basketCalculationRecords,
} from '../schema';

@Injectable()
export class DrizzleBasketCalculationRecordRepository extends BasketCalculationRecordRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async create(
    record: typeof basketCalculationRecords.$inferInsert,
  ): Promise<typeof basketCalculationRecords.$inferSelect> {
    const [row] = await this.db
      .insert(basketCalculationRecords)
      .values(record)
      .returning();
    return row;
  }

  /** @inheritdoc */
  async findById(
    id: number,
  ): Promise<typeof basketCalculationRecords.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(basketCalculationRecords)
      .where(eq(basketCalculationRecords.id, id))
      .limit(1);
    return row ?? null;
  }
}
