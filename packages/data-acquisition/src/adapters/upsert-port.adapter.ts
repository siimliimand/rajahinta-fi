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
 * **Name-quality gate** (change product-name-quality-gate, task 2.3): every
 * product upsert classifies the mapped feed name and stores the stripped
 * display form — `name` carries the annotation-stripped display name,
 * `name_annotation` the parenthetical commentary, `name_quality` the gate
 * verdict.  Quarantined rows are still WRITTEN here: quarantine excludes
 * them from listings (the shared listing predicate, task 2.4), it is not
 * deletion.  The compound-key tier matches on the stripped display form —
 * the value the column now stores — and re-stamps the verdict so a
 * compound hit can never leave a quarantined row reading 'ok'.
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
import {
  classifyNameQuality,
  stripNameAnnotation,
} from '../services/name-quality';
import type {
  IUpsertRepository,
  UpsertProductInput,
  UpsertOfferInput,
  UpsertResult,
  UpsertOfferResult,
} from '../interfaces/upsert-port.interface';

/**
 * Feed weight arrives on the mapped product (the MappedPair widening,
 * change alks-feed-and-import-vat); plain UpsertProductInput callers
 * carry none. Absent or non-finite reads as null — the Alko shape.
 */
function weightGramsOf(input: UpsertProductInput): number | null {
  const raw = (input as { weightGrams?: unknown }).weightGrams;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * The ingestion guard's review hold arrives the same way (the MappedPair
 * widening, change nonalcoholic-catalog-hygiene); plain UpsertProductInput
 * callers carry none. Absent or non-string reads as null — not held.
 */
function reviewHoldReasonOf(input: UpsertProductInput): string | null {
  const raw = (input as { reviewHoldReason?: unknown }).reviewHoldReason;
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

@Injectable()
export class DrizzleUpsertRepository implements IUpsertRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {}

  // --------------------------------------------------------------------------
  // upsertProduct
  // --------------------------------------------------------------------------

  async upsertProduct(input: UpsertProductInput): Promise<UpsertResult> {
    // Name-quality gate (change product-name-quality-gate, task 2.3) —
    // applied here at the persistence path so EVERY upsert caller gets it,
    // the same choke-point pattern as the weightGrams/reviewHoldReason
    // widenings. The listing-visible `name` is the annotation-stripped
    // display form; classification runs on the raw feed name, byte-identical
    // to the task 1.1 backfill's verdicts.
    const { displayName, annotation } = stripNameAnnotation(input.name);
    const nameQuality = classifyNameQuality(input.name);

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
            name: displayName,
            manufacturer: input.manufacturer,
            brand: input.brand,
            category: input.category,
            alcoholByVolume: input.alcoholByVolume,
            unitVolume: input.unitVolume,
            containerType: input.containerType,
            regulatoryClassification: input.regulatoryClassification,
            depositSystemStatus: input.depositSystemStatus,
            weightGrams: weightGramsOf(input),
            reviewHoldReason: reviewHoldReasonOf(input),
            nameQuality,
            nameAnnotation: annotation,
            updatedAt: new Date(),
          })
          .where(eq(productMaster.id, existing[0].id));

        return { productId: existing[0].id, created: false };
      }
    }

    // ---- Tier 2: Match by compound key (name, brand, containerType, unitVolume)
    // The match key is the stripped display form — the value `name` stores
    // from now on — so annotation-wording drift ("saatavuus 1 plo" →
    // "saatavuus 2 plo") cannot fork a second row for the same product.
    const existingCompound = await this.db
      .select({ id: productMaster.id })
      .from(productMaster)
      .where(
        and(
          eq(productMaster.name, displayName),
          eq(productMaster.brand, input.brand),
          eq(productMaster.containerType, input.containerType),
          eq(productMaster.unitVolume, input.unitVolume),
        ),
      )
      .limit(1);

    if (existingCompound.length > 0) {
      const updateData: Partial<typeof productMaster.$inferInsert> & {
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
        // The verdict is re-stamped on every hit: the matched row's name
        // equals the string just classified, so a quarantined verdict must
        // land here too or the row would keep reading 'ok' and leak into
        // the listings the gate excludes it from. Same for the annotation —
        // the stored name has none, the incoming feed name may.
        nameQuality,
        nameAnnotation: annotation,
      };

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
        name: displayName,
        manufacturer: input.manufacturer,
        brand: input.brand,
        category: input.category,
        alcoholByVolume: input.alcoholByVolume,
        unitVolume: input.unitVolume,
        containerType: input.containerType,
        regulatoryClassification: input.regulatoryClassification,
        depositSystemStatus: input.depositSystemStatus,
        weightGrams: weightGramsOf(input),
        reviewHoldReason: reviewHoldReasonOf(input),
        nameQuality,
        nameAnnotation: annotation,
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