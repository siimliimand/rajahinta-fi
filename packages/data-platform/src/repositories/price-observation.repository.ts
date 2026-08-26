/**
 * Drizzle PriceObservationRepository — concrete implementation of the
 * abstract PriceObservationRepository class backed by the
 * price_observations table.
 *
 * This class is the storage adapter for the core-domain
 * {@link IPriceObservationPort}: the abstract append signature is
 * identical to the port's, so the adapter satisfies the interface
 * directly (no separate mapper class). The composition root registers
 * it under PRICE_OBSERVATION_PORT (change
 * 2026-08-26-phase2-historical-price-intelligence, task 2.2); this
 * module registers it only under its abstract class token.
 *
 * Append-only: insert plus range reads, nothing else. Rows are never
 * updated or deleted — corrections append new observations.
 *
 * versionLabel mapping: the domain RecordedPriceObservation carries
 * rule-version labels, which are NOT schema columns. Read results return
 * the raw row with rule-version FK ids; labels are resolved by the
 * attribution service through its own tax-rule queries, keeping range
 * reads join-free and covered by the (product_id, observed_at) and
 * (merchant, product_id, observed_at) indexes.
 *
 * @module DrizzlePriceObservationRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  PriceObservationRepository,
  type PriceObservationRecord,
} from '../abstracts';
import { priceObservations } from '../schema';
import type {
  PriceObservation,
  IPriceObservationPort,
} from '@rajahinta/core-domain';

@Injectable()
export class DrizzlePriceObservationRepository
  extends PriceObservationRepository
  implements IPriceObservationPort
{
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async append(observation: PriceObservation): Promise<{ id: number }> {
    // Insert only — this method must never mutate existing rows. The
    // rule-version snapshots collapse to their FK ids; versionLabel is
    // recoverable via taxRules and intentionally not stored here.
    const [row] = await this.db
      .insert(priceObservations)
      .values({
        productId: observation.productId,
        merchant: observation.merchant,
        retailOfferId: observation.retailOfferId,
        observedAt: observation.observedAt,
        foreignRetailPriceCents: observation.foreignRetailPriceCents,
        transportOfferId: observation.transportOfferId,
        transportCostCents: observation.transportCostCents,
        exciseRuleVersionId: observation.exciseRuleVersion?.ruleId ?? null,
        containerDutyRuleVersionId:
          observation.containerDutyRuleVersion?.ruleId ?? null,
        landedCostCents: observation.landedCostCents,
        inputReliability: observation.inputReliability,
        confidence: observation.confidence,
      })
      .returning({ id: priceObservations.id });
    return { id: row.id };
  }

  /** @inheritdoc */
  async findByProductRange(
    productId: number,
    from: Date,
    to: Date,
    merchant?: string | null,
  ): Promise<PriceObservationRecord[]> {
    const filters = [
      eq(priceObservations.productId, productId),
      // Half-open [from, to): bucketStart inclusive, end exclusive.
      gte(priceObservations.observedAt, from),
      lt(priceObservations.observedAt, to),
    ];
    if (merchant != null) {
      filters.push(eq(priceObservations.merchant, merchant));
    }
    return this.db
      .select()
      .from(priceObservations)
      .where(and(...filters))
      .orderBy(...this.seriesOrder());
  }

  /** @inheritdoc */
  async findByMerchantOfferRange(
    merchant: string,
    retailOfferId: number,
    from: Date,
    to: Date,
  ): Promise<PriceObservationRecord[]> {
    return this.db
      .select()
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.merchant, merchant),
          eq(priceObservations.retailOfferId, retailOfferId),
          gte(priceObservations.observedAt, from),
          lt(priceObservations.observedAt, to),
        ),
      )
      .orderBy(...this.seriesOrder());
  }

  /** @inheritdoc */
  async findByMerchantProductRange(
    merchant: string,
    productId: number,
    from: Date,
    to: Date,
  ): Promise<PriceObservationRecord[]> {
    return this.db
      .select()
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.merchant, merchant),
          eq(priceObservations.productId, productId),
          gte(priceObservations.observedAt, from),
          lt(priceObservations.observedAt, to),
        ),
      )
      .orderBy(...this.seriesOrder());
  }

  /** @inheritdoc */
  async findEarliestObservedAt(
    productId: number,
    merchant?: string | null,
  ): Promise<Date | null> {
    const filters = [eq(priceObservations.productId, productId)];
    if (merchant != null) {
      filters.push(eq(priceObservations.merchant, merchant));
    }
    const [row] = await this.db
      .select({ observedAt: priceObservations.observedAt })
      .from(priceObservations)
      .where(and(...filters))
      // Ascending on the leading index column resolves min(observedAt)
      // without an aggregate scan.
      .orderBy(asc(priceObservations.observedAt))
      .limit(1);
    return row?.observedAt ?? null;
  }

  /**
   * Deterministic series ordering: observations can share an observedAt
   * instant, so the row id breaks ties. Consecutive-observation
   * consumers (attribution) rely on this stability.
   */
  private seriesOrder() {
    return [
      asc(priceObservations.observedAt),
      asc(priceObservations.id),
    ];
  }
}
