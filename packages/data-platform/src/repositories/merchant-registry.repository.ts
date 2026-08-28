/**
 * Drizzle MerchantRegistryRepository — concrete implementation of the
 * abstract MerchantRegistryRepository class backed by the
 * merchant_registry table.
 *
 * @module DrizzleMerchantRegistryRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  MerchantRegistryRepository,
  type MerchantRegistryRecord,
} from '../abstracts';
import { merchantRegistry } from '../schema';

@Injectable()
export class DrizzleMerchantRegistryRepository extends MerchantRegistryRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async list(): Promise<MerchantRegistryRecord[]> {
    return this.db
      .select()
      .from(merchantRegistry)
      .orderBy(asc(merchantRegistry.merchantId));
  }

  /** @inheritdoc */
  async findByMerchantId(
    merchantId: string,
  ): Promise<MerchantRegistryRecord | null> {
    const [row] = await this.db
      .select()
      .from(merchantRegistry)
      .where(eq(merchantRegistry.merchantId, merchantId))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async upsert(
    record: typeof merchantRegistry.$inferInsert,
  ): Promise<MerchantRegistryRecord> {
    const [row] = await this.db
      .insert(merchantRegistry)
      .values(record)
      .onConflictDoUpdate({
        target: merchantRegistry.merchantId,
        set: {
          name: record.name,
          country: record.country,
          feedUrl: record.feedUrl,
          feedFormat: record.feedFormat,
          pollingIntervalMs: record.pollingIntervalMs,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }
}
