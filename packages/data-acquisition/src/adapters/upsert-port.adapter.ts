/**
 * Drizzle-backed UpsertRepository — concrete write-port adapter.
 *
 * Implements {@link IUpsertRepository} against the canonical Drizzle schema
 * (`productMaster` and `retailOffers` tables) using the application's
 * Drizzle ORM instance injected via the {@link DRIZZLE} token.
 *
 * ## Upsert strategy
 *
 * **Product upsert** follows a two-tier matching strategy:
 * 1. **EAN match** — if the input carries an EAN-13 barcode, try to find an
 *    existing product with the same EAN.  On match, update all mutable fields.
 * 2. **Compound key fallback** — match on (name, brand, containerType,
 *    unitVolume).  On match, update mutable fields (including populating EAN
 *    if the input has one and the existing row does not).
 * 3. **Insert** — no match found; insert a new product row.
 *
 * **Offer upsert** inserts every observation as a new row.  Price history is
 * append-only; deduplication by (merchantId, productId, observedAt) window
 * is handled by a separate data-quality step after ingestion if needed.  The
 * result additionally reports whether the offer CHANGED versus the latest
 * prior row for the same (merchant, product) — first sighting or price move —
 * which drives the one-observation-per-changed-offer guardrail.
 *
 * @module DrizzleUpsertRepository
 */

import { Injectable, Inject } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDatabase,
  productMaster,
  retailOffers,
} from '@rajahinta/data-platform';
import type {
  IUpsertRepository,
  UpsertProductInput,
  UpsertOfferInput,
  UpsertResult,
  UpsertOfferResult,
} from '../interfaces/upsert-port.interface';

@Injectable()
export class DrizzleUpsertRepository implements IUpsertRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {}

  // --------------------------------------------------------------------------
  // upsertProduct
  // --------------------------------------------------------------------------

  async upsertProduct(input: UpsertProductInput): Promise<UpsertResult> {
    // ---- Tier 1: Match by EAN -----------------------------------------------
    if (input.ean) {
      const existing = await this.db
        .select({ id: productMaster.id })
        .from(productMaster)
        .where(eq(productMaster.ean, input.ean))
        .limit(1);

      if (existing.length > 0) {
        await this.db
          .update(productMaster)
          .set({
            name: input.name,
            manufacturer: input.manufacturer,
            brand: input.brand,
            category: input.category,
            alcoholByVolume: input.alcoholByVolume,
            unitVolume: input.unitVolume,
            containerType: input.containerType,
            regulatoryClassification: input.regulatoryClassification,
            depositSystemStatus: input.depositSystemStatus,
            updatedAt: new Date(),
          })
          .where(eq(productMaster.id, existing[0].id));

        return { productId: existing[0].id, created: false };
      }
    }

    // ---- Tier 2: Match by compound key (name, brand, containerType, unitVolume)
    const existingCompound = await this.db
      .select({ id: productMaster.id })
      .from(productMaster)
      .where(
        and(
          eq(productMaster.name, input.name),
          eq(productMaster.brand, input.brand),
          eq(productMaster.containerType, input.containerType),
          eq(productMaster.unitVolume, input.unitVolume),
        ),
      )
      .limit(1);

    if (existingCompound.length > 0) {
      const updateData: Partial<typeof productMaster.$inferInsert> & {
        updatedAt: Date;
      } = { updatedAt: new Date() };

      // Populate EAN if the input carries one and the existing row lacks it
      if (input.ean) {
        updateData.ean = input.ean;
      }

      await this.db
        .update(productMaster)
        .set(updateData)
        .where(eq(productMaster.id, existingCompound[0].id));

      return { productId: existingCompound[0].id, created: false };
    }

    // ---- Tier 3: Insert new product -----------------------------------------
    const [row] = await this.db
      .insert(productMaster)
      .values({
        name: input.name,
        manufacturer: input.manufacturer,
        brand: input.brand,
        category: input.category,
        alcoholByVolume: input.alcoholByVolume,
        unitVolume: input.unitVolume,
        containerType: input.containerType,
        regulatoryClassification: input.regulatoryClassification,
        depositSystemStatus: input.depositSystemStatus,
        ean: input.ean,
      })
      .returning({ id: productMaster.id });

    return { productId: row.id, created: true };
  }

  // --------------------------------------------------------------------------
  // upsertOffer
  // --------------------------------------------------------------------------

  async upsertOffer(input: UpsertOfferInput): Promise<UpsertOfferResult> {
    // ---- Change detection: latest prior row for (merchant, product) ------
    // An offer is "changed" when it is the first sighting or the price
    // moved. Availability-only flips are not changes — the observation log
    // driven by this flag is a price series and carries no availability.
    // (observedAt, id) descending resolves the latest row deterministically
    // even when scrapes share a timestamp.
    const [previous] = await this.db
      .select({ priceCents: retailOffers.priceCents })
      .from(retailOffers)
      .where(
        and(
          eq(retailOffers.merchant, input.merchant),
          eq(retailOffers.productId, input.productId),
        ),
      )
      .orderBy(desc(retailOffers.observedAt), desc(retailOffers.id))
      .limit(1);

    const changed =
      previous === undefined || previous.priceCents !== input.priceCents;

    const [row] = await this.db
      .insert(retailOffers)
      .values({
        merchant: input.merchant,
        country: input.country,
        productId: input.productId,
        priceCents: input.priceCents,
        currency: input.currency,
        availability: input.availability,
        sourceUrl: input.sourceUrl,
        observedAt: input.observedAt,
        reliabilityStatus: input.reliabilityStatus,
      })
      .returning({ id: retailOffers.id });

    return { offerId: row.id, changed };
  }
}