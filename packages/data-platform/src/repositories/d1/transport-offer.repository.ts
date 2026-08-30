/**
 * D1 TransportOfferRepository — the Cloudflare-side implementation of the
 * abstract {@link TransportOfferRepository} contract (task 2.5, change
 * migrate-to-cloudflare). Method signatures and result shapes match the
 * pg DrizzleTransportOfferRepository exactly; the pg-shape translation
 * happens at the repository boundary (design D2): REAL weight brackets →
 * the fixed-scale decimal text pg's numeric(10,4) driver returned, ISO
 * TEXT instants → Date, INTEGER boolean → boolean.
 *
 * Weight-bracket matching runs numerically against the REAL columns —
 * the pg repository bound the weight as decimal text only because the
 * pg driver expected numeric strings; the comparison semantics
 * (weightMinKg <= weightKg < weightMaxKg, null = open end) are preserved.
 *
 * @module D1TransportOfferRepository
 */
import { Injectable } from '@nestjs/common';
import { TransportOfferRepository } from '../../abstracts';
import { transportOffers } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

/** Contract row type (canonical pg shape — numeric strings, Date objects). */
type TransportOfferRecord = typeof transportOffers.$inferSelect;

/** pg column scale: weight_min_kg / weight_max_kg numeric(10,4). */
const WEIGHT_SCALE = 4;

/** Raw D1 transport_offers row. */
interface D1TransportOfferRow {
  readonly id: number;
  readonly carrier: string;
  readonly origin_country: string;
  readonly destination_country: string;
  readonly weight_min_kg: number | null;
  readonly weight_max_kg: number | null;
  readonly package_tier: string;
  readonly price_cents: number;
  readonly currency: string;
  readonly seller_involvement_indicator: number;
  readonly observed_at: string;
  readonly refreshed_at: string;
  readonly reliability_status: string;
}

function toContractOffer(row: D1TransportOfferRow): TransportOfferRecord {
  return {
    id: row.id,
    carrier: row.carrier,
    originCountry: row.origin_country,
    destinationCountry: row.destination_country,
    weightMinKg:
      row.weight_min_kg === null ? null : row.weight_min_kg.toFixed(WEIGHT_SCALE),
    weightMaxKg:
      row.weight_max_kg === null ? null : row.weight_max_kg.toFixed(WEIGHT_SCALE),
    packageTier: row.package_tier,
    priceCents: row.price_cents,
    currency: row.currency,
    sellerInvolvementIndicator: row.seller_involvement_indicator !== 0,
    observedAt: new Date(row.observed_at),
    refreshedAt: new Date(row.refreshed_at),
    reliabilityStatus: row.reliability_status,
  };
}

const OFFER_COLUMNS = `
  id, carrier, origin_country, destination_country, weight_min_kg,
  weight_max_kg, package_tier, price_cents, currency,
  seller_involvement_indicator, observed_at, refreshed_at,
  reliability_status`;

const FIND_BY_CARRIER_SQL = `
  SELECT ${OFFER_COLUMNS} FROM transport_offers WHERE carrier = ?`;

const FIND_RECENT_SQL = `
  SELECT ${OFFER_COLUMNS} FROM transport_offers WHERE observed_at >= ?`;

const FIND_ALL_SQL = `
  SELECT ${OFFER_COLUMNS} FROM transport_offers`;

/** Weight bracket: weightMinKg <= weightKg < weightMaxKg (null = open end). */
const FIND_APPLICABLE_SQL = `
  SELECT ${OFFER_COLUMNS} FROM transport_offers
   WHERE carrier = ? AND origin_country = ? AND destination_country = ?
     AND package_tier = ?
     AND (weight_min_kg IS NULL OR weight_min_kg <= ?)
     AND (weight_max_kg IS NULL OR weight_max_kg > ?)`;

@Injectable()
export class D1TransportOfferRepository extends TransportOfferRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async findByCarrier(carrierId: string): Promise<TransportOfferRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_BY_CARRIER_SQL)
        .bind(carrierId)
        .all<D1TransportOfferRow>()
    ).results;
    return rows.map(toContractOffer);
  }

  /**
   * Offers observed within the last seven days, falling back to the
   * whole table when no row is that fresh — the pg staleness fallback,
   * preserved verbatim.
   */
  async findActive(): Promise<TransportOfferRecord[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = (
      await this.d1
        .prepare(FIND_RECENT_SQL)
        .bind(sevenDaysAgo.toISOString())
        .all<D1TransportOfferRow>()
    ).results;
    if (recent.length > 0) {
      return recent.map(toContractOffer);
    }
    const all = (
      await this.d1.prepare(FIND_ALL_SQL).all<D1TransportOfferRow>()
    ).results;
    return all.map(toContractOffer);
  }

  /** @inheritdoc */
  async findApplicable(
    carrier: string,
    origin: string,
    destination: string,
    weightKg: number,
    packageType: string,
  ): Promise<TransportOfferRecord[]> {
    const rows = (
      await this.d1
        .prepare(FIND_APPLICABLE_SQL)
        .bind(carrier, origin, destination, packageType, weightKg, weightKg)
        .all<D1TransportOfferRow>()
    ).results;
    return rows.map(toContractOffer);
  }
}
