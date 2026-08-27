/**
 * Transport Offer Query Adapter — composition-root binding for the
 * core-domain transport port.
 *
 * Implements ITransportOfferQuery by querying the transport_offers table
 * through the global Drizzle connection, mapping rows (numeric strings) to
 * the domain TransportOffer read model. Bound under TRANSPORT_OFFER_QUERY
 * in the optimizer module's scope (OptimizerModule.forRoot); the
 * single-item calculator's transport query wiring is a separate
 * pre-existing gap (estimateTransport degrades gracefully to null) and is
 * NOT changed by the basket optimization change.
 *
 * @module TransportOfferQueryAdapter
 */
import { Injectable, Inject } from '@nestjs/common';
import type { ITransportOfferQuery, TransportOffer } from '@rajahinta/core-domain';
import { DRIZZLE, type DrizzleDatabase } from '@rajahinta/data-platform';
import { transportOffers } from '@rajahinta/data-platform';

type TransportOfferRow = typeof transportOffers.$inferSelect;

function toDomain(row: TransportOfferRow): TransportOffer {
  return {
    id: row.id,
    carrier: row.carrier,
    originCountry: row.originCountry,
    destinationCountry: row.destinationCountry,
    weightBracket: {
      minKg: row.weightMinKg === null ? null : Number(row.weightMinKg),
      maxKg: row.weightMaxKg === null ? null : Number(row.weightMaxKg),
    },
    packageTier: row.packageTier,
    priceCents: row.priceCents,
    currency: row.currency,
    sellerInvolvementIndicator: row.sellerInvolvementIndicator,
    observedAt: row.observedAt,
    refreshedAt: row.refreshedAt,
    reliabilityStatus: row.reliabilityStatus,
  };
}

@Injectable()
export class TransportOfferQueryAdapter implements ITransportOfferQuery {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {}

  async findAllActive(): Promise<TransportOffer[]> {
    const rows = await this.db.select().from(transportOffers);
    return rows.map(toDomain);
  }

  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    const rows = await this.db.select().from(transportOffers);
    return rows.filter((row) => row.carrier === carrierId).map(toDomain);
  }
}
