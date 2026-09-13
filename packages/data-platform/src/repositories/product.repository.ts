/**
 * Drizzle ProductRepository — concrete implementation of the abstract
 * ProductRepository class.
 *
 * Provides CRUD and upsert-by-EAN for the product_master table.
 *
 * @module DrizzleProductRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { asc, desc, eq, ilike, inArray, max, or, sql } from 'drizzle-orm';
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
  override async searchRanked(
    query: string,
    limit: number,
  ): Promise<(typeof productMaster.$inferSelect)[]> {
    const trimmed = query.trim();
    const pattern = `%${trimmed}%`;

    // Best per-field similarity — GREATEST keeps a strong brand match on
    // a weak name competitive instead of averaging fields together.
    // similarity() is a pure function of its inputs, so unchanged data
    // always yields the same scores; the id tiebreaker pins the order.
    const relevance = sql`GREATEST(
      similarity(${productMaster.name}, ${trimmed}),
      similarity(${productMaster.brand}, ${trimmed}),
      similarity(${productMaster.manufacturer}, ${trimmed})
    )`;

    // Recall via ILIKE (accelerated by the gin_trgm_ops indexes) keeps
    // short queries working — 1–2 characters are too few for trigrams.
    return this.db
      .select()
      .from(productMaster)
      .where(
        or(
          ilike(productMaster.name, pattern),
          ilike(productMaster.brand, pattern),
          ilike(productMaster.manufacturer, pattern),
        ),
      )
      .orderBy(desc(relevance), asc(productMaster.id))
      .limit(limit);
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
    // retail_offers is append-per-scrape: upsertOffer inserts a new row per
    // run and rows are never updated, so the latest observation for a
    // (product, merchant) pair is the max id — the same recency the
    // upsertOffer change detection resolves via (observed_at, id)
    // descending, collapsed to the monotonic surrogate key.
    const latestPerMerchant = this.db
      .select({ merchant: retailOffers.merchant, id: max(retailOffers.id) })
      .from(retailOffers)
      .where(eq(retailOffers.productId, productId))
      .groupBy(retailOffers.merchant);
    return this.db
      .select()
      .from(retailOffers)
      .where(inArray(retailOffers.id, latestPerMerchant))
      .orderBy(asc(retailOffers.id));
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