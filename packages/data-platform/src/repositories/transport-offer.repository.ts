/**
 * Drizzle TransportOfferRepository — concrete implementation of the abstract
 * TransportOfferRepository class.
 *
 * @module DrizzleTransportOfferRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { eq, and, gte, lte, gt, or, isNull } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  TransportOfferRepository,
} from '../abstracts';
import {
  transportOffers,
} from '../schema';

@Injectable()
export class DrizzleTransportOfferRepository extends TransportOfferRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async findByCarrier(
    carrierId: string,
  ): Promise<typeof transportOffers.$inferSelect[]> {
    return this.db
      .select()
      .from(transportOffers)
      .where(eq(transportOffers.carrier, carrierId));
  }

  /** @inheritdoc */
  async findActive(): Promise<typeof transportOffers.$inferSelect[]> {
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    );

    const recent = await this.db
      .select()
      .from(transportOffers)
      .where(gte(transportOffers.observedAt, sevenDaysAgo));

    // Return recent rows when available, otherwise return all
    if (recent.length > 0) {
      return recent;
    }
    return this.db.select().from(transportOffers);
  }

  /** @inheritdoc */
  async findApplicable(
    carrier: string,
    origin: string,
    destination: string,
    weightKg: number,
    packageType: string,
  ): Promise<typeof transportOffers.$inferSelect[]> {
    const weightStr = String(weightKg);
    return this.db
      .select()
      .from(transportOffers)
      .where(
        and(
          eq(transportOffers.carrier, carrier),
          eq(transportOffers.originCountry, origin),
          eq(transportOffers.destinationCountry, destination),
          eq(transportOffers.packageTier, packageType),
          // Weight bracket: weightMinKg <= weightKg < weightMaxKg
          or(
            isNull(transportOffers.weightMinKg),
            lte(transportOffers.weightMinKg, weightStr),
          ),
          or(
            isNull(transportOffers.weightMaxKg),
            gt(transportOffers.weightMaxKg, weightStr),
          ),
        ),
      );
  }
}