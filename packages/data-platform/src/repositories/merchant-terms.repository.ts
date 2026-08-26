/**
 * Drizzle MerchantTermsRepository — concrete implementation of the abstract
 * MerchantTermsRepository class backed by the merchant_terms table.
 *
 * @module DrizzleMerchantTermsRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  MerchantTermsRepository,
} from '../abstracts';
import {
  merchantTerms,
} from '../schema';

@Injectable()
export class DrizzleMerchantTermsRepository extends MerchantTermsRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async findByMerchant(
    merchantId: string,
  ): Promise<typeof merchantTerms.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(merchantTerms)
      .where(eq(merchantTerms.merchantId, merchantId))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async upsert(
    record: typeof merchantTerms.$inferInsert,
  ): Promise<typeof merchantTerms.$inferSelect> {
    const [row] = await this.db
      .insert(merchantTerms)
      .values(record)
      .onConflictDoUpdate({
        target: merchantTerms.merchantId,
        set: {
          minimumOrderValueCents: record.minimumOrderValueCents ?? null,
          currency: record.currency,
          sourceUrl: record.sourceUrl ?? null,
          reliabilityStatus: record.reliabilityStatus,
          observedAt: record.observedAt ?? new Date(),
        },
      })
      .returning();
    return row;
  }
}
