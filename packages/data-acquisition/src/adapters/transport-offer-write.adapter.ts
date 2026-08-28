/**
 * Drizzle-backed transport-offer write port (task 7.4).
 *
 * Appends carrier rate observations into the canonical `transport_offers`
 * table and answers the newest-observedAt query the freshness gauge
 * (`rajahinta_transport_newest_offer_age_seconds`) reads. Offers are
 * append-only history: a changed rate is a new row, never an update —
 * same convention as retail offers.
 *
 * @module DrizzleTransportOfferWriteAdapter
 */

import { Injectable, Inject } from '@nestjs/common';
import { max } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase, transportOffers } from '@rajahinta/data-platform';
import type {
  ITransportOfferWritePort,
  TransportOfferWrite,
} from '../interfaces/transport-offer-write.port';

@Injectable()
export class DrizzleTransportOfferWriteAdapter implements ITransportOfferWritePort {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {}

  /** @inheritdoc */
  async insertOffers(
    offers: readonly TransportOfferWrite[],
  ): Promise<{ inserted: number }> {
    if (offers.length === 0) return { inserted: 0 };

    // refreshedAt tracks this refresh batch; observedAt is the carrier's
    // own publication time carried on the rate — the two are separate by
    // design (schema comment on transport_offers).
    const rows = offers.map(({ rate, reliabilityStatus }) => ({
      carrier: rate.carrier,
      originCountry: rate.originCountry,
      destinationCountry: rate.destinationCountry,
      // pg numeric columns take strings at the driver boundary.
      weightMinKg: rate.weightMinKg !== null ? String(rate.weightMinKg) : null,
      weightMaxKg: rate.weightMaxKg !== null ? String(rate.weightMaxKg) : null,
      packageTier: rate.packageTier,
      priceCents: rate.priceCents,
      currency: rate.currency,
      sellerInvolvementIndicator: rate.sellerInvolvementIndicator,
      observedAt: rate.observedAt,
      refreshedAt: new Date(),
      reliabilityStatus,
    }));

    await this.db.insert(transportOffers).values(rows);
    return { inserted: rows.length };
  }

  /** @inheritdoc */
  async findNewestObservedAt(): Promise<Date | null> {
    const [row] = await this.db
      .select({ newest: max(transportOffers.observedAt) })
      .from(transportOffers);
    return row?.newest ?? null;
  }
}
