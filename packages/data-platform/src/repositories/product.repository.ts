/**
 * Drizzle ProductRepository — concrete implementation of the abstract
 * ProductRepository class.
 *
 * Provides CRUD and upsert-by-EAN for the product_master table.
 *
 * @module DrizzleProductRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { eq, ilike, asc } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  ProductRepository,
} from '../abstracts';
import {
  productMaster,
  retailOffers,
} from '../schema';

@Injectable()
export class DrizzleProductRepository extends ProductRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async searchByName(
    query: string | null,
    limit: number,
  ): Promise<(typeof productMaster.$inferSelect)[]> {
    const base = this.db
      .select()
      .from(productMaster)
      .orderBy(asc(productMaster.name))
      .limit(limit);
    if (query === null || query.trim().length === 0) {
      return base;
    }
    // Simple substring match — the Phase 2 full-text index will replace
    // this, but ILIKE over the product master is correct for Phase 1.
    return base.where(ilike(productMaster.name, `%${query.trim()}%`));
  }

  /** @inheritdoc */
  async findById(
    id: number,
  ): Promise<typeof productMaster.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(productMaster)
      .where(eq(productMaster.id, id))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async findOffers(
    productId: number,
  ): Promise<typeof retailOffers.$inferSelect[]> {
    return this.db
      .select()
      .from(retailOffers)
      .where(eq(retailOffers.productId, productId));
  }

  /** @inheritdoc */
  async findRetailOfferById(
    id: number,
  ): Promise<typeof retailOffers.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(retailOffers)
      .where(eq(retailOffers.id, id))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async create(
    record: typeof productMaster.$inferInsert,
  ): Promise<typeof productMaster.$inferSelect> {
    const [row] = await this.db
      .insert(productMaster)
      .values(record)
      .returning();
    return row;
  }

  /** @inheritdoc */
  async upsertByEan(
    record: typeof productMaster.$inferInsert,
  ): Promise<typeof productMaster.$inferSelect> {
    if (!record.ean) {
      // No EAN — simple insert (cannot upsert without a key)
      const [row] = await this.db
        .insert(productMaster)
        .values(record)
        .returning();
      return row;
    }

    // Check for existing record with the same EAN
    const existing = await this.db
      .select()
      .from(productMaster)
      .where(eq(productMaster.ean, record.ean))
      .limit(1);

    if (existing.length > 0) {
      // Update — preserve id and createdAt
      const [row] = await this.db
        .update(productMaster)
        .set({
          name: record.name,
          manufacturer: record.manufacturer,
          brand: record.brand,
          category: record.category,
          alcoholByVolume: record.alcoholByVolume,
          unitVolume: record.unitVolume,
          containerType: record.containerType,
          regulatoryClassification: record.regulatoryClassification,
          depositSystemStatus: record.depositSystemStatus,
          updatedAt: new Date(),
        })
        .where(eq(productMaster.ean, record.ean))
        .returning();
      return row;
    }

    // Insert new
    const [row] = await this.db
      .insert(productMaster)
      .values(record)
      .returning();
    return row;
  }
}